import Link from "next/link";
import { LegalLinks } from "@/components/LegalLinks";

/**
 * プライバシーポリシーと利用規約の共通レイアウト。
 * Google の OAuth 同意画面(ブランディング)に URL を登録するため、ログインなしで表示する。
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/login" className="text-sm font-semibold text-indigo-700 hover:underline">
          エージェントエージェント
        </Link>
        <article className="legal mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">{children}</article>
        <LegalLinks className="mt-6" />
      </div>
    </div>
  );
}
