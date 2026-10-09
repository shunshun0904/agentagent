import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime, formatRelative } from "@/lib/format";
import { updateAgentAction, updateContactAction } from "@/actions/agents";
import { AgentStatusBadge, CategoryBadge, StageBadge, ThreadStatusBadge } from "@/components/badges";
import { Card, Field, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";

export default async function AgentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { saved } = await searchParams;
  const agent = await prisma.agent.findFirst({
    where: { id, userId: user.id },
    include: {
      contacts: { orderBy: { lastContactAt: "desc" } },
      threads: { orderBy: { lastMessageAt: "desc" }, take: 20 },
      opportunities: { orderBy: { updatedAt: "desc" }, take: 20 },
    },
  });
  if (!agent) notFound();
  const [sentCount, inboundCount] = await Promise.all([
    prisma.reply.count({ where: { status: "SENT", thread: { agentId: agent.id } } }),
    prisma.message.count({ where: { direction: "INBOUND", thread: { agentId: agent.id } } }),
  ]);

  return (
    <>
      <div className="mb-4">
        <Link href="/agents" className="text-xs text-slate-500 hover:underline">
          ← エージェント一覧
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-slate-900">{agent.name}</h1>
          <AgentStatusBadge status={agent.status} />
          {agent.rating && <span className="text-xs text-amber-600">{"★".repeat(agent.rating)}</span>}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          受信 {inboundCount} 通 ・ 送信済み返信 {sentCount} 通 ・ 登録 {formatDateTime(agent.createdAt)}
        </div>
      </div>

      {saved && <Notice>保存しました。</Notice>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="設定">
            <form action={updateAgentAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input type="hidden" name="agentId" value={agent.id} />
              <Field label="会社名">
                <input name="name" defaultValue={agent.name} className="input" />
              </Field>
              <Field label="メールドメイン(カンマ区切り)">
                <input name="domains" defaultValue={agent.domains.join(", ")} className="input" />
              </Field>
              <Field label="Web サイト">
                <input name="website" defaultValue={agent.website ?? ""} className="input" />
              </Field>
              <Field label="評価(1〜5)">
                <input name="rating" type="number" min={1} max={5} defaultValue={agent.rating ?? ""} className="input" />
              </Field>
              <Field label="状態" hint="一時停止: 返信案は作るが自動送信しない / ブロック: 返信しない">
                <select name="status" defaultValue={agent.status} className="input">
                  <option value="ACTIVE">有効</option>
                  <option value="PAUSED">一時停止</option>
                  <option value="BLOCKED">ブロック</option>
                </select>
              </Field>
              <div className="flex flex-col justify-end gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="autoReplyEnabled" defaultChecked={agent.autoReplyEnabled} />
                  このエージェントへの自動返信を有効にする
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="requireApproval" defaultChecked={agent.requireApproval} />
                  常に承認を必要とする
                </label>
              </div>
              <Field label="メモ" className="sm:col-span-2" hint="AI が返信を書くときに参照します">
                <textarea name="notes" defaultValue={agent.notes ?? ""} rows={3} className="input" />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton>保存</SubmitButton>
              </div>
            </form>
          </Card>

          <Card title={`スレッド(${agent.threads.length})`}>
            {agent.threads.length === 0 ? (
              <p className="text-sm text-slate-500">まだやり取りはありません。</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {agent.threads.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/inbox/${t.id}`} className="min-w-0 truncate text-sm font-medium text-slate-800 hover:underline">
                      {t.subject}
                    </Link>
                    <div className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                      <CategoryBadge category={t.lastCategory} />
                      <ThreadStatusBadge status={t.status} />
                      <span>{formatRelative(t.lastMessageAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title={`担当者(${agent.contacts.length})`}>
            {agent.contacts.length === 0 ? (
              <p className="text-sm text-slate-500">担当者はまだ登録されていません。</p>
            ) : (
              <div className="space-y-4">
                {agent.contacts.map((c) => (
                  <form key={c.id} action={updateContactAction} className="space-y-2 rounded-md border border-slate-100 p-3">
                    <input type="hidden" name="contactId" value={c.id} />
                    <div className="text-xs text-slate-500">{c.email}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input name="name" defaultValue={c.name ?? ""} placeholder="氏名" className="input py-1 text-xs" />
                      <input name="role" defaultValue={c.role ?? ""} placeholder="役職" className="input py-1 text-xs" />
                    </div>
                    <input name="phone" defaultValue={c.phone ?? ""} placeholder="電話番号" className="input py-1 text-xs" />
                    <textarea name="notes" defaultValue={c.notes ?? ""} placeholder="メモ" rows={2} className="input py-1 text-xs" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">最終連絡 {c.lastContactAt ? formatRelative(c.lastContactAt) : "-"}</span>
                      <SubmitButton className="btn-secondary px-2 py-1 text-xs">保存</SubmitButton>
                    </div>
                  </form>
                ))}
              </div>
            )}
          </Card>

          <Card title={`案件(${agent.opportunities.length})`}>
            {agent.opportunities.length === 0 ? (
              <p className="text-sm text-slate-500">案件はまだありません。</p>
            ) : (
              <ul className="space-y-2">
                {agent.opportunities.map((o) => (
                  <li key={o.id} className="text-sm">
                    <Link href={`/opportunities/${o.id}`} className="font-medium text-slate-800 hover:underline">
                      {o.title}
                    </Link>
                    <div className="mt-0.5">
                      <StageBadge stage={o.stage} />
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
