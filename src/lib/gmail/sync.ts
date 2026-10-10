import type { gmail_v1 } from "googleapis";
import type { Agent } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logActivity } from "@/lib/activity";
import { defaultAiService, type AiService } from "@/lib/ai/service";
import { describeError, errorMessage, shouldRetryLater } from "@/lib/errors";
import { getGmailForUser, type GmailContext } from "@/lib/gmail/client";
import { parseGmailMessage, type ParsedGmailMessage } from "@/lib/gmail/parse";
import { createGmailCaller, GMAIL_UNITS, gmailUnitsBudget, type GmailCaller } from "@/lib/gmail/throttle";
import { isExcludedSender } from "@/lib/policy/exclusions";
import { extractDomain, isFreeMailDomain, looksLikeNoReply, truncate } from "@/lib/text";

export type SyncResult = {
  listed: number;
  fetched: number;
  ingested: number;
  skipped: number;
  /** AI の送信者判定の上限に達したため、次回の同期に回した件数 */
  deferred: number;
  newAgents: number;
  senderChecks: number;
  /** 時間切れや一時的なエラーで取り込まずに残した件数(次回の同期で取り込む) */
  remaining: number;
  errors: string[];
};

export type SyncDeps = {
  ai?: AiService;
  gmail?: GmailContext;
  now?: () => Date;
  /** この時刻(epoch ミリ秒)を過ぎたら新しいメールの取り込みを始めない */
  deadline?: number;
  /** Gmail API の呼び出し間隔の最小値(ミリ秒)。テストでは 0 にする */
  gmailMinIntervalMs?: number;
  /** Gmail API を 1 分あたりに使ってよい単位。省略時は GMAIL_QUOTA_UNITS_PER_MINUTE から求める。テストでは無制限にする */
  gmailUnitsPerMinute?: number;
  /** 待機処理(テストで差し替える) */
  sleep?: (ms: number) => Promise<void>;
};

/** 取り込まなかったメールの記録を残す日数(取り込み範囲の日数に足す) */
const SKIPPED_RETENTION_EXTRA_DAYS = 7;

type IngestOutcome = "ingested" | "skipped" | "deferred";

type SyncState = {
  userId: string;
  ctx: GmailContext;
  ai: AiService;
  domainToAgent: Map<string, Agent>;
  /** 返信ポリシーの「除外する送信者」(メールアドレスまたはドメイン) */
  excludedSenders: string[];
  senderChecks: number;
  senderCheckLimit: number;
  /** 判定上限で見送った最初のメールの受信時刻(次回の同期開始位置) */
  deferredFrom: Date | null;
  result: SyncResult;
};

/** AI の送信者判定をエージェントとして採用する確信度の下限。フリーランスエージェント以外を取り込まないよう高めにする */
const AGENT_CONFIDENCE_THRESHOLD = 0.7;

function buildQuery(lastSyncedAt: Date | null, fullWindow: boolean): string {
  const env = getEnv();
  const base = env.GMAIL_SYNC_QUERY?.trim() || "-in:spam -in:trash -in:chats";
  if (lastSyncedAt && !fullWindow) {
    // 取りこぼしを防ぐため1時間重ねて取得する(重複は ID で除外)
    const after = Math.floor((lastSyncedAt.getTime() - 60 * 60 * 1000) / 1000);
    return `${base} after:${after}`;
  }
  return `${base} newer_than:${env.GMAIL_SYNC_LOOKBACK_DAYS}d`;
}

async function listMessageIds(gmail: gmail_v1.Gmail, call: GmailCaller, query: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await call(() =>
      gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: Math.min(100, max - ids.length),
        pageToken,
      }),
      GMAIL_UNITS.list,
    );
    for (const m of data.messages ?? []) {
      if (m.id) ids.push(m.id);
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < max);
  return ids;
}

