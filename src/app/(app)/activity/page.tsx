import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { EmptyState, Notice, PageHeader } from "@/components/ui";

const TYPE_GROUPS: { key: string; label: string; prefixes: string[] }[] = [
  { key: "all", label: "すべて", prefixes: [] },
  { key: "reply", label: "返信", prefixes: ["reply."] },
  { key: "message", label: "分析", prefixes: ["message."] },
  { key: "sync", label: "同期", prefixes: ["sync."] },
  { key: "agent", label: "エージェント・案件", prefixes: ["agent.", "opportunity."] },
  { key: "settings", label: "設定・認証", prefixes: ["settings.", "auth."] },
];

function entityHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "thread":
      return `/inbox/${entityId}`;
    case "opportunity":
      return `/opportunities/${entityId}`;
    case "agent":
      return `/agents/${entityId}`;
    default:
      return null;
  }
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ type?: string; synced?: string }> }) {
  const user = await requireUser();
  const { type, synced } = await searchParams;
  const group = TYPE_GROUPS.find((g) => g.key === type) ?? TYPE_GROUPS[0]!;
  const logs = await prisma.activityLog.findMany({
    where: {
      userId: user.id,
      ...(group.prefixes.length > 0 ? { OR: group.prefixes.map((p) => ({ type: { startsWith: p } })) } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // 返信・メールは紐づくスレッドへ飛べるようにする
  const replyIds = logs.filter((l) => l.entityType === "reply" && l.entityId).map((l) => l.entityId as string);
  const messageIds = logs.filter((l) => l.entityType === "message" && l.entityId).map((l) => l.entityId as string);
  const [replies, messages] = await Promise.all([
    replyIds.length > 0 ? prisma.reply.findMany({ where: { id: { in: replyIds } }, select: { id: true, threadId: true } }) : [],
    messageIds.length > 0 ? prisma.message.findMany({ where: { id: { in: messageIds } }, select: { id: true, threadId: true } }) : [],
  ]);
  const threadOf = new Map<string, string>();
  for (const r of replies) threadOf.set(r.id, r.threadId);
  for (const m of messages) threadOf.set(m.id, m.threadId);

  return (
    <>
      <PageHeader title="活動ログ" description="AI の判定、送信、同期、設定変更の記録です。" />
      {synced && <Notice>同期を実行しました。結果は以下のログを確認してください。</Notice>}

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {TYPE_GROUPS.map((g) => (
          <Link
            key={g.key}
            href={`/activity?type=${g.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${g.key === group.key ? "border-indigo-600 font-semibold text-indigo-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}
          >
            {g.label}
          </Link>
        ))}
      </div>

      {logs.length === 0 ? (
        <EmptyState title="ログはありません" />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {logs.map((log) => {
            const href = entityHref(log.entityType, log.entityId) ?? (log.entityId && threadOf.get(log.entityId) ? `/inbox/${threadOf.get(log.entityId)}` : null);
            return (
              <li key={log.id} className="flex items-start gap-4 px-4 py-2.5 text-sm">
                <span className="w-36 shrink-0 text-xs text-slate-500">{formatDateTime(log.createdAt)}</span>
                <span className="w-40 shrink-0 font-mono text-xs text-slate-400">{log.type}</span>
                <span className="min-w-0 flex-1 text-slate-800">
                  {log.message}
                  {href && (
                    <Link href={href} className="ml-2 text-xs text-indigo-600 hover:underline">
                      開く
                    </Link>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
