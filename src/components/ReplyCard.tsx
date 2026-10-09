import type { Reply } from "@/generated/prisma/client";
import { replyFormAction } from "@/actions/replies";
import { ReplyDecisionBadge, ReplyStatusBadge } from "@/components/badges";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { COMMITMENT_LABELS, formatDateTime, formatPercent } from "@/lib/format";

export function ReplyCard({ reply, returnTo, header }: { reply: Reply; returnTo: string; header?: React.ReactNode }) {
  const editable = ["PENDING_APPROVAL", "FAILED", "REJECTED", "CANCELLED"].includes(reply.status);
  const scheduled = reply.status === "SCHEDULED";
  const commitments = reply.commitments.filter((c) => c !== "none");

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ReplyStatusBadge status={reply.status} />
          <ReplyDecisionBadge decision={reply.decision} />
          {reply.confidence !== null && <span className="text-xs text-slate-500">確信度 {formatPercent(reply.confidence)}</span>}
          {reply.editedByUser && <span className="text-xs text-slate-500">本人が編集</span>}
        </div>
        <div className="text-xs text-slate-500">
          {reply.status === "SENT" && reply.sentAt ? `送信 ${formatDateTime(reply.sentAt)}` : null}
          {scheduled && reply.scheduledFor ? `送信予定 ${formatDateTime(reply.scheduledFor)}` : null}
          {reply.status === "PENDING_APPROVAL" ? `作成 ${formatDateTime(reply.createdAt)}` : null}
        </div>
      </div>
      {header && <div className="border-b border-slate-100 px-5 py-3">{header}</div>}
      <div className="space-y-3 px-5 py-4">
        {(reply.decisionReasons.length > 0 || commitments.length > 0 || reply.riskFlags.length > 0) && (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {reply.decisionReasons.length > 0 && (
              <div>
                <span className="font-semibold">判定: </span>
                {reply.decisionReasons.join(" / ")}
              </div>
            )}
            {commitments.length > 0 && (
              <div className="mt-1">
                <span className="font-semibold">返信に含まれる内容: </span>
                {commitments.map((c) => COMMITMENT_LABELS[c] ?? c).join("、")}
              </div>
            )}
            {reply.riskFlags.length > 0 && (
              <div className="mt-1 text-amber-800">
                <span className="font-semibold">確認ポイント: </span>
                {reply.riskFlags.join("、")}
              </div>
            )}
            {reply.errorMessage && reply.status === "FAILED" && (
              <div className="mt-1 text-rose-700">
                <span className="font-semibold">エラー: </span>
                {reply.errorMessage}
              </div>
            )}
          </div>
        )}
        {reply.aiReasoning && (
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer select-none font-medium text-slate-700">AI の判断理由</summary>
            <p className="mt-1 leading-5">{reply.aiReasoning}</p>
            {reply.modelId && (
              <p className="mt-1 text-slate-400">
                モデル: {reply.modelId} / プロンプト: {reply.promptVersion}
              </p>
            )}
          </details>
        )}

        <form action={replyFormAction} className="space-y-3">
          <input type="hidden" name="replyId" value={reply.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <div>
            <div className="mb-1 text-xs text-slate-500">件名: {reply.subject}</div>
            {editable ? (
              <textarea name="body" defaultValue={reply.bodyText} rows={Math.min(24, Math.max(8, reply.bodyText.split("\n").length + 2))} className="input font-mono text-[13px] leading-6" />
            ) : (
              <pre className="mail-body rounded-md border border-slate-100 bg-slate-50 px-3 py-2 font-sans text-[13px] text-slate-800">{reply.bodyText}</pre>
            )}
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="intent" value="approve" className="btn-primary">
                承認して送信予約
              </SubmitButton>
              <SubmitButton name="intent" value="send_now" className="btn-secondary" pendingText="送信中…">
                今すぐ送信
              </SubmitButton>
              <SubmitButton name="intent" value="save" className="btn-secondary">
                下書きを保存
              </SubmitButton>
              {reply.status === "PENDING_APPROVAL" && (
                <SubmitButton name="intent" value="reject" className="btn-danger">
                  却下
                </SubmitButton>
              )}
            </div>
          )}
          {scheduled && (
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="intent" value="send_now" className="btn-secondary" pendingText="送信中…">
                今すぐ送信
              </SubmitButton>
              <SubmitButton name="intent" value="cancel" className="btn-danger">
                送信を取り消す
              </SubmitButton>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
