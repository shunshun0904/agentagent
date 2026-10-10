import type { Agent, Message, Prisma, ReplyPolicy, Thread } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logActivity } from "@/lib/activity";
import { AiError, PROMPT_VERSION } from "@/lib/ai/client";
import { defaultAiService, type AiService } from "@/lib/ai/service";
import type { AnalysisPromptInput, PromptMessage } from "@/lib/ai/prompts";
import type { Analysis } from "@/lib/ai/schemas";
import { CATEGORY_LABELS } from "@/lib/format";
import { replySubject } from "@/lib/gmail/mime";
import { decideReplyAction } from "@/lib/policy/decide";
import { ensureUserDefaults } from "@/lib/policy/defaults";
import { computeSendTime } from "@/lib/policy/schedule";

export type ProcessResult = {
  processed: number;
  autoScheduled: number;
  needsApproval: number;
  noReply: number;
  errors: number;
  /** 時間切れで次回に回した件数 */
  deferred: number;
};

export type ProcessOptions = {
  ai?: AiService;
  limit?: number;
  /** この時刻(epoch ミリ秒)を過ぎたら新しいメールの処理を始めない */
  deadline?: number;
  now?: () => Date;
};

type PendingMessage = Message & {
  thread: Thread & { agent: Agent | null; contact: { id: string; name: string | null; email: string } | null };
};

function toPromptMessage(m: Message): PromptMessage {
  return {
    direction: m.direction,
    fromName: m.fromName,
    fromEmail: m.fromEmail,
    sentAt: m.sentAt,
    subject: m.subject,
    bodyText: m.bodyText,
  };
}

async function loadPolicy(userId: string, displayName: string): Promise<ReplyPolicy> {
  const existing = await prisma.replyPolicy.findUnique({ where: { userId } });
  if (existing) return existing;
  await ensureUserDefaults(userId, { displayName });
  return prisma.replyPolicy.findUniqueOrThrow({ where: { userId } });
}

/** このエージェントにまだ一度も返信していないか */
async function isNewAgent(agent: Agent | null): Promise<boolean> {
  if (!agent) return true;
  const outbound = await prisma.message.count({
    where: { direction: "OUTBOUND", thread: { agentId: agent.id } },
  });
  return outbound === 0;
}