async function cancelPendingReplies(threadId: string, beforeMessageId: string | null, reason: string): Promise<number> {
  const result = await prisma.reply.updateMany({
    where: {
      threadId,
      status: { in: ["PENDING_APPROVAL", "SCHEDULED"] },
      ...(beforeMessageId ? { NOT: { inReplyToMessageId: beforeMessageId } } : {}),
    },
    data: { status: "CANCELLED", errorMessage: reason },
  });
  return result.count;
}

async function createAgentFromSender(state: SyncState, parsed: ParsedGmailMessage, companyName: string | null): Promise<Agent> {
  const domain = extractDomain(parsed.from.email);
  const corporate = domain !== "" && !isFreeMailDomain(domain);
  const name = companyName?.trim() || (corporate ? domain : parsed.from.name || parsed.from.email);
  const agent = await prisma.agent.create({
    data: {
      userId: state.userId,
      name,
      domains: corporate ? [domain] : [],
      notes: "メールの送信者から自動登録",
    },
  });
  if (corporate) state.domainToAgent.set(domain, agent);
  state.result.newAgents += 1;
  await logActivity(state.userId, {
    type: "agent.created",
    entityType: "agent",
    entityId: agent.id,
    message: `エージェント「${name}」を自動登録しました(${parsed.from.email})`,
  });
  return agent;
}

/** 未知の送信者がエージェントか判定し、必要ならエージェントを作成する */
async function resolveAgentForInbound(state: SyncState, parsed: ParsedGmailMessage): Promise<Agent | null | "deferred"> {
  const email = parsed.from.email;
  const domain = extractDomain(email);

  // 1. 一斉配信(List-Unsubscribe など)、自動送信、no-reply のメールは、既知のエージェントのドメインでも取り込まない。
  //    判定結果は記録しない(同じ送信者から個別のメールが届いたときは、あらためて判定する)。
  //    設定で除外した送信者は、ingestParsedMessage の先頭で取り込みを止めている
  if (parsed.isBulk || parsed.isAutoSubmitted || looksLikeNoReply(email)) return null;

  // 2. 既知のエージェントのドメイン
  const byDomain = state.domainToAgent.get(domain);
  if (byDomain) return byDomain;

  // 3. 判定済みの送信者
  const verdict = await prisma.senderVerdict.findUnique({
    where: { userId_email: { userId: state.userId, email } },
  });
  if (verdict?.kind === "NOT_AGENT") return null;
  if (verdict?.kind === "AGENT") {
    const contact = await prisma.contact.findUnique({
      where: { userId_email: { userId: state.userId, email } },
      include: { agent: true },
    });
    if (contact) return contact.agent;
  }

  // 4. AI による判定(1 回の同期で上限まで)
  if (state.senderChecks >= state.senderCheckLimit) {
    if (!state.deferredFrom || parsed.sentAt < state.deferredFrom) state.deferredFrom = parsed.sentAt;
    return "deferred";
  }

  state.senderChecks += 1;
  state.result.senderChecks += 1;
  const { data: check } = await state.ai.checkSender({
    fromName: parsed.from.name,
    fromEmail: email,
    subject: parsed.subject,
    snippet: truncate(parsed.bodyText, 1500),
  });

  if (check.is_freelance_agent && check.confidence >= AGENT_CONFIDENCE_THRESHOLD) {
    const agent = await createAgentFromSender(state, parsed, check.company_name);
    await prisma.senderVerdict.upsert({
      where: { userId_email: { userId: state.userId, email } },
      create: { userId: state.userId, email, domain, kind: "AGENT", reason: check.reason },
      update: { kind: "AGENT", reason: check.reason },
    });
    return agent;
  }

  await prisma.senderVerdict.upsert({
    where: { userId_email: { userId: state.userId, email } },
    create: { userId: state.userId, email, domain, kind: "NOT_AGENT", reason: check.reason },
    update: { kind: "NOT_AGENT", reason: check.reason },
  });
  return null;
}

