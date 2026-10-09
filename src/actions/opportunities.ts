"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth/session";
import { OPPORTUNITY_STAGES } from "@/lib/ai/schemas";
import { OPPORTUNITY_STAGE_LABELS } from "@/lib/format";
import { dateOrNull, int, list, oneOf, optStr, str } from "@/actions/form";

function revalidateOpportunity(id: string, threadId: string | null) {
  revalidatePath("/");
  revalidatePath("/opportunities");
  revalidatePath(`/opportunities/${id}`);
  if (threadId) revalidatePath(`/inbox/${threadId}`);
}

export async function opportunityStageAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, "opportunityId");
  const stage = oneOf(formData, "stage", OPPORTUNITY_STAGES);
  if (!stage) throw new Error("不正なステージです");
  const opportunity = await prisma.opportunity.findFirst({ where: { id, userId: user.id } });
  if (!opportunity) throw new Error("案件が見つかりません");
  await prisma.opportunity.update({ where: { id: opportunity.id }, data: { stage } });
  await logActivity(user.id, {
    type: "opportunity.stage",
    entityType: "opportunity",
    entityId: opportunity.id,
    message: `案件「${opportunity.title}」を「${OPPORTUNITY_STAGE_LABELS[stage]}」に移動しました`,
  });
  revalidateOpportunity(opportunity.id, opportunity.threadId);
}

export async function updateOpportunityAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, "opportunityId");
  const opportunity = await prisma.opportunity.findFirst({ where: { id, userId: user.id } });
  if (!opportunity) throw new Error("案件が見つかりません");
  await prisma.opportunity.update({
    where: { id: opportunity.id },
    data: {
      title: str(formData, "title") || opportunity.title,
      description: optStr(formData, "description"),
      rateMin: int(formData, "rateMin"),
      rateMax: int(formData, "rateMax"),
      rateText: optStr(formData, "rateText"),
      period: optStr(formData, "period"),
      startText: optStr(formData, "startText"),
      location: optStr(formData, "location"),
      remotePolicy: optStr(formData, "remotePolicy"),
      skills: list(formData, "skills"),
      stage: oneOf(formData, "stage", OPPORTUNITY_STAGES) ?? opportunity.stage,
      interviewAt: dateOrNull(formData, "interviewAt"),
      notes: optStr(formData, "notes"),
    },
  });
  revalidateOpportunity(opportunity.id, opportunity.threadId);
  redirect(`/opportunities/${opportunity.id}?saved=1`);
}
