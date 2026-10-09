"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth/session";
import { replySubject } from "@/lib/gmail/mime";
import { sendReply } from "@/lib/pipeline/dispatch";
import { processPendingMessages } from "@/lib/pipeline/process-message";
import { computeSendTime } from "@/lib/policy/schedule";
import { oneOf, str } from "@/actions/form";

const THREAD_STATUSES = ["OPEN", "WAITING_THEM", "NEEDS_ACTION", "CLOSED", "ARCHIVED"] as const;

function revalidateThread(threadId: string) {
  revalidatePath("/");
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${threadId}`);
  revalidatePath("/approvals");
  revalidatePath("/activity");
}

export async function threadStatusAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const threadId = str(formData, "threadId");
  const status = oneOf(formData, "status", THREAD_STATUSES);
  if (!status) throw new Error("不正なステータスです");
  const thread = await prisma.thread.findFirst({ where: { id: threadId, userId: user.id } });
  if (!thread) throw new Error("スレッドが見つかりません");
  await prisma.thread.update({ where: { id: thread.id }, data: { status } });
  revalidateThread(thread.id);
}

export async function threadMuteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const threadId = str(formData, "threadId");
  const thread = await prisma.thread.findFirst({ where: { id: threadId, userId: user.id } });
  if (!thread) throw new Error("スレッドが見つかりません");
  await prisma.thread.update({ where: { id: thread.id }, data: { isMuted: !thread.isMuted } });
  await logActivity(user.id, {
    type: "thread.muted",
    entityType: "thread",
    entityId: thread.id,
    message: `「${thread.subject}」の自動返信を${thread.isMuted ? "再開" : "停止"}しました`,
  });
  revalidateThread(thread.id);
}

/** 本人が書いた返信を送る。intent: send(即時) | schedule(営業時間内に予約) */
export async function manualReplyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const threadId = str(formData, "threadId");
  const body = str(formData, "body");
  const intent = str(formData, "intent") || "send";
  if (body.length === 0) throw new Error("本文を入力してください");

  const thread = await prisma.thread.findFirst({
    where: { id: threadId, userId: user.id },
    include: { messages: { where: { direction: "INBOUND" }, orderBy: { sentAt: "desc" }, take: 1 } },
  });
  if (!thread) throw new Error("スレッドが見つかりません");
  const original = thread.messages[0];
  if (!original) throw new Error("返信先の受信メールがありません");

  const policy = await prisma.replyPolicy.findUnique({ where: { userId: user.id } });
  const schedule = intent === "schedule";
  const scheduledFor = schedule && policy ? computeSendTime(new Date(), policy) : new Date();

  const reply = await prisma.reply.create({
    data: {
      userId: user.id,
      threadId: thread.id,
      inReplyToMessageId: original.id,
      subject: replySubject(original.subject),
      bodyText: body,
      status: schedule ? "SCHEDULED" : "PENDING_APPROVAL",
      decision: "MANUAL",
      decisionReasons: ["本人が作成"],
      commitments: [],
      confidence: 1,
      scheduledFor,
      approvedAt: new Date(),
      editedByUser: true,
    },
  });
  await logActivity(user.id, {
    type: "reply.manual",
    entityType: "reply",
    entityId: reply.id,
    message: `「${thread.subject}」に手動で返信を作成しました(${schedule ? "予約送信" : "即時送信"})`,
  });
  if (!schedule) {
    await sendReply(reply.id);
  }
  revalidateThread(thread.id);
}

/** 処理に失敗した受信メールを再処理する */
export async function reprocessMessageAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const messageId = str(formData, "messageId");
  const message = await prisma.message.findFirst({ where: { id: messageId, thread: { userId: user.id } } });
  if (!message) throw new Error("メールが見つかりません");
  await prisma.message.update({
    where: { id: message.id },
    data: { processingStatus: "PENDING", processingError: null, processedAt: null },
  });
  await processPendingMessages(user.id, { limit: 5 });
  revalidateThread(message.threadId);
  redirect(`/inbox/${message.threadId}`);
}