async function ingestParsedMessage(state: SyncState, parsed: ParsedGmailMessage): Promise<IngestOutcome> {
  const { userId, ctx } = state;
  const isOutbound = parsed.from.email === ctx.accountEmail || parsed.labelIds.includes("SENT");
  const direction = isOutbound ? "OUTBOUND" : "INBOUND";

  // 設定で除外した送信者からの受信メールは、既存のスレッド宛てでも、既知のエージェントのドメインでも取り込まない
  if (!isOutbound && isExcludedSender(parsed.from.email, state.excludedSenders)) {
    const reason = "設定で除外した送信者";
    await prisma.senderVerdict.upsert({
      where: { userId_email: { userId, email: parsed.from.email } },
      create: { userId, email: parsed.from.email, domain: extractDomain(parsed.from.email), kind: "NOT_AGENT", reason },
      update: { kind: "NOT_AGENT", reason },
    });
    return "skipped";
  }

  const existingThread = await prisma.thread.findUnique({
    where: { userId_gmailThreadId: { userId, gmailThreadId: parsed.gmailThreadId } },
  });

  let threadId: string;
  let agentId: string | null;

  if (existingThread) {
    threadId = existingThread.id;
    agentId = existingThread.agentId;
  } else if (isOutbound) {
    // 本人が Gmail から新規に送ったメール。宛先が既知の担当者ならスレッドを作る
    const recipients = [...parsed.to, ...parsed.cc].map((a) => a.email);
    const contact = await prisma.contact.findFirst({
      where: { userId, email: { in: recipients } },
    });
    if (!contact) return "skipped";
    const thread = await prisma.thread.create({
      data: {
        userId,
        agentId: contact.agentId,
        contactId: contact.id,
        gmailThreadId: parsed.gmailThreadId,
        subject: parsed.subject,
        snippet: truncate(parsed.snippet, 200),
        status: "WAITING_THEM",
        lastMessageAt: parsed.sentAt,
        lastOutboundAt: parsed.sentAt,
      },
    });
    threadId = thread.id;
    agentId = contact.agentId;
  } else {
    const resolved = await resolveAgentForInbound(state, parsed);
    if (resolved === "deferred") return "deferred";
    if (resolved === null) return "skipped";
    const agent = resolved;
    const contact = await prisma.contact.upsert({
      where: { userId_email: { userId, email: parsed.from.email } },
      create: {
        userId,
        agentId: agent.id,
        email: parsed.from.email,
        name: parsed.from.name,
        lastContactAt: parsed.sentAt,
      },
      update: { name: parsed.from.name ?? undefined, lastContactAt: parsed.sentAt },
    });
    const thread = await prisma.thread.create({
      data: {
        userId,
        agentId: agent.id,
        contactId: contact.id,
        gmailThreadId: parsed.gmailThreadId,
        subject: parsed.subject,
        snippet: truncate(parsed.snippet, 200),
        status: "OPEN",
        lastMessageAt: parsed.sentAt,
        lastInboundAt: parsed.sentAt,
      },
    });
    threadId = thread.id;
    agentId = agent.id;
  }

  const message = await prisma.message.create({
    data: {
      threadId,
      gmailMessageId: parsed.gmailMessageId,
      direction,
      fromEmail: parsed.from.email,
      fromName: parsed.from.name,
      toEmails: parsed.to.map((a) => a.email),
      ccEmails: parsed.cc.map((a) => a.email),
      subject: parsed.subject,
      bodyText: parsed.bodyText,
      snippet: truncate(parsed.snippet, 200),
      sentAt: parsed.sentAt,
      rfcMessageId: parsed.rfcMessageId,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references,
      isAutoSubmitted: parsed.isAutoSubmitted,
      processingStatus: direction === "INBOUND" && agentId ? "PENDING" : "PROCESSED",
      processedAt: direction === "INBOUND" && agentId ? null : parsed.sentAt,
    },
  });

  if (existingThread) {
    if (isOutbound) {
      const cancelled = await cancelPendingReplies(threadId, null, "本人が Gmail から返信したため取り消しました");
      await prisma.thread.update({
        where: { id: threadId },
        data: {
          status: existingThread.status === "CLOSED" || existingThread.status === "ARCHIVED" ? existingThread.status : "WAITING_THEM",
          lastMessageAt: parsed.sentAt,
          lastOutboundAt: parsed.sentAt,
          snippet: truncate(parsed.snippet, 200),
        },
      });
      if (cancelled > 0) {
        await logActivity(userId, {
          type: "reply.cancelled",
          entityType: "thread",
          entityId: threadId,
          message: `本人が Gmail から返信したため、返信案 ${cancelled} 件を取り消しました`,
        });
      }
    } else {
      // 相手から新しいメールが来たので、古いメールへの未送信返信案は取り消す
      const cancelled = await cancelPendingReplies(threadId, message.id, "新しいメールを受信したため取り消しました");
      await prisma.contact.updateMany({
        where: { userId, email: parsed.from.email },
        data: { lastContactAt: parsed.sentAt, name: parsed.from.name ?? undefined },
      });
      await prisma.thread.update({
        where: { id: threadId },
        data: {
          status: "OPEN",
          lastMessageAt: parsed.sentAt,
          lastInboundAt: parsed.sentAt,
          snippet: truncate(parsed.snippet, 200),
        },
      });
      if (cancelled > 0) {
        await logActivity(userId, {
          type: "reply.cancelled",
          entityType: "thread",
          entityId: threadId,
          message: `新しいメールを受信したため、古い返信案 ${cancelled} 件を取り消しました`,
        });
      }
    }
  }

  return "ingested";
}