/** 直近 24 時間にこのスレッドで自動送信(予定含む)した件数 */
async function countAutoRepliesRecent(threadId: string, now: Date): Promise<number> {
  return prisma.reply.count({
    where: {
      threadId,
      decision: "AUTO",
      status: { in: ["SCHEDULED", "SENDING", "SENT"] },
      createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
  });
}

/** 分析結果の案件情報を Opportunity として登録・更新する */
async function upsertOpportunities(userId: string, thread: Thread, message: Message, analysis: Analysis): Promise<string[]> {
  const ids: string[] = [];
  for (const job of analysis.jobs) {
    const title = job.title.trim();
    if (!title) continue;
    const existing = await prisma.opportunity.findFirst({
      where: { threadId: thread.id, title: { equals: title, mode: "insensitive" } },
    });
    if (existing) {
      await prisma.opportunity.update({
        where: { id: existing.id },
        data: {
          description: existing.description ?? job.description,
          rateMin: existing.rateMin ?? job.rate_min,
          rateMax: existing.rateMax ?? job.rate_max,
          rateText: existing.rateText ?? job.rate_text,
          period: existing.period ?? job.period,
          startText: existing.startText ?? job.start_text,
          location: existing.location ?? job.location,
          remotePolicy: existing.remotePolicy ?? job.remote_policy,
          skills: existing.skills.length > 0 ? existing.skills : job.skills,
          fitScore: job.fit_score,
          fitReason: job.fit_reason,
        },
      });
      ids.push(existing.id);
      continue;
    }
    const created = await prisma.opportunity.create({
      data: {
        userId,
        agentId: thread.agentId,
        threadId: thread.id,
        sourceMessageId: message.id,
        title,
        description: job.description,
        rateMin: job.rate_min,
        rateMax: job.rate_max,
        rateText: job.rate_text,
        period: job.period,
        startText: job.start_text,
        location: job.location,
        remotePolicy: job.remote_policy,
        skills: job.skills,
        fitScore: job.fit_score,
        fitReason: job.fit_reason,
      },
    });
    ids.push(created.id);
    await logActivity(userId, {
      type: "opportunity.created",
      entityType: "opportunity",
      entityId: created.id,
      message: `案件「${title}」を登録しました(適合度 ${job.fit_score})`,
    });
  }
  return ids;
}

async function processOne(userId: string, message: PendingMessage, ai: AiService, now: () => Date, result: ProcessResult): Promise<void> {
  const thread = message.thread;
  const agent = thread.agent;
  const profile = await prisma.profile.findUnique({ where: { userId } });
  const policy = await loadPolicy(userId, profile?.displayName ?? "");

  const historyDesc = await prisma.message.findMany({
    where: { threadId: thread.id, sentAt: { lt: message.sentAt } },
    orderBy: { sentAt: "desc" },
    take: 12,
  });
  const history = historyDesc.reverse().map(toPromptMessage);

  const analysisInput: AnalysisPromptInput = {
    now: now(),
    profile,
    agent: agent ? { name: agent.name, notes: agent.notes, status: agent.status } : null,
    threadSubject: thread.subject,
    threadSummary: thread.summary,
    history,
    message: toPromptMessage(message),
  };

  // 1. 分析
  const analysisResult = await ai.analyzeMessage(analysisInput);
  const analysis = analysisResult.data;
  await prisma.message.update({
    where: { id: message.id },
    data: {
      category: analysis.category,
      confidence: analysis.confidence,
      aiSummary: analysis.summary,
      needsReply: analysis.needs_reply,
      extracted: analysis as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.thread.update({ where: { id: thread.id }, data: { lastCategory: analysis.category } });
  await logActivity(userId, {
    type: "message.analyzed",
    entityType: "message",
    entityId: message.id,
    message: `「${message.subject}」を「${CATEGORY_LABELS[analysis.category]}」に分類しました(確信度 ${Math.round(analysis.confidence * 100)}%)`,
    metadata: { usage: analysisResult.usage, model: analysisResult.model },
  });

  // 2. 案件の登録
  const opportunityIds = await upsertOpportunities(userId, thread, message, analysis);

  // 3. 既に返信済み、または同じスレッドに新しい受信メールがある場合は返信案を作らない
  //    (初回同期で過去のメールをまとめて取り込んだ場合や、相手が続けて送ってきた場合)
  const [laterOutbound, laterInbound] = await Promise.all([
    prisma.message.count({ where: { threadId: thread.id, direction: "OUTBOUND", sentAt: { gt: message.sentAt } } }),
    prisma.message.count({ where: { threadId: thread.id, direction: "INBOUND", sentAt: { gt: message.sentAt } } }),
  ]);
  if (laterOutbound > 0 || laterInbound > 0) {
    await prisma.message.update({
      where: { id: message.id },
      data: { processingStatus: "PROCESSED", processedAt: now() },
    });
    const reason = laterOutbound > 0 ? "このメールには既に返信済みです" : "同じスレッドに新しいメールがあるため、そちらに返信します";
    await logActivity(userId, {
      type: "reply.skipped",
      entityType: "message",
      entityId: message.id,
      message: `「${message.subject}」には返信案を作りません: ${reason}`,
    });
    result.noReply += 1;
    result.processed += 1;
    return;
  }

  // 4. 返信しない条件の事前判定(返信案の生成を省く)
  const [newAgent, autoRepliesRecent] = await Promise.all([isNewAgent(agent), countAutoRepliesRecent(thread.id, now())]);
  const ageHours = (now().getTime() - message.sentAt.getTime()) / 3_600_000;
  const baseDecisionInput = {
    policy,
    agent: agent ? { status: agent.status, autoReplyEnabled: agent.autoReplyEnabled, requireApproval: agent.requireApproval } : null,
    category: analysis.category,
    analysisConfidence: analysis.confidence,
    needsReply: analysis.needs_reply,
    isNewAgent: newAgent,
    autoRepliesToday: autoRepliesRecent,
    threadMuted: thread.isMuted,
    messageIsAutoSubmitted: message.isAutoSubmitted,
    staleHours: ageHours >= getEnv().STALE_REPLY_HOURS ? ageHours : null,
  };
  const preDecision = decideReplyAction({ ...baseDecisionInput, draft: null });
  if (preDecision.action === "no_reply") {
    await prisma.message.update({
      where: { id: message.id },
      data: { processingStatus: "PROCESSED", processedAt: now() },
    });
    const closing = analysis.category === "THANKS_CLOSING" || analysis.category === "NEWSLETTER";
    await prisma.thread.update({
      where: { id: thread.id },
      data: closing && thread.status === "OPEN" ? { status: "CLOSED" } : {},
    });
    await logActivity(userId, {
      type: "reply.skipped",
      entityType: "message",
      entityId: message.id,
      message: `「${message.subject}」には返信しません: ${preDecision.reasons.join("、")}`,
    });
    result.noReply += 1;
    result.processed += 1;
    return;
  }

  // 5. 返信案の生成
  const draftResult = await ai.draftReply({
    ...analysisInput,
    policy,
    contact: thread.contact ? { name: thread.contact.name, email: thread.contact.email } : null,
    analysis,
  });
  const draft = draftResult.data;
  const decision = decideReplyAction({
    ...baseDecisionInput,
    draft: {
      commitments: draft.commitments,
      confidence: draft.confidence,
      requiresHumanReview: draft.requires_human_review,
      reviewReason: draft.review_reason,
      riskFlags: draft.risk_flags,
    },
  });
  const autoSend = decision.action === "auto_send";
  const scheduledFor = autoSend ? computeSendTime(now(), policy) : null;

  const reply = await prisma.reply.create({
    data: {
      userId,
      threadId: thread.id,
      inReplyToMessageId: message.id,
      subject: draft.subject.trim() || replySubject(message.subject),
      bodyText: draft.body.trim(),
      status: autoSend ? "SCHEDULED" : "PENDING_APPROVAL",
      decision: autoSend ? "AUTO" : "NEEDS_APPROVAL",
      decisionReasons: decision.reasons,
      commitments: draft.commitments,
      riskFlags: draft.risk_flags,
      confidence: draft.confidence,
      aiReasoning: draft.reasoning,
      scheduledFor,
      modelId: draftResult.model,
      promptVersion: PROMPT_VERSION,
      usage: { analysis: analysisResult.usage, draft: draftResult.usage } as Prisma.InputJsonValue,
    },
  });

  await prisma.thread.update({
    where: { id: thread.id },
    data: { summary: draft.thread_summary, status: autoSend ? "OPEN" : "NEEDS_ACTION" },
  });

  // 6. 案件ステージのヒント(手動で動かしていない NEW の案件のみ)
  if (draft.opportunity_stage_hint && draft.opportunity_stage_hint !== "NEW" && opportunityIds.length > 0) {
    await prisma.opportunity.updateMany({
      where: { id: { in: opportunityIds }, stage: "NEW" },
      data: { stage: draft.opportunity_stage_hint },
    });
  }

  await prisma.message.update({
    where: { id: message.id },
    data: { processingStatus: "PROCESSED", processedAt: now() },
  });

  if (autoSend) {
    result.autoScheduled += 1;
    await logActivity(userId, {
      type: "reply.scheduled",
      entityType: "reply",
      entityId: reply.id,
      message: `「${message.subject}」への返信を自動送信に予約しました(${scheduledFor?.toISOString()})`,
    });
  } else {
    result.needsApproval += 1;
    await logActivity(userId, {
      type: "reply.needs_approval",
      entityType: "reply",
      entityId: reply.id,
      message: `「${message.subject}」への返信案が承認待ちです: ${decision.reasons.join("、")}`,
    });
  }
  result.processed += 1;
}

/** 未処理の受信メールを分析し、返信案を作る */
export async function processPendingMessages(userId: string, options: ProcessOptions = {}): Promise<ProcessResult> {
  const ai = options.ai ?? defaultAiService;
  const now = options.now ?? (() => new Date());
  const limit = options.limit ?? 20;
  const result: ProcessResult = { processed: 0, autoScheduled: 0, needsApproval: 0, noReply: 0, errors: 0, deferred: 0 };

  const pending = await prisma.message.findMany({
    where: { processingStatus: "PENDING", direction: "INBOUND", thread: { userId } },
    orderBy: { sentAt: "asc" },
    take: limit,
    include: {
      thread: {
        include: { agent: true, contact: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  for (const [index, message] of pending.entries()) {
    if (options.deadline !== undefined && Date.now() > options.deadline) {
      result.deferred = pending.length - index;
      break;
    }
    try {
      await processOne(userId, message, ai, now, result);
    } catch (error) {
      result.errors += 1;
      const detail = error instanceof Error ? error.message : String(error);
      const code = error instanceof AiError ? error.code : "unknown";
      console.error(`[process] メッセージ ${message.id} の処理に失敗しました`, error);
      await prisma.message.update({
        where: { id: message.id },
        data: { processingStatus: "ERROR", processingError: detail, processedAt: now() },
      });
      await prisma.thread.update({ where: { id: message.threadId }, data: { status: "NEEDS_ACTION" } });
      await logActivity(userId, {
        type: "message.error",
        entityType: "message",
        entityId: message.id,
        message: `「${message.subject}」の処理に失敗しました: ${detail}`,
        metadata: { code },
      });
    }
  }
  return result;
}
