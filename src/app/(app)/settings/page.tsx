import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getEnv, isAnthropicConfigured, isGoogleConfigured } from "@/lib/env";
import { MESSAGE_CATEGORIES } from "@/lib/ai/schemas";
import { AVAILABILITY_LABELS, CATEGORY_LABELS, COMMITMENT_LABELS, POLICY_MODE_LABELS, WORK_STYLE_LABELS, formatDateTime } from "@/lib/format";
import { COMMITMENT_TYPES, DEFAULT_POLICY } from "@/lib/policy/defaults";
import { disconnectGoogleAction, saveProfileAction, savePolicyAction } from "@/actions/settings";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";

function toDateInput(date: Date | null): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const SAVED_MESSAGES: Record<string, string> = {
  profile: "プロフィールを保存しました。",
  policy: "返信ポリシーを保存しました。",
  gmail: "Gmail 連携を解除しました。",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const user = await requireUser();
  const { saved } = await searchParams;
  const env = getEnv();
  const [profile, policyRow, googleAccount] = await Promise.all([
    prisma.profile.findUnique({ where: { userId: user.id } }),
    prisma.replyPolicy.findUnique({ where: { userId: user.id } }),
    prisma.googleAccount.findUnique({ where: { userId: user.id } }),
  ]);
  const policy = policyRow ?? { userId: user.id, ...DEFAULT_POLICY };
  const commitmentOptions = COMMITMENT_TYPES.filter((c) => c !== "none");

  return (
    <>
      <PageHeader title="設定" description="プロフィール、返信ポリシー、Gmail 連携、AI の設定です。" />
      {saved && SAVED_MESSAGES[saved] && <Notice>{SAVED_MESSAGES[saved]}</Notice>}

      <div className="mb-4 flex gap-3 text-sm">
        <a href="#gmail" className="text-indigo-600 hover:underline">Gmail 連携</a>
        <a href="#ai" className="text-indigo-600 hover:underline">AI</a>
        <a href="#profile" className="text-indigo-600 hover:underline">プロフィール</a>
        <a href="#policy" className="text-indigo-600 hover:underline">返信ポリシー</a>
      </div>

      <div className="space-y-6">
        <Card id="gmail" title="Gmail 連携">
          {googleAccount ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div>
                <div className="font-medium text-slate-800">{googleAccount.email}</div>
                <div className="text-xs text-slate-500">
                  最終同期: {formatDateTime(googleAccount.lastSyncedAt)}
                  {googleAccount.lastSyncError && <span className="ml-2 text-rose-600">エラー: {googleAccount.lastSyncError}</span>}
                </div>
                <div className="text-xs text-slate-500">スコープ: {googleAccount.scopes || "-"}</div>
              </div>
              <div className="flex gap-2">
                {isGoogleConfigured() && (
                  <Link href="/api/auth/google" className="btn-secondary">
                    再連携
                  </Link>
                )}
                <form action={disconnectGoogleAction}>
                  <SubmitButton className="btn-danger">連携を解除</SubmitButton>
                </form>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-slate-600">Gmail が連携されていません。連携すると受信メールの同期と返信の送信ができます。</p>
              {isGoogleConfigured() ? (
                <Link href="/api/auth/google" className="btn-primary">
                  Google アカウントを連携
                </Link>
              ) : (
                <span className="text-xs text-amber-700">GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定です</span>
              )}
            </div>
          )}
        </Card>

        <Card id="ai" title="AI">
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">API キー</dt>
              <dd className={isAnthropicConfigured() ? "text-emerald-700" : "text-rose-700"}>{isAnthropicConfigured() ? "設定済み" : "未設定(ANTHROPIC_API_KEY)"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">モデル</dt>
              <dd className="font-mono text-xs">{env.AGENTAGENT_MODEL}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">返信生成の effort</dt>
              <dd className="font-mono text-xs">{env.AGENTAGENT_DRAFT_EFFORT}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">分析の effort</dt>
              <dd className="font-mono text-xs">{env.AGENTAGENT_ANALYSIS_EFFORT}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">これらは環境変数(.env)で変更します。</p>
        </Card>

        <Card id="profile" title="プロフィール(AI が返信を書くときの本人情報)">
          <form action={saveProfileAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="氏名(署名・名乗りに使用)">
              <input name="displayName" defaultValue={profile?.displayName ?? user.name ?? ""} required className="input" />
            </Field>
            <Field label="肩書き">
              <input name="headline" defaultValue={profile?.headline ?? ""} className="input" placeholder="例: バックエンドエンジニア(Go / TypeScript)" />
            </Field>
            <Field label="経験年数">
              <input name="yearsOfExperience" type="number" min={0} defaultValue={profile?.yearsOfExperience ?? ""} className="input" />
            </Field>
            <Field label="スキル(カンマ区切り)">
              <input name="skills" defaultValue={profile?.skills.join(", ") ?? ""} className="input" />
            </Field>
            <Field label="経歴の要約" className="sm:col-span-2">
              <textarea name="summary" defaultValue={profile?.summary ?? ""} rows={3} className="input" />
            </Field>
            <Field label="希望単価 下限(万円/月)">
              <input name="desiredRateMin" type="number" defaultValue={profile?.desiredRateMin ?? ""} className="input" />
            </Field>
            <Field label="希望単価 上限(万円/月)">
              <input name="desiredRateMax" type="number" defaultValue={profile?.desiredRateMax ?? ""} className="input" />
            </Field>
            <Field label="稼働状況">
              <select name="availabilityStatus" defaultValue={profile?.availabilityStatus ?? "LOOKING"} className="input">
                {Object.entries(AVAILABILITY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="稼働開始可能日">
              <input name="availableFrom" type="date" defaultValue={toDateInput(profile?.availableFrom ?? null)} className="input" />
            </Field>
            <Field label="稼働日数">
              <input name="weeklyDays" defaultValue={profile?.weeklyDays ?? ""} className="input" placeholder="例: 週5日(週4日も相談可)" />
            </Field>
            <Field label="稼働形態">
              <select name="workStyle" defaultValue={profile?.workStyle ?? "REMOTE_ONLY"} className="input">
                {Object.entries(WORK_STYLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="勤務可能エリア(カンマ区切り)">
              <input name="locations" defaultValue={profile?.locations.join(", ") ?? ""} className="input" />
            </Field>
            <Field label="面談可能な時間帯" hint="候補日の提示に使います">
              <input name="interviewAvailability" defaultValue={profile?.interviewAvailability ?? ""} className="input" placeholder="例: 平日 10:00〜12:00、16:00〜19:00" />
            </Field>
            <Field label="NG 条件" className="sm:col-span-2">
              <textarea name="ngConditions" defaultValue={profile?.ngConditions ?? ""} rows={2} className="input" />
            </Field>
            <Field label="希望条件" className="sm:col-span-2">
              <textarea name="preferences" defaultValue={profile?.preferences ?? ""} rows={2} className="input" />
            </Field>
            <Field label="スキルシート URL">
              <input name="skillSheetUrl" defaultValue={profile?.skillSheetUrl ?? ""} className="input" />
            </Field>
            <Field label="メール署名" className="sm:col-span-2">
              <textarea name="signature" defaultValue={profile?.signature ?? ""} rows={3} className="input font-mono text-xs" />
            </Field>
            <Field label="文体の指示" className="sm:col-span-2" hint="例: 丁寧だが簡潔。要点は箇条書き。">
              <input name="writingStyle" defaultValue={profile?.writingStyle ?? ""} className="input" />
            </Field>
            <Field label="過去に自分で書いたメールのサンプル" className="sm:col-span-2" hint="AI が文体を合わせるために参照します">
              <textarea name="styleSamples" defaultValue={profile?.styleSamples ?? ""} rows={5} className="input font-mono text-xs" />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton>プロフィールを保存</SubmitButton>
            </div>
          </form>
        </Card>

        <Card id="policy" title="返信ポリシー">
          <form action={savePolicyAction} className="space-y-6">
            <div>
              <label className="label">運用モード</label>
              <div className="space-y-2 text-sm">
                {Object.entries(POLICY_MODE_LABELS).map(([k, v]) => (
                  <label key={k} className="flex items-center gap-2">
                    <input type="radio" name="mode" value={k} defaultChecked={policy.mode === k} />
                    {v}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <label className="label">承認が必要なカテゴリ</label>
                <div className="grid grid-cols-2 gap-1 text-sm">
                  {MESSAGE_CATEGORIES.map((c) => (
                    <label key={c} className="flex items-center gap-2">
                      <input type="checkbox" name="approvalCategories" value={c} defaultChecked={policy.approvalCategories.includes(c)} />
                      {CATEGORY_LABELS[c]}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">返信しないカテゴリ</label>
                <div className="grid grid-cols-2 gap-1 text-sm">
                  {MESSAGE_CATEGORIES.map((c) => (
                    <label key={c} className="flex items-center gap-2">
                      <input type="checkbox" name="noReplyCategories" value={c} defaultChecked={policy.noReplyCategories.includes(c)} />
                      {CATEGORY_LABELS[c]}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="label">返信に含まれると承認が必要になる内容</label>
              <div className="grid grid-cols-2 gap-1 text-sm md:grid-cols-4">
                {commitmentOptions.map((c) => (
                  <label key={c} className="flex items-center gap-2">
                    <input type="checkbox" name="approvalCommitments" value={c} defaultChecked={policy.approvalCommitments.includes(c)} />
                    {COMMITMENT_LABELS[c]}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm sm:col-span-3">
                <input type="checkbox" name="requireApprovalForNewAgents" defaultChecked={policy.requireApprovalForNewAgents} />
                新規エージェントへの初回返信は承認を必要とする
              </label>
              <Field label="信頼度の閾値(0〜1)" hint="これ未満の返信案は承認待ちになります">
                <input name="confidenceThreshold" type="number" step="0.05" min={0} max={1} defaultValue={policy.confidenceThreshold} className="input" />
              </Field>
              <Field label="1スレッドあたりの自動返信上限(24時間)">
                <input name="maxAutoRepliesPerThreadPerDay" type="number" min={0} max={50} defaultValue={policy.maxAutoRepliesPerThreadPerDay} className="input" />
              </Field>
              <Field label="タイムゾーン">
                <input name="timezone" defaultValue={policy.timezone} className="input" />
              </Field>
              <Field label="営業時間 開始(時)">
                <input name="businessHoursStart" type="number" min={0} max={23} defaultValue={policy.businessHoursStart} className="input" />
              </Field>
              <Field label="営業時間 終了(時)">
                <input name="businessHoursEnd" type="number" min={1} max={24} defaultValue={policy.businessHoursEnd} className="input" />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" name="replyOnWeekends" defaultChecked={policy.replyOnWeekends} />
                土日も送信する
              </label>
              <Field label="送信遅延 最小(分)" hint="受信から返信までの待ち時間">
                <input name="minDelayMinutes" type="number" min={0} max={1440} defaultValue={policy.minDelayMinutes} className="input" />
              </Field>
              <Field label="送信遅延 最大(分)">
                <input name="maxDelayMinutes" type="number" min={0} max={1440} defaultValue={policy.maxDelayMinutes} className="input" />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" name="replyAll" defaultChecked={policy.replyAll} />
                元メールの CC にも返信する(全員に返信)
              </label>
            </div>

            <Field label="AI への追加指示" hint="本人からの直接の指示として最優先で反映されます(例: 単価は提示しない。面談は平日夜のみ。)">
              <textarea name="customInstructions" defaultValue={policy.customInstructions ?? ""} rows={4} className="input" />
            </Field>

            <Field
              label="除外する送信者"
              hint="1 行に 1 つ。メールアドレス(例: levtech-direct@levtech.jp)またはドメイン(例: scout.example.com)。登録済みのエージェントと同じドメインでも、ここに書いた送信者のメールは取り込みません。一斉配信・自動送信・no-reply のメールは設定に関係なく取り込みません。"
            >
              <textarea name="excludedSenders" defaultValue={policy.excludedSenders.join("\n")} rows={4} className="input font-mono text-xs" />
            </Field>

            <SubmitButton>返信ポリシーを保存</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