/** ユーザーの Gmail から新着メールを取り込む */
export async function syncUserMailbox(userId: string, deps: SyncDeps = {}): Promise<SyncResult> {
  const env = getEnv();
  const now = deps.now ?? (() => new Date());
  const ctx = deps.gmail ?? (await getGmailForUser(userId));
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  const startedAt = now();

  const result: SyncResult = {
    listed: 0,
    fetched: 0,
    ingested: 0,
    skipped: 0,
    deferred: 0,
    newAgents: 0,
    senderChecks: 0,
    remaining: 0,
    errors: [],
  };
  const call = createGmailCaller({
    unitsPerMinute: deps.gmailUnitsPerMinute ?? gmailUnitsBudget(env.GMAIL_QUOTA_UNITS_PER_MINUTE),
    minIntervalMs: deps.gmailMinIntervalMs,
    sleep: deps.sleep,
    deadline: deps.deadline,
  });
  const [agents, policy] = await Promise.all([
    prisma.agent.findMany({ where: { userId } }),
    prisma.replyPolicy.findUnique({ where: { userId }, select: { excludedSenders: true } }),
  ]);
  const domainToAgent = new Map<string, Agent>();
  for (const agent of agents) {
    for (const domain of agent.domains) domainToAgent.set(domain.toLowerCase(), agent);
  }
  const state: SyncState = {
    userId,
    ctx,
    ai: deps.ai ?? defaultAiService,
    domainToAgent,
    senderChecks: 0,
    senderCheckLimit: env.SENDER_CHECKS_PER_SYNC,
    excludedSenders: policy?.excludedSenders ?? [],
    deferredFrom: null,
    result,
  };

  try {
    // 初回や取り込み範囲を広げた後は、範囲全体を一覧する(取り込み済み・除外済みのメールは取得しない)
    const fullWindow = (account?.syncedLookbackDays ?? 0) < env.GMAIL_SYNC_LOOKBACK_DAYS;
    const query = buildQuery(account?.lastSyncedAt ?? null, fullWindow);
    const ids = await listMessageIds(ctx.gmail, call, query, env.GMAIL_SYNC_MAX_MESSAGES);
    result.listed = ids.length;

    // 取り込み済みのメールと、前回までに除外したメールは取得し直さない
    const [knownMessages, knownSkipped] = await Promise.all([
      prisma.message.findMany({ where: { gmailMessageId: { in: ids } }, select: { gmailMessageId: true } }),
      prisma.skippedMessage.findMany({ where: { userId, gmailMessageId: { in: ids } }, select: { gmailMessageId: true } }),
    ]);
    const knownIds = new Set([...knownMessages, ...knownSkipped].map((m) => m.gmailMessageId));
    const newIds = ids.filter((id) => !knownIds.has(id)).reverse(); // 古い順に処理

    const skippedIds: string[] = [];
    const flushSkipped = async () => {
      const batch = skippedIds.splice(0);
      if (batch.length === 0) return;
      await prisma.skippedMessage.createMany({
        data: batch.map((gmailMessageId) => ({ userId, gmailMessageId })),
        skipDuplicates: true,
      });
    };

    for (const [index, id] of newIds.entries()) {
      if (deps.deadline !== undefined && Date.now() > deps.deadline) {
        result.remaining = newIds.length - index;
        break;
      }
      try {
        const { data } = await call(() => ctx.gmail.users.messages.get({ userId: "me", id, format: "full" }), GMAIL_UNITS.get);
        result.fetched += 1;
        const parsed = parseGmailMessage(data);
        const outcome = await ingestParsedMessage(state, parsed);
        if (outcome === "ingested") result.ingested += 1;
        else if (outcome === "deferred") result.deferred += 1;
        else {
          result.skipped += 1;
          skippedIds.push(id);
        }
      } catch (error) {
        if (shouldRetryLater(error)) {
          // 利用上限や通信の失敗、API キーやログインの問題。このメールから先は次回の同期で取り込む(同期位置は進めない)
          console.error(`[sync] メッセージ ${id} の取り込みを中断し、次回に回します`, error);
          result.errors.push(describeError(error));
          result.remaining = newIds.length - index;
          break;
        }
        // このメール固有の失敗。同期が先に進めなくなるのを防ぐため、このメールは飛ばす
        console.error(`[sync] メッセージ ${id} の取り込みに失敗したため、飛ばします`, error);
        result.errors.push(`message ${id}: ${errorMessage(error)}`);
        result.skipped += 1;
        skippedIds.push(id);
      }
      if (skippedIds.length >= 50) await flushSkipped();
    }
    await flushSkipped();

    // 取り込み範囲より十分古い除外記録は消す
    const retentionDays = env.GMAIL_SYNC_LOOKBACK_DAYS + SKIPPED_RETENTION_EXTRA_DAYS;
    await prisma.skippedMessage.deleteMany({
      where: { userId, createdAt: { lt: new Date(startedAt.getTime() - retentionDays * 86_400_000) } },
    });

    if (account) {
      // 時間切れなどで残したメールがある場合は同期位置を進めない(次回、同じ範囲を取得し既知の ID を除外して続きから取り込む)
      const nextSyncedAt =
        result.remaining > 0
          ? account.lastSyncedAt
          : state.deferredFrom && state.deferredFrom < startedAt
            ? state.deferredFrom
            : startedAt;
      // 範囲全体を残さず取り込めたら、次回からは前回の同期以降だけを取得する
      const windowCompleted = fullWindow && result.remaining === 0 && state.deferredFrom === null;
      await prisma.googleAccount.update({
        where: { id: account.id },
        data: {
          lastSyncedAt: nextSyncedAt,
          lastSyncError: result.errors.length > 0 ? result.errors[0] : null,
          ...(windowCompleted ? { syncedLookbackDays: env.GMAIL_SYNC_LOOKBACK_DAYS } : {}),
        },
      });
    }
  } catch (error) {
    const message = describeError(error);
    result.errors.push(message);
    if (account) {
      await prisma.googleAccount.update({ where: { id: account.id }, data: { lastSyncError: message } });
    }
    throw error;
  }

  const carriedOver = result.remaining + result.deferred;
  await logActivity(userId, {
    type: "sync.completed",
    message: `Gmail 同期: ${result.ingested} 件取り込み、${result.skipped} 件除外、新規エージェント ${result.newAgents} 件${carriedOver > 0 ? `、${carriedOver} 件は次回に取り込み` : ""}`,
    metadata: { ...result },
  });
  return result;
}
