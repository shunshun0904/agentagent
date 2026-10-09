import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { CATEGORY_LABELS, THREAD_STATUS_LABELS, formatRelative } from "@/lib/format";
import { MESSAGE_CATEGORIES } from "@/lib/ai/schemas";
import { CategoryBadge, ThreadStatusBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/ui";

const STATUSES = ["OPEN", "WAITING_THEM", "NEEDS_ACTION", "CLOSED", "ARCHIVED"] as const;

type Search = { status?: string; agent?: string; category?: string; q?: string };

export default async function InboxPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const params = await searchParams;
  const status = STATUSES.find((s) => s === params.status);
  const category = MESSAGE_CATEGORIES.find((c) => c === params.category);
  const where: Prisma.ThreadWhereInput = {
    userId: user.id,
    ...(status ? { status } : { status: { not: "ARCHIVED" } }),
    ...(params.agent ? { agentId: params.agent } : {}),
    ...(category ? { lastCategory: category } : {}),
    ...(params.q ? { subject: { contains: params.q, mode: "insensitive" } } : {}),
  };
  const [threads, agents] = await Promise.all([
    prisma.thread.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: 100,
      include: {
        agent: { select: { id: true, name: true } },
        contact: { select: { name: true, email: true } },
        _count: { select: { messages: true } },
        replies: { where: { status: { in: ["PENDING_APPROVAL", "SCHEDULED"] } }, select: { status: true } },
      },
    }),
    prisma.agent.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <PageHeader title="受信箱" description="全エージェントとのメールのやり取りをスレッド単位で表示します。" />

      <form className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <label className="label">ステータス</label>
          <select name="status" defaultValue={params.status ?? ""} className="input w-40">
            <option value="">アーカイブ以外</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {THREAD_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">エージェント</label>
          <select name="agent" defaultValue={params.agent ?? ""} className="input w-48">
            <option value="">すべて</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">分類</label>
          <select name="category" defaultValue={params.category ?? ""} className="input w-40">
            <option value="">すべて</option>
            {MESSAGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label className="label">件名で検索</label>
          <input name="q" defaultValue={params.q ?? ""} className="input" placeholder="キーワード" />
        </div>
        <button type="submit" className="btn-secondary">
          絞り込む
        </button>
        <Link href="/inbox" className="btn-ghost">
          クリア
        </Link>
      </form>

      {threads.length === 0 ? (
        <EmptyState title="スレッドがありません" description="Gmail を同期すると、エージェントからのメールがここに表示されます。" />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {threads.map((t) => {
            const pending = t.replies.filter((r) => r.status === "PENDING_APPROVAL").length;
            const scheduled = t.replies.filter((r) => r.status === "SCHEDULED").length;
            return (
              <li key={t.id}>
                <Link href={`/inbox/${t.id}`} className="block px-5 py-3 hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">{t.subject}</span>
                        {t.isMuted && <span className="text-xs text-slate-400">(ミュート)</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {t.agent?.name ?? "未登録のエージェント"} / {t.contact?.name ?? t.contact?.email ?? "-"} ・ {t._count.messages} 通
                      </div>
                      {t.snippet && <div className="mt-1 truncate text-xs text-slate-500">{t.snippet}</div>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <CategoryBadge category={t.lastCategory} />
                        <ThreadStatusBadge status={t.status} />
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatRelative(t.lastMessageAt)}
                        {pending > 0 && <span className="ml-2 text-amber-700">承認待ち {pending}</span>}
                        {scheduled > 0 && <span className="ml-2 text-indigo-700">送信予定 {scheduled}</span>}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
