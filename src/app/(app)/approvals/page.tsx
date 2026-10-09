import Link from "next/link";
import type { ReplyStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { CategoryBadge } from "@/components/badges";
import { ReplyCard } from "@/components/ReplyCard";
import { EmptyState, PageHeader } from "@/components/ui";

const TABS: { key: string; label: string; statuses: ReplyStatus[] }[] = [
  { key: "pending", label: "承認待ち", statuses: ["PENDING_APPROVAL"] },
  { key: "scheduled", label: "送信予定", statuses: ["SCHEDULED", "SENDING"] },
  { key: "failed", label: "失敗", statuses: ["FAILED"] },
  { key: "sent", label: "送信済み", statuses: ["SENT"] },
  { key: "closed", label: "却下・取消", statuses: ["REJECTED", "CANCELLED"] },
];

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { tab } = await searchParams;
  const current = TABS.find((t) => t.key === tab) ?? TABS[0]!;

  const [counts, replies] = await Promise.all([
    prisma.reply.groupBy({ by: ["status"], where: { userId: user.id }, _count: { _all: true } }),
    prisma.reply.findMany({
      where: { userId: user.id, status: { in: current.statuses } },
      orderBy: current.key === "sent" ? { sentAt: "desc" } : current.key === "scheduled" ? { scheduledFor: "asc" } : { createdAt: "desc" },
      take: 50,
      include: {
        thread: { include: { agent: { select: { id: true, name: true } }, contact: { select: { name: true, email: true } } } },
        inReplyToMessage: { select: { id: true, fromName: true, fromEmail: true, sentAt: true, bodyText: true, category: true, aiSummary: true } },
      },
    }),
  ]);
  const countOf = (statuses: ReplyStatus[]) => counts.filter((c) => statuses.includes(c.status)).reduce((sum, c) => sum + c._count._all, 0);

  return (
    <>
      <PageHeader title="承認キュー" description="AI が作成した返信案を確認し、編集・承認・却下します。承認した返信は営業時間内に送信されます。" />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const active = t.key === current.key;
          const n = countOf(t.statuses);
          return (
            <Link
              key={t.key}
              href={`/approvals?tab=${t.key}`}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? "border-indigo-600 font-semibold text-indigo-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}
            >
              {t.label}
              {n > 0 && <span className="ml-1 text-xs text-slate-400">({n})</span>}
            </Link>
          );
        })}
      </div>

      {replies.length === 0 ? (
        <EmptyState title={`${current.label}の返信はありません`} />
      ) : (
        <div className="space-y-4">
          {replies.map((r) => (
            <ReplyCard
              key={r.id}
              reply={r}
              returnTo={`/approvals?tab=${current.key}`}
              header={
                <div className="text-xs text-slate-600">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/inbox/${r.thread.id}`} className="text-sm font-medium text-slate-800 hover:underline">
                      {r.thread.subject}
                    </Link>
                    <CategoryBadge category={r.inReplyToMessage?.category ?? r.thread.lastCategory} />
                  </div>
                  <div className="mt-0.5">
                    {r.thread.agent ? (
                      <Link href={`/agents/${r.thread.agent.id}`} className="hover:underline">
                        {r.thread.agent.name}
                      </Link>
                    ) : (
                      "未登録のエージェント"
                    )}
                    {r.thread.contact && <> / {r.thread.contact.name ?? r.thread.contact.email}</>}
                  </div>
                  {r.inReplyToMessage && (
                    <details className="mt-2">
                      <summary className="cursor-pointer select-none text-slate-700">
                        返信先のメール({formatDateTime(r.inReplyToMessage.sentAt)})
                        {r.inReplyToMessage.aiSummary ? ` 要約: ${r.inReplyToMessage.aiSummary}` : ""}
                      </summary>
                      <div className="mail-body mt-2 rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-700">{r.inReplyToMessage.bodyText}</div>
                    </details>
                  )}
                </div>
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
