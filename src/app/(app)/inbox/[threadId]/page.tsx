import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { THREAD_STATUS_LABELS, formatDateTime } from "@/lib/format";
import { manualReplyAction, threadMuteAction, threadStatusAction } from "@/actions/threads";
import { AgentStatusBadge, CategoryBadge, StageBadge, ThreadStatusBadge } from "@/components/badges";
import { MessageView } from "@/components/MessageView";
import { ReplyCard } from "@/components/ReplyCard";
import { Card } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/ui/AutoSubmitSelect";
import { SubmitButton } from "@/components/ui/SubmitButton";

const STATUSES = ["OPEN", "WAITING_THEM", "NEEDS_ACTION", "CLOSED", "ARCHIVED"] as const;

type Extracted = {
  questions_asked?: string[];
  proposed_dates?: string[];
  deadline?: string | null;
};

export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const user = await requireUser();
  const { threadId } = await params;
  const thread = await prisma.thread.findFirst({
    where: { id: threadId, userId: user.id },
    include: {
      agent: true,
      contact: true,
      messages: { orderBy: { sentAt: "asc" } },
      replies: { orderBy: { createdAt: "desc" } },
      opportunities: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!thread) notFound();

  const latestInbound = [...thread.messages].reverse().find((m) => m.direction === "INBOUND");
  const extracted = (latestInbound?.extracted ?? null) as Extracted | null;
  const returnTo = `/inbox/${thread.id}`;

  return (
    <>
      <div className="mb-4">
        <Link href="/inbox" className="text-xs text-slate-500 hover:underline">
          ← 受信箱
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900">{thread.subject}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {thread.agent ? (
                <Link href={`/agents/${thread.agent.id}`} className="font-medium text-slate-700 hover:underline">
                  {thread.agent.name}
                </Link>
              ) : (
                <span>未登録のエージェント</span>
              )}
              {thread.contact && (
                <span>
                  {thread.contact.name ?? ""} &lt;{thread.contact.email}&gt;
                </span>
              )}
              <CategoryBadge category={thread.lastCategory} />
              <ThreadStatusBadge status={thread.status} />
              {thread.isMuted && <span className="text-amber-700">自動返信停止中</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <form action={threadStatusAction} className="flex items-center gap-2">
              <input type="hidden" name="threadId" value={thread.id} />
              <AutoSubmitSelect
                name="status"
                defaultValue={thread.status}
                className="input w-36 py-1.5"
                options={STATUSES.map((s) => ({ value: s, label: THREAD_STATUS_LABELS[s] }))}
              />
            </form>
            <form action={threadMuteAction}>
              <input type="hidden" name="threadId" value={thread.id} />
              <SubmitButton className="btn-secondary">{thread.isMuted ? "自動返信を再開" : "このスレッドの自動返信を停止"}</SubmitButton>
            </form>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">メール({thread.messages.length})</h2>
            {thread.messages.map((m) => (
              <MessageView key={m.id} message={m} />
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">返信案({thread.replies.length})</h2>
            {thread.replies.length === 0 ? (
              <p className="text-sm text-slate-500">返信案はまだありません。</p>
            ) : (
              thread.replies.map((r) => <ReplyCard key={r.id} reply={r} returnTo={returnTo} />)
            )}
          </section>

          <Card title="自分で返信を書く">
            <form action={manualReplyAction} className="space-y-3">
              <input type="hidden" name="threadId" value={thread.id} />
              <textarea name="body" rows={8} className="input font-mono text-[13px] leading-6" placeholder="宛名・本文・署名を含めて入力してください。最新の受信メールへの返信として送信されます。" />
              <div className="flex gap-2">
                <SubmitButton name="intent" value="send" className="btn-primary" pendingText="送信中…">
                  今すぐ送信
                </SubmitButton>
                <SubmitButton name="intent" value="schedule" className="btn-secondary">
                  営業時間内に予約送信
                </SubmitButton>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="スレッドの要約">
            <p className="text-sm leading-6 text-slate-700">{thread.summary ?? "AI が処理すると要約が表示されます。"}</p>
            {extracted && (
              <div className="mt-3 space-y-2 text-xs text-slate-600">
                {extracted.questions_asked && extracted.questions_asked.length > 0 && (
                  <div>
                    <div className="font-semibold text-slate-700">相手からの質問</div>
                    <ul className="list-inside list-disc">
                      {extracted.questions_asked.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {extracted.proposed_dates && extracted.proposed_dates.length > 0 && (
                  <div>
                    <div className="font-semibold text-slate-700">提示された候補日時</div>
                    <ul className="list-inside list-disc">
                      {extracted.proposed_dates.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {extracted.deadline && (
                  <div>
                    <span className="font-semibold text-slate-700">回答期限: </span>
                    {extracted.deadline}
                  </div>
                )}
              </div>
            )}
            <dl className="mt-3 space-y-1 text-xs text-slate-500">
              <div>最終受信: {formatDateTime(thread.lastInboundAt)}</div>
              <div>最終送信: {formatDateTime(thread.lastOutboundAt)}</div>
            </dl>
          </Card>

          {thread.agent && (
            <Card title="エージェント">
              <div className="flex items-center justify-between">
                <Link href={`/agents/${thread.agent.id}`} className="text-sm font-medium text-slate-800 hover:underline">
                  {thread.agent.name}
                </Link>
                <AgentStatusBadge status={thread.agent.status} />
              </div>
              {thread.agent.notes && <p className="mt-2 text-xs leading-5 text-slate-600">{thread.agent.notes}</p>}
              <div className="mt-2 text-xs text-slate-500">
                自動返信: {thread.agent.autoReplyEnabled ? "有効" : "無効"} / 常に承認: {thread.agent.requireApproval ? "はい" : "いいえ"}
              </div>
            </Card>
          )}

          <Card title={`案件(${thread.opportunities.length})`}>
            {thread.opportunities.length === 0 ? (
              <p className="text-sm text-slate-500">このスレッドに紐づく案件はありません。</p>
            ) : (
              <ul className="space-y-2">
                {thread.opportunities.map((o) => (
                  <li key={o.id} className="text-sm">
                    <Link href={`/opportunities/${o.id}`} className="font-medium text-slate-800 hover:underline">
                      {o.title}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                      <StageBadge stage={o.stage} />
                      {o.rateText ?? ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
