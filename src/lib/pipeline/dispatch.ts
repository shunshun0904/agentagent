import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getGmailForUser, type GmailContext } from "@/lib/gmail/client";
import { buildReferences } from "@/lib/gmail/mime";
import { sendGmailReply } from "@/lib/gmail/send";
import { truncate, unique } from "@/lib/text";

export type DispatchOptions = {
  gmail?: GmailContext;
  now?: () => Date;
  limit?: number;
};

export type SendOutcome = { ok: true; gmailMessageId: string } | { ok: false; reason: string };

/** 返信案を実際に Gmail で送信する(予約送信・承認後送信・即時送信の共通処理) */
export async function sendReply(replyId: string, options: DispatchOptions = {}): Promise<SendOutcome> {
  const now = options.now ?? (() => new Date());

  // 二重送信を防ぐため、先に SENDING へ遷移させる(1件だけ更新できた場合のみ続行)
  const claimed = await prisma.reply.updateMany({
    where: { id: replyId, status: { in: ["SCHEDULED", "PENDING_APPROVAL"] } },
    data: { status: "SENDING" },
  });
  if (claimed.count !== 1) return { ok: false, reason: "この返信案は既に処理されています" };

  const reply = await prisma.reply.findUniqueOrThrow({
    where: { id: replyId },
    include: {
      thread: true,
      inReplyToMessage: true,
      user: { include: { profile: true, policy: true } },
    },
  });

  try {
    const ctx = options.gmail ?? (await getGmailForUser(reply.userId));
    const original =
      reply.inReplyToMessage ??
      (await prisma.message.findFirst({
        where: { threadId: reply.threadId, direction: "INBOUND" },
        orderBy: { sentAt: "desc" },
      }));
    if (!original) throw new Error("返信先のメールが見つかりません");

    const fromName = reply.user.profile?.displayName ?? null;
    const from = { name: fromName, email: ctx.accountEmail };
    const to = [{ name: original.fromName, email: original.fromEmail }];
    const replyAll = reply.user.policy?.replyAll ?? true;
    const cc = replyAll
      ? unique([...original.toEmails, ...original.ccEmails])
          .filter((email) => email !== ctx.accountEmail && email !== original.fromEmail)
          .map((email) => ({ name: null, email }))
      : [];

    const sent = await sendGmailReply(ctx, {
      gmailThreadId: reply.thread.gmailThreadId,
      from,
      to,
      cc,
      subject: reply.subject,
      bodyText: reply.bodyText,
      inReplyTo: original.rfcMessageId,
      references: original.references,
    });

    const sentAt = now();
    // 同期処理が先に取り込んでいる可能性があるので upsert にする
    await prisma.message.upsert({
      where: { gmailMessageId: sent.gmailMessageId },
      create: {
        threadId: reply.threadId,
        gmailMessageId: sent.gmailMessageId,
        direction: "OUTBOUND",
        fromEmail: ctx.accountEmail,
        fromName,
        toEmails: to.map((a) => a.email),
        ccEmails: cc.map((a) => a.email),
        subject: reply.subject,
        bodyText: reply.bodyText,
        snippet: truncate(reply.bodyText.replace(/\s+/g, " "), 200),
        sentAt,
        rfcMessageId: sent.rfcMessageId,
        inReplyTo: original.rfcMessageId,
        references: buildReferences(original.references, original.rfcMessageId),
        processingStatus: "PROCESSED",
        processedAt: sentAt,
      },
      update: {},
    });
    await prisma.reply.update({
      where: { id: replyId },
      data: { status: "SENT", sentAt, sentGmailMessageId: sent.gmailMessageId, errorMessage: null },
    });
    await prisma.thread.update({
      where: { id: reply.threadId },
      data: { status: "WAITING_THEM", lastMessageAt: sentAt, lastOutboundAt: sentAt },
    });
    await logActivity(reply.userId, {
      type: "reply.sent",
      entityType: "reply",
      entityId: replyId,
      message: `「${reply.subject}」を ${to[0]?.email ?? ""} に送信しました(${reply.decision === "AUTO" ? "自動" : reply.decision === "MANUAL" ? "手動" : "承認済み"})`,
    });
    return { ok: true, gmailMessageId: sent.gmailMessageId };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[dispatch] 返信 ${replyId} の送信に失敗しました`, error);
    await prisma.reply.update({ where: { id: replyId }, data: { status: "FAILED", errorMessage: detail } });
    await prisma.thread.update({ where: { id: reply.threadId }, data: { status: "NEEDS_ACTION" } });
    await logActivity(reply.userId, {
      type: "reply.failed",
      entityType: "reply",
      entityId: replyId,
      message: `「${reply.subject}」の送信に失敗しました: ${detail}`,
    });
    return { ok: false, reason: detail };
  }
}

/** 送信予定時刻を過ぎた返信案を送信する */
export async function dispatchDueReplies(userId: string, options: DispatchOptions = {}): Promise<{ sent: number; failed: number }> {
  const now = options.now ?? (() => new Date());
  const due = await prisma.reply.findMany({
    where: { userId, status: "SCHEDULED", scheduledFor: { lte: now() } },
    orderBy: { scheduledFor: "asc" },
    take: options.limit ?? 20,
    select: { id: true },
  });
  let sent = 0;
  let failed = 0;
  for (const { id } of due) {
    const outcome = await sendReply(id, options);
    if (outcome.ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}
