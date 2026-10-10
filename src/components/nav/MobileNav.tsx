"use client";

import { useState } from "react";
import { NavLinks, type NavItem } from "@/components/nav/NavLinks";

/**
 * スマートフォン用の上部バーとメニュー(md 未満の画面幅で表示)。
 * メニューには、ナビゲーションと、サイドバー下部と同じ内容(children: 同期ボタン、Gmail の状態、ログアウト)を表示する。
 */
export function MobileNav({ items, children }: { items: NavItem[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pending = items.reduce((sum, item) => sum + (item.count ?? 0), 0);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white md:hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">AgentAgent</div>
          <div className="truncate text-sm font-bold text-slate-900">エージェントエージェント</div>
        </div>
        <button
          type="button"
          className="btn-secondary shrink-0"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "閉じる" : "メニュー"}
          {!open && pending > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{pending}</span>
          )}
        </button>
      </div>
      {open && (
        <div id="mobile-menu" className="max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-t border-slate-100 px-3 pb-4">
          <div className="py-2">
            <NavLinks items={items} onNavigate={() => setOpen(false)} />
          </div>
          <div className="space-y-3 border-t border-slate-100 px-1 pt-3">{children}</div>
        </div>
      )}
    </header>
  );
}
