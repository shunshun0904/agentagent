import type { GmailContext } from "@/lib/gmail/client";
import { buildReplyRaw } from "@/lib/gmail/mime";
import type { ParsedAddress } from "@/lib/gmail/parse";

export type SendReplyParams = {
  gmailThreadId: string;
  from: ParsedAddress;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  subject: string;
  bodyText: string;
  inReplyTo: string | null;
  references: string | null;
};

export type SendReplyResult = {
  gmailMessageId: string;
  gmailThreadId: string;
  rfcMessageId: string;
};

/** 既存スレッドへの返信として送信する */
export async function sendGmailReply(ctx: GmailContext, params: SendReplyParams): Promise<SendReplyResult> {
  const { raw, messageId } = buildReplyRaw({
    from: params.from,
    to: params.to,
    cc: params.cc,
    subject: params.subject,
    bodyText: params.bodyText,
    inReplyTo: params.inReplyTo,
    references: params.references,
  });
  const response = await ctx.gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId: params.gmailThreadId },
  });
  if (!response.data.id) {
    throw new Error("Gmail から送信結果のメッセージ ID が返りませんでした");
  }
  return {
    gmailMessageId: response.data.id,
    gmailThreadId: response.data.threadId ?? params.gmailThreadId,
    rfcMessageId: messageId,
  };
}
