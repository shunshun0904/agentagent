import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { formatRelative } from "@/lib/format";
import { AgentStatusBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/ui";

export default async function AgentsPage() {
  const user = await requireUser();
  const agents = await prisma.agent.findMany({
    where: { userId: user.id },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { contacts: true, threads: true, opportunities: true } },
      threads: { orderBy: { lastMessageAt: "desc" }, take: 1, select: { lastMessageAt: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="エージェント"
        description="やり取りのあるフリーランスエージェント(案件紹介会社)の一覧です。メールの送信者から自動登録されます。"
        actions={
          <Link href="/agents/new" className="btn-primary">
            手動で登録
          </Link>
        }
      />
      {agents.length === 0 ? (
        <EmptyState title="エージェントはまだありません" description="Gmail を同期するとエージェントからのメールを元に自動登録されます。" />
      ) : (
        <>
          {/* スマートフォンではカードで表示する */}
          <ul className="space-y-3 md:hidden">
            {agents.map((a) => (
              <li key={a.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/agents/${a.id}`} className="min-w-0 font-medium text-slate-800 hover:underline">
                    {a.name}
                  </Link>
                  <AgentStatusBadge status={a.status} />
                </div>
                <div className="mt-1 break-all text-xs text-slate-600">{a.domains.join(", ") || "ドメインなし"}</div>
                {(!a.autoReplyEnabled || a.requireApproval) && (
                  <div className="mt-1 text-xs text-slate-500">
                    {!a.autoReplyEnabled && "自動返信オフ "}
                    {a.requireApproval && "常に承認"}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>担当者 {a._count.contacts}</span>
                  <span>スレッド {a._count.threads}</span>
                  <span>案件 {a._count.opportunities}</span>
                  {a.rating ? <span>{"★".repeat(a.rating)}</span> : null}
                  <span>最終連絡 {a.threads[0] ? formatRelative(a.threads[0].lastMessageAt) : "-"}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-2">会社名</th>
                  <th className="px-4 py-2">状態</th>
                  <th className="px-4 py-2">ドメイン</th>
                  <th className="px-4 py-2 text-right">担当者</th>
                  <th className="px-4 py-2 text-right">スレッド</th>
                  <th className="px-4 py-2 text-right">案件</th>
                  <th className="px-4 py-2">評価</th>
                  <th className="px-4 py-2">最終連絡</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agents.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/agents/${a.id}`} className="font-medium text-slate-800 hover:underline">
                        {a.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {!a.autoReplyEnabled && "自動返信オフ "}
                        {a.requireApproval && "常に承認"}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <AgentStatusBadge status={a.status} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{a.domains.join(", ") || "-"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{a._count.contacts}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{a._count.threads}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{a._count.opportunities}</td>
                    <td className="px-4 py-2.5 text-xs">{a.rating ? "★".repeat(a.rating) : "-"}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{a.threads[0] ? formatRelative(a.threads[0].lastMessageAt) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
