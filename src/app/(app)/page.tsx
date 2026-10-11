import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { isAnthropicConfigured } from "@/lib/env";
import { isTransientNotice } from "@/lib/errors";
import { formatDateTime, formatRelative } from "@/lib/format";
import { CategoryBadge, ReplyDecisionBadge, StageBadge, ThreadStatusBadge } from "@/components/badges";
import { Card, EmptyState, Notice, PageHeader, StatTile } from "@/components/ui";

async function loadDashboard(userId: string) {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [pendingApprovals, scheduled, sentToday, pendingMessages, errorMessages, activeOpportunities, agents, googleAccount, recentThreads, upcomingInterviews, recentLogs, lastSync, nextScheduled] =
    await Promise.all([
      prisma.reply.count({ where: { userId, status: "PENDING_APPROVAL" } }),
      prisma.reply.count({ where: { userId, status: "SCHEDULED" } }),
      prisma.reply.count({ where: { userId, status: "SENT", sentAt: { gte: since24h } } }),
      prisma.message.count({ where: { processingStatus: "PENDING", thread: { userId } } }),
      prisma.message.count({ where: { processingStatus: "ERROR", thread: { userId } } }),
      prisma.opportunity.count({ where: { userId, stage: { in: ["NEW", "INTERESTED", "APPLIED", "INTERVIEW_SCHEDULING", "INTERVIEWED", "OFFER"] } } }),
      prisma.agent.count({ where: { userId, status: "ACTIVE" } }),
      prisma.googleAccount.findUnique({ where: { userId } }),
      prisma.thread.findMany({
        where: { userId, status: { in: ["NEEDS_ACTION", "OPEN"] } },
        orderBy: { lastMessageAt: "desc" },
        take: 8,
        include: { agent: { select: { name: true } }, contact: { select: { name: true } } },
      }),
      prisma.opportunity.findMany({
        where: { userId, interviewAt: { gte: now } },
        orderBy: { interviewAt: "asc" },
        take: 5,
        include: { agent: { select: { name: true } } },
      }),
      prisma.activityLog.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 8 }),
      prisma.activityLog.findFirst({ where: { userId, type: "sync.completed" }, orderBy: { createdAt: "desc" } }),
      prisma.reply.findMany({
        where: { userId, status: "SCHEDULED" },
        orderBy: { scheduledFor: "asc" },
        take: 5,
        include: { thread: { select: { id: true, subject: true, agent: { select: { name: true } } } } },
      }),
    ]);
  return { pendingApprovals, scheduled, sentToday, pendingMessages, errorMessages, activeOpportunities, agents, googleAccount, recentThreads, upcomingInterviews, recentLogs, lastSync, nextScheduled };
}

export default async function DashboardPage() {
  const user = await requireUser();
  const { pendingApprovals, scheduled, sentToday, pendingMessages, errorMessages, activeOpportunities, agents, googleAccount, recentThreads, upcomingInterviews, recentLogs, lastSync, nextScheduled } =
    await loadDashboard(user.id);
  // 直近の同期で次回に回した件数(取り込みの途中なら表示する)
  const syncMeta = (lastSync?.metadata ?? null) as { remaining?: number; deferred?: number } | null;
  const syncRemaining = (syncMeta?.remaining ?? 0) + (syncMeta?.deferred ?? 0);

  return (
    <>
      <PageHeader title="ダッシュボード" description="エージェントとのやり取りの状況をまとめて確認します。" />

      {!googleAccount && (
        <Notice tone="warning">
          Gmail が連携されていません。<Link href="/settings#gmail" className="underline">設定</Link>から Google アカウントを連携すると同期が始まります。
        </Notice>
      )}
      {!isAnthropicConfigured() && (
        <Notice tone="warning">ANTHROPIC_API_KEY が設定されていないため、AI による分析と返信案の生成は動作しません。</Notice>
      )}
      {googleAccount?.lastSyncError &&
        (isTransientNotice(googleAccount.lastSyncError) ? (
          <Notice tone="warning">
            <span className="break-words">{googleAccount.lastSyncError}</span>
          </Notice>
        ) : (
          <Notice tone="error">
            <span className="break-words">自動処理でエラーが起きています: {googleAccount.lastSyncError}</span>
          </Notice>
        ))}
      {syncRemaining > 0 && (
        <Notice tone="info">
          メールを取り込んでいます: 残り {syncRemaining.toLocaleString("ja-JP")} 件(定期処理は 1 時間ごと。「今すぐ同期」でも続きを取り込めます)
        </Notice>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="承認待ち" value={pendingApprovals} href="/approvals" tone={pendingApprovals > 0 ? "warning" : "default"} />
        <StatTile label="送信予定" value={scheduled} href="/approvals?tab=scheduled" tone="info" />
        <StatTile label="24時間の送信" value={sentToday} tone="success" />
        <StatTile label="未処理メール" value={pendingMessages + errorMessages} href="/inbox" hint={errorMessages > 0 ? `うちエラー ${errorMessages}` : undefined} tone={errorMessages > 0 ? "warning" : "default"} />
        <StatTile label="進行中の案件" value={activeOpportunities} href="/opportunities" />
        <StatTile label="有効なエージェント" value={agents} href="/agents" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="対応が必要なスレッド" actions={<Link href="/inbox" className="text-xs text-indigo-600 hover:underline">受信箱へ</Link>}>
            {recentThreads.length === 0 ? (
              <EmptyState title="対応が必要なスレッドはありません" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentThreads.map((t) => (
                  <li key={t.id} className="py-2.5">
                    <Link href={`/inbox/${t.id}`} className="block hover:bg-slate-50">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-800">{t.subject}</div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {t.agent?.name ?? "未登録"} / {t.contact?.name ?? "担当者不明"} ・ {formatRelative(t.lastMessageAt)}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <CategoryBadge category={t.lastCategory} />
                          <ThreadStatusBadge status={t.status} />
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="送信予定の返信" actions={<Link href="/approvals?tab=scheduled" className="text-xs text-indigo-600 hover:underline">一覧へ</Link>}>
            {nextScheduled.length === 0 ? (
              <p className="text-sm text-slate-500">送信予定の返信はありません。</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {nextScheduled.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/inbox/${r.thread.id}`} className="block truncate text-sm font-medium text-slate-800 hover:underline">
                        {r.subject}
                      </Link>
                      <div className="text-xs text-slate-500">{r.thread.agent?.name ?? ""}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
                      <ReplyDecisionBadge decision={r.decision} />
                      <span>{formatDateTime(r.scheduledFor)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="今後の面談">
            {upcomingInterviews.length === 0 ? (
              <p className="text-sm text-slate-500">予定されている面談はありません。</p>
            ) : (
              <ul className="space-y-2">
                {upcomingInterviews.map((o) => (
                  <li key={o.id} className="text-sm">
                    <Link href={`/opportunities/${o.id}`} className="font-medium text-slate-800 hover:underline">
                      {o.title}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {formatDateTime(o.interviewAt)} ・ {o.agent?.name ?? ""} <StageBadge stage={o.stage} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="最近の活動" actions={<Link href="/activity" className="text-xs text-indigo-600 hover:underline">すべて</Link>}>
            {recentLogs.length === 0 ? (
              <p className="text-sm text-slate-500">まだ活動はありません。</p>
            ) : (
              <ul className="space-y-2">
                {recentLogs.map((log) => (
                  <li key={log.id} className="text-xs leading-5 text-slate-700">
                    <span className="text-slate-400">{formatRelative(log.createdAt)}</span> {log.message}
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
