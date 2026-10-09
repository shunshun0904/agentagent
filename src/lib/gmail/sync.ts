import type { gmail_v1 } from "googleapis";
import type { Agent } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logActivity } from "@/lib/activity";
import { defaultAiService, type AiService } from "@/lib/ai/service";
import { getGmailForUser, type GmailContext } from "@/lib/gmail/client";
import { parseGmailMessage, type ParsedGmailMessage } from "@/lib/gmail/parse";
import { extractDomain, isFreeMailDomain, looksLikeNoReply, truncate } from "@/lib/text";

export type SyncResult = {
  listed: number;
  fetched: number;
  ingested: number;
  skipped: number;
  newAgents: number;
  senderChecks: number;
  errors: string[];
};

export type SyncDeps = {
  ai?: AiService;
  gmail?: GmailContext;
  now?: () => Date;
};

type IngestOutcome = "ingested" | "skipped";

type SyncState = {
  userId: string;
  ctx: GmailContext;
  ai: AiService;
  domainToAgent: Map<string, Agent>;
  senderChecks: number;
  senderCheckLimit: number;
  /** 判定上限で見送った最初のメールの受信時刻(次回の同期開始位置) */
  deferredFrom: Date | null;
  result: SyncResult;
};

function buildQuery(lastSyncedAt: Date | null): string {
  const env = getEnv();
  const base = env.GMAIL_SYNC_QUERY?.trim() || "-in:spam -in:trash -in:chats";
  if (lastSyncedAt) {
    // 取りこぼしを防ぐため1時間重ねて取得する(重複は ID で除外)
    const after = Math.floor((lastSyncedAt.getTime() - 60 * 60 * 1000) / 1000);
    return `${base} after:${after}`;
  }
  return `${base} newer_than:${env.GMAIL_SYNC_LOOKBACK_DAYS}d`;
}

async function listMessageIds(gmail: gmail_v1.Gmail, query: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: Math.min(100, max - ids.length),
      pageToken,
    });
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

  const byDomain = state.domainToAgent.get(domain);
  if (byDomain) return byDomain;

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

  // 一斉配信や自動送信アドレスからの未知の送信者は判定せずに除外する
  if (parsed.isBulk || parsed.isAutoSubmitted || looksLikeNoReply(email)) {
    await prisma.senderVerdict.upsert({
      where: { userId_email: { userId: state.userId, email } },
      create: { userId: state.userId, email, domain, kind: "NOT_AGENT", reason: "一斉配信または自動送信アドレス" },
      update: {},
    });
    return null;
  }

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

  if (check.is_freelance_agent && check.confidence >= 0.6) {
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
    if (resolved === "deferred" || resolved === null) return "skipped";
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
      if (existingThread.contactId === null || parsed.from.email !== undefined) {
        await prisma.contact.updateMany({
          where: { userId, email: parsed.from.email },
          data: { lastContactAt: parsed.sentAt, name: parsed.from.name ?? undefined },
        });
      }
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

  const result: SyncResult = { listed: 0, fetched: 0, ingested: 0, skipped: 0, newAgents: 0, senderChecks: 0, errors: [] };
  const agents = await prisma.agent.findMany({ where: { userId } });
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
    deferredFrom: null,
    result,
  };

  try {
    const query = buildQuery(account?.lastSyncedAt ?? null);
    const ids = await listMessageIds(ctx.gmail, query, env.GMAIL_SYNC_MAX_MESSAGES);
    result.listed = ids.length;

    const known = await prisma.message.findMany({
      where: { gmailMessageId: { in: ids } },
      select: { gmailMessageId: true },
    });
    const knownIds = new Set(known.map((m) => m.gmailMessageId));
    const newIds = ids.filter((id) => !knownIds.has(id)).reverse(); // 古い順に処理

    for (const id of newIds) {
      try {
        const { data } = await ctx.gmail.users.messages.get({ userId: "me", id, format: "full" });
        result.fetched += 1;
        const parsed = parseGmailMessage(data);
        const outcome = await ingestParsedMessage(state, parsed);
        if (outcome === "ingested") result.ingested += 1;
        else result.skipped += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`message ${id}: ${message}`);
        console.error(`[sync] メッセージ ${id} の取り込みに失敗しました`, error);
      }
    }

    if (account) {
      const nextSyncedAt = state.deferredFrom && state.deferredFrom < startedAt ? state.deferredFrom : startedAt;
      await prisma.googleAccount.update({
        where: { id: account.id },
        data: { lastSyncedAt: nextSyncedAt, lastSyncError: result.errors.length > 0 ? result.errors[0] : null },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
    if (account) {
      await prisma.googleAccount.update({ where: { id: account.id }, data: { lastSyncError: message } });
    }
    throw error;
  }

  await logActivity(userId, {
    type: "sync.completed",
    message: `Gmail 同期: ${result.ingested} 件取り込み、${result.skipped} 件除外、新規エージェント ${result.newAgents} 件`,
    metadata: { ...result },
  });
  return result;
}
