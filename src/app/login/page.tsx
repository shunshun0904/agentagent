import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { canonicalUrlFor } from "@/lib/canonical";
import { getCurrentUser } from "@/lib/auth/session";
import { isDevLoginEnabled, isGoogleConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  google_not_configured: "Google OAuth が設定されていません。.env の GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定してください。",
  google_denied: "Google の認可がキャンセルされました。",
  invalid_state: "ログインの検証に失敗しました。もう一度お試しください。",
  not_allowed: "このアカウントはログインを許可されていません。サーバーの ALLOWED_GOOGLE_EMAILS に自分のメールアドレスを設定してください(本番環境では未設定だと誰もログインできません)。",
  login_failed: "ログインに失敗しました。サーバーのログを確認してください。",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  // ログインは APP_URL のホストで行う(OAuth の Cookie とリダイレクト先をそろえるため)
  const canonical = canonicalUrlFor((await headers()).get("host"), error ? `/login?error=${encodeURIComponent(error)}` : "/login");
  if (canonical) redirect(canonical);
  const user = await getCurrentUser();
  if (user) redirect("/");
  const googleReady = isGoogleConfigured();
  const devLogin = isDevLoginEnabled();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
            AgentAgent
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">エージェントエージェント</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            フリーランスエージェントとのメールのやり取りを AI が本人に代わって行い、全エージェントとのやり取りを一元管理します。
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {ERROR_MESSAGES[error] ?? "エラーが発生しました。"}
          </div>
        )}

        <div className="space-y-3">
          {googleReady ? (
            <Link href="/api/auth/google" className="btn-primary w-full py-2.5 text-base">
              Google でログイン(Gmail を連携)
            </Link>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Google OAuth が未設定のため Google ログインは使えません。README の「Google Cloud の設定」を参照してください。
            </div>
          )}

          {devLogin && (
            <form action="/api/auth/dev" method="post">
              <button type="submit" className="btn-secondary w-full py-2.5">
                デモユーザーでログイン(開発用)
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-xs leading-5 text-slate-500">
          ログインすると Gmail の読み取りと送信の権限を要求します。取得したトークンは暗号化して保存され、エージェントとのやり取りにのみ使用します。
        </p>
      </div>
    </main>
  );
}
