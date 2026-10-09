import Link from "next/link";
import type { OpportunityStage } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { OPPORTUNITY_STAGE_LABELS, OPPORTUNITY_STAGE_ORDER, formatRate } from "@/lib/format";
import { opportunityStageAction } from "@/actions/opportunities";
import { FitBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/ui/AutoSubmitSelect";

const ACTIVE_STAGES: OpportunityStage[] = ["NEW", "INTERESTED", "APPLIED", "INTERVIEW_SCHEDULING", "INTERVIEWED", "OFFER"];
const CLOSED_STAGES: OpportunityStage[] = ["ACCEPTED", "DECLINED", "LOST", "CLOSED"];

export default async function OpportunitiesPage() {
  const user = await requireUser();
  const opportunities = await prisma.opportunity.findMany({
    where: { userId: user.id },
    orderBy: [{ updatedAt: "desc" }],
    include: { agent: { select: { id: true, name: true } } },
  });
  const stageOptions = OPPORTUNITY_STAGE_ORDER.map((s) => ({ value: s, label: OPPORTUNITY_STAGE_LABELS[s] }));
  const byStage = (stage: OpportunityStage) => opportunities.filter((o) => o.stage === stage);
  const closed = opportunities.filter((o) => CLOSED_STAGES.includes(o.stage));

  return (
    <>
      <PageHeader title="案件パイプライン" description="エージェントから紹介された案件を段階ごとに管理します。案件は紹介メールから自動登録されます。" />

      {opportunities.length === 0 ? (
        <EmptyState title="案件はまだありません" description="案件紹介メールを同期すると自動で登録されます。" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {ACTIVE_STAGES.map((stage) => {
              const items = byStage(stage);
              return (
                <div key={stage} className="rounded-xl border border-slate-200 bg-slate-50/60 p-2">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-xs font-semibold text-slate-700">{OPPORTUNITY_STAGE_LABELS[stage]}</span>
                    <span className="text-xs text-slate-400">{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((o) => (
                      <div key={o.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
                        <Link href={`/opportunities/${o.id}`} className="block text-sm font-medium leading-5 text-slate-800 hover:underline">
                          {o.title}
                        </Link>
                        <div className="mt-1 text-xs text-slate-500">{o.agent?.name ?? "-"}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                          <span>{formatRate(o.rateMin, o.rateMax, o.rateText)}</span>
                          <FitBadge score={o.fitScore} />
                        </div>
                        {o.remotePolicy && <div className="mt-1 text-xs text-slate-500">{o.remotePolicy}</div>}
                        <form action={opportunityStageAction} className="mt-2">
                          <input type="hidden" name="opportunityId" value={o.id} />
                          <AutoSubmitSelect name="stage" defaultValue={o.stage} options={stageOptions} className="input py-1 text-xs" />
                        </form>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <h2 className="mt-8 mb-2 text-sm font-semibold text-slate-700">終了した案件({closed.length})</h2>
          {closed.length === 0 ? (
            <p className="text-sm text-slate-500">まだありません。</p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {closed.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/opportunities/${o.id}`} className="block truncate text-sm font-medium text-slate-800 hover:underline">
                      {o.title}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {o.agent?.name ?? "-"} ・ {formatRate(o.rateMin, o.rateMax, o.rateText)}
                    </div>
                  </div>
                  <form action={opportunityStageAction}>
                    <input type="hidden" name="opportunityId" value={o.id} />
                    <AutoSubmitSelect name="stage" defaultValue={o.stage} options={stageOptions} className="input w-32 py-1 text-xs" />
                  </form>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
