import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { OPPORTUNITY_STAGE_LABELS, OPPORTUNITY_STAGE_ORDER, formatDateTime } from "@/lib/format";
import { updateOpportunityAction } from "@/actions/opportunities";
import { FitBadge, StageBadge } from "@/components/badges";
import { Card, Field, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";

function toLocalInput(date: Date | null): string {
  if (!date) return "";
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return p.replace(" ", "T");
}

export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { saved } = await searchParams;
  const opportunity = await prisma.opportunity.findFirst({
    where: { id, userId: user.id },
    include: { agent: { select: { id: true, name: true } }, thread: { select: { id: true, subject: true, summary: true } } },
  });
  if (!opportunity) notFound();

  return (
    <>
      <div className="mb-4">
        <Link href="/opportunities" className="text-xs text-slate-500 hover:underline">
          ← 案件パイプライン
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-slate-900">{opportunity.title}</h1>
          <StageBadge stage={opportunity.stage} />
          <FitBadge score={opportunity.fitScore} />
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {opportunity.agent ? (
            <Link href={`/agents/${opportunity.agent.id}`} className="hover:underline">
              {opportunity.agent.name}
            </Link>
          ) : (
            "エージェント未設定"
          )}
          {opportunity.thread && (
            <>
              {" ・ "}
              <Link href={`/inbox/${opportunity.thread.id}`} className="hover:underline">
                スレッド: {opportunity.thread.subject}
              </Link>
            </>
          )}
          {" ・ 登録 "}
          {formatDateTime(opportunity.createdAt)}
        </div>
      </div>

      {saved && <Notice>保存しました。</Notice>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="案件情報">
            <form action={updateOpportunityAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input type="hidden" name="opportunityId" value={opportunity.id} />
              <Field label="案件名" className="sm:col-span-2">
                <input name="title" defaultValue={opportunity.title} className="input" />
              </Field>
              <Field label="概要" className="sm:col-span-2">
                <textarea name="description" defaultValue={opportunity.description ?? ""} rows={3} className="input" />
              </Field>
              <Field label="単価 下限(万円/月)">
                <input name="rateMin" type="number" defaultValue={opportunity.rateMin ?? ""} className="input" />
              </Field>
              <Field label="単価 上限(万円/月)">
                <input name="rateMax" type="number" defaultValue={opportunity.rateMax ?? ""} className="input" />
              </Field>
              <Field label="単価の原文">
                <input name="rateText" defaultValue={opportunity.rateText ?? ""} className="input" />
              </Field>
              <Field label="期間">
                <input name="period" defaultValue={opportunity.period ?? ""} className="input" />
              </Field>
              <Field label="開始時期">
                <input name="startText" defaultValue={opportunity.startText ?? ""} className="input" />
              </Field>
              <Field label="勤務地">
                <input name="location" defaultValue={opportunity.location ?? ""} className="input" />
              </Field>
              <Field label="リモート可否">
                <input name="remotePolicy" defaultValue={opportunity.remotePolicy ?? ""} className="input" />
              </Field>
              <Field label="スキル(カンマ区切り)">
                <input name="skills" defaultValue={opportunity.skills.join(", ")} className="input" />
              </Field>
              <Field label="ステージ">
                <select name="stage" defaultValue={opportunity.stage} className="input">
                  {OPPORTUNITY_STAGE_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {OPPORTUNITY_STAGE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="面談日時(日本時間)">
                <input name="interviewAt" type="datetime-local" defaultValue={toLocalInput(opportunity.interviewAt)} className="input" />
              </Field>
              <Field label="メモ" className="sm:col-span-2">
                <textarea name="notes" defaultValue={opportunity.notes ?? ""} rows={4} className="input" />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton>保存</SubmitButton>
              </div>
            </form>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="AI の評価">
            <p className="text-sm leading-6 text-slate-700">{opportunity.fitReason ?? "評価はまだありません。"}</p>
          </Card>
          {opportunity.thread?.summary && (
            <Card title="スレッドの要約">
              <p className="text-sm leading-6 text-slate-700">{opportunity.thread.summary}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
