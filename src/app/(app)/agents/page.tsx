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
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
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
      )}
    </>
  );
}
