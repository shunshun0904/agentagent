"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth/session";
import { bool, int, list, oneOf, optStr, str } from "@/actions/form";

const AGENT_STATUSES = ["ACTIVE", "PAUSED", "BLOCKED"] as const;

function normalizeDomains(domains: string[]): string[] {
  return Array.from(new Set(domains.map((d) => d.toLowerCase().replace(/^@/, "")).filter((d) => d.includes("."))));
}

export async function createAgentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = str(formData, "name");
  if (!name) throw new Error("会社名を入力してください");
  const agent = await prisma.agent.create({
    data: {
      userId: user.id,
      name,
      domains: normalizeDomains(list(formData, "domains")),
      website: optStr(formData, "website"),
      notes: optStr(formData, "notes"),
      status: oneOf(formData, "status", AGENT_STATUSES) ?? "ACTIVE",
    },
  });
  await logActivity(user.id, {
    type: "agent.created",
    entityType: "agent",
    entityId: agent.id,
    message: `エージェント「${name}」を登録しました`,
  });
  revalidatePath("/agents");
  redirect(`/agents/${agent.id}`);
}

export async function updateAgentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const agentId = str(formData, "agentId");
  const agent = await prisma.agent.findFirst({ where: { id: agentId, userId: user.id } });
  if (!agent) throw new Error("エージェントが見つかりません");
  const name = str(formData, "name") || agent.name;
  const rating = int(formData, "rating");
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      name,
      domains: normalizeDomains(list(formData, "domains")),
      website: optStr(formData, "website"),
      notes: optStr(formData, "notes"),
      status: oneOf(formData, "status", AGENT_STATUSES) ?? agent.status,
      rating: rating !== null && rating >= 1 && rating <= 5 ? rating : null,
      autoReplyEnabled: bool(formData, "autoReplyEnabled"),
      requireApproval: bool(formData, "requireApproval"),
    },
  });
  await logActivity(user.id, {
    type: "agent.updated",
    entityType: "agent",
    entityId: agent.id,
    message: `エージェント「${name}」の設定を更新しました`,
  });
  revalidatePath("/agents");
  revalidatePath(`/agents/${agent.id}`);
  redirect(`/agents/${agent.id}?saved=1`);
}

export async function updateContactAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const contactId = str(formData, "contactId");
  const contact = await prisma.contact.findFirst({ where: { id: contactId, userId: user.id } });
  if (!contact) throw new Error("担当者が見つかりません");
  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      name: optStr(formData, "name"),
      role: optStr(formData, "role"),
      phone: optStr(formData, "phone"),
      notes: optStr(formData, "notes"),
    },
  });
  revalidatePath(`/agents/${contact.agentId}`);
  redirect(`/agents/${contact.agentId}?saved=1`);
}
