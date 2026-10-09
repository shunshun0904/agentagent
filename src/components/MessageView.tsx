import type { Message } from "@/generated/prisma/client";
import { reprocessMessageAction } from "@/actions/threads";
import { CategoryBadge } from "@/components/badges";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { formatDateTime, formatPercent } from "@/lib/format";

export function MessageView({ message }: { message: Message }) {
  const inbound = message.direction === "INBOUND";
  return (
    <article className={`rounded-xl border px-5 py-4 ${inbound ? "border-slate-200 bg-white" : "border-indigo-100 bg-indigo-50/40"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-800">
            {inbound ? "受信" : "送信"}: {message.fromName ?? message.fromEmail}
            <span className="ml-1 text-xs font-normal text-slate-500">&lt;{message.fromEmail}&gt;</span>
          </div>
          <div className="text-xs text-slate-500">
            {formatDateTime(message.sentAt)}
            {message.toEmails.length > 0 && <> ・ 宛先 {message.toEmails.join(", ")}</>}
            {message.ccEmails.length > 0 && <> ・ CC {message.ccEmails.join(", ")}</>}
          </div>
        </div>
        {inbound && (
          <div className="flex items-center gap-1.5">
            <CategoryBadge category={message.category} />
            {message.confidence !== null && <span className="text-xs text-slate-400">{formatPercent(message.confidence)}</span>}
          </div>
        )}
      </div>
      {inbound && message.aiSummary && <p className="mt-2 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-600">要約: {message.aiSummary}</p>}
      {inbound && message.processingStatus === "PENDING" && (
        <p className="mt-2 text-xs text-amber-700">AI による分析待ち(次回の同期で処理されます)</p>
      )}
      {inbound && message.processingStatus === "ERROR" && (
        <form action={reprocessMessageAction} className="mt-2 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <input type="hidden" name="messageId" value={message.id} />
          <span className="flex-1">処理に失敗しました: {message.processingError}</span>
          <SubmitButton className="btn-secondary px-2 py-1 text-xs" pendingText="再処理中…">
            再処理
          </SubmitButton>
        </form>
      )}
      <div className="mail-body mt-3 text-[13px] text-slate-800">{message.bodyText}</div>
    </article>
  );
}
