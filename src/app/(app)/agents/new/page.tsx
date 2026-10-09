import Link from "next/link";
import { createAgentAction } from "@/actions/agents";
import { Card, Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";

export default function NewAgentPage() {
  return (
    <>
      <Link href="/agents" className="text-xs text-slate-500 hover:underline">
        ← エージェント一覧
      </Link>
      <PageHeader title="エージェントを登録" description="ドメインを登録しておくと、そのドメインからのメールは AI の判定なしで取り込まれます。" />
      <Card>
        <form action={createAgentAction} className="grid max-w-2xl grid-cols-1 gap-4">
          <Field label="会社名">
            <input name="name" required className="input" placeholder="株式会社◯◯" />
          </Field>
          <Field label="メールドメイン(カンマ区切り)" hint="例: example.co.jp, mail.example.co.jp">
            <input name="domains" className="input" />
          </Field>
          <Field label="Web サイト">
            <input name="website" className="input" placeholder="https://" />
          </Field>
          <Field label="メモ" hint="AI が返信を書くときにも参照します(例: 対応が丁寧、単価交渉に強い)">
            <textarea name="notes" rows={3} className="input" />
          </Field>
          <Field label="状態">
            <select name="status" defaultValue="ACTIVE" className="input w-48">
              <option value="ACTIVE">有効</option>
              <option value="PAUSED">一時停止(自動送信しない)</option>
              <option value="BLOCKED">ブロック(返信しない)</option>
            </select>
          </Field>
          <div>
            <SubmitButton>登録</SubmitButton>
          </div>
        </form>
      </Card>
    </>
  );
}
