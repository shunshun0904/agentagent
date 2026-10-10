import Link from "next/link";

/** プライバシーポリシーと利用規約へのリンク(ログイン画面と規約ページの下部に表示) */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav className={`flex justify-center gap-4 text-xs text-slate-500 ${className}`}>
      <Link href="/privacy" className="hover:text-slate-700 hover:underline">
        プライバシーポリシー
      </Link>
      <Link href="/terms" className="hover:text-slate-700 hover:underline">
        利用規約
      </Link>
    </nav>
  );
}
