import { prisma } from "@/lib/db";
import type { User } from "@/generated/prisma/client";
import { syncNowAction } from "@/actions/sync";
import { NavLinks } from "@/components/nav/NavLinks";
import { SubmitButton } from "@/components/ui/SubmitButton";

export async function Sidebar({ user }: { user: User }) {
  const [pendingApprovals, needsAction, googleAccount] = await Promise.all([
    prisma.reply.count({ where: { userId: user.id, status: "PENDING_APPROVAL" } }),
    prisma.thread.count({ where: { userId: user.id, status: "NEEDS_ACTION" } }),
    prisma.googleAccount.findUnique({ where: { userId: user.id }, select: { email: true, lastSyncedAt: true, lastSyncError: true } }),
  ]);

  const items = [
    { href: "/", label: "ダッシュボード" },
    { href: "/inbox", label: "受信箱", count: needsAction },
    { href: "/approvals", label: "承認キュー", count: pendingApprovals },
    { href: "/opportunities", label: "案件" },
    { href: "/agents", label: "エージェント" },
    { href: "/activity", label: "活動ログ" },
    { href: "/settings", label: "設定" },
  ];

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">AgentAgent</div>
        <div className="text-base font-bold text-slate-900">エージェントエージェント</div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <NavLinks items={items} />
      </div>
      <div className="space-y-3 border-t border-slate-100 px-4 py-4">
        <form action={syncNowAction}>
          <SubmitButton className="btn-secondary w-full" pendingText="同期中…">
            今すぐ同期
          </SubmitButton>
        </form>
        <div className="text-xs text-slate-500">
          {googleAccount ? (
            <>
              <div className="truncate" title={googleAccount.email}>
                Gmail: {googleAccount.email}
              </div>
              {googleAccount.lastSyncError ? (
                <div className="mt-1 text-rose-600">同期エラー: {googleAccount.lastSyncError.slice(0, 60)}</div>
              ) : null}
            </>
          ) : (
            <div className="text-amber-700">Gmail 未連携</div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="truncate" title={user.email}>
            {user.name ?? user.email}
          </span>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="btn-ghost px-2 py-1 text-xs">
              ログアウト
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
