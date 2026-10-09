"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth/session";
import { sendReply } from "@/lib/pipeline/dispatch";
import { computeSendTime } from "@/lib/policy/schedule";
import { str } from "@/actions/form";

function revalidateReplyPages(threadId: string) {
  revalidatePath("/");
  revalidatePath("/approvals");
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${threadId}`);
  revalidatePath("/activity");
}

/**
 * 返信案に対する操作。フォームの submit ボタンの name="intent" で分岐する。
 * intent: save | approve | send_now | reject | cancel
 */
export async function replyFormAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const replyId = str(formData, "replyId");
  const intent = str(formData, "intent");
  const body = str(formData, "body");
  const returnTo = str(formData, "returnTo");

  const reply = await prisma.reply.findFirst({ where: { id: replyId, userId: user.id } });
  if (!reply) throw new Error("返信案が見つかりません");

  const newBody = body.length > 0 ? body : reply.bodyText;
  const edited = newBody !== reply.bodyText;

  switch (intent) {
    case "save": {
      await prisma.reply.update({
        where: { id: reply.id },
        data: { bodyText: newBody, editedByUser: reply.editedByUser || edited },
      });
      break;
    }
    case "approve": {
      if (!["PENDING_APPROVAL", "FAILED", "REJECTED", "CANCELLED"].includes(reply.status)) {
        throw new Error("この返信案は承認できる状態ではありません");
      }
      const policy = await prisma.replyPolicy.findUnique({ where: { userId: user.id } });
      const scheduledFor = policy ? computeSendTime(new Date(), policy) : new Date();
      await prisma.reply.update({
        where: { id: reply.id },
        data: {
          bodyText: newBody,
          editedByUser: reply.editedByUser || edited,
          status: "SCHEDULED",
          scheduledFor,
          approvedAt: new Date(),
          rejectedAt: null,
          errorMessage: null,
        },
      });
      await prisma.thread.update({ where: { id: reply.threadId }, data: { status: "OPEN" } });
      await logActivity(user.id, {
        type: "reply.approved",
        entityType: "reply",
        entityId: reply.id,
        message: `「${reply.subject}」を承認しました(送信予定 ${scheduledFor.toISOString()})${edited ? "。本文を編集済み" : ""}`,
      });
      break;
    }
    case "send_now": {
      if (!["PENDING_APPROVAL", "SCHEDULED", "FAILED", "REJECTED", "CANCELLED"].includes(reply.status)) {
        throw new Error("この返信案は送信できる状態ではありません");
      }
      await prisma.reply.update({
        where: { id: reply.id },
        data: {
          bodyText: newBody,
          editedByUser: reply.editedByUser || edited,
          status: "PENDING_APPROVAL",
          approvedAt: new Date(),
          rejectedAt: null,
          errorMessage: null,
        },
      });
      await logActivity(user.id, {
        type: "reply.approved",
        entityType: "reply",
        entityId: reply.id,
        message: `「${reply.subject}」を承認し、即時送信します`,
      });
      await sendReply(reply.id);
      break;
    }
    case "reject": {
      await prisma.reply.update({
        where: { id: reply.id },
        data: { status: "REJECTED", rejectedAt: new Date() },
      });
      await prisma.thread.update({ where: { id: reply.threadId }, data: { status: "OPEN" } });
      await logActivity(user.id, {
        type: "reply.rejected",
        entityType: "reply",
        entityId: reply.id,
        message: `「${reply.subject}」の返信案を却下しました`,
      });
      break;
    }
    case "cancel": {
      if (reply.status !== "SCHEDULED") throw new Error("送信予定の返信案のみ取り消せます");
      await prisma.reply.update({
        where: { id: reply.id },
        data: { status: "CANCELLED", errorMessage: "本人が取り消しました" },
      });
      await prisma.thread.update({ where: { id: reply.threadId }, data: { status: "NEEDS_ACTION" } });
      await logActivity(user.id, {
        type: "reply.cancelled",
        entityType: "reply",
        entityId: reply.id,
        message: `「${reply.subject}」の自動送信を取り消しました`,
      });
      break;
    }
    default:
      throw new Error(`不明な操作です: ${intent}`);
  }

  revalidateReplyPages(reply.threadId);
  if (returnTo) redirect(returnTo);
}
