"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth/session";
import { MESSAGE_CATEGORIES } from "@/lib/ai/schemas";
import { COMMITMENT_TYPES } from "@/lib/policy/defaults";
import { parseExcludedSenders } from "@/lib/policy/exclusions";
import { bool, dateOrNull, int, list, multi, num, oneOf, optStr, str } from "@/actions/form";

const AVAILABILITY = ["LOOKING", "OPEN_TO_OFFERS", "NOT_LOOKING"] as const;
const WORK_STYLES = ["REMOTE_ONLY", "HYBRID", "ONSITE_OK"] as const;
const POLICY_MODES = ["AUTO_WITH_APPROVAL", "APPROVE_ALL", "FULL_AUTO"] as const;

function clamp(value: number | null, min: number, max: number, fallback: number): number {
  if (value === null || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function validTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return "Asia/Tokyo";
  }
}

export async function saveProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const data = {
    displayName: str(formData, "displayName") || user.name || user.email,
    headline: optStr(formData, "headline"),
    yearsOfExperience: int(formData, "yearsOfExperience"),
    skills: list(formData, "skills"),
    summary: optStr(formData, "summary"),
    desiredRateMin: int(formData, "desiredRateMin"),
    desiredRateMax: int(formData, "desiredRateMax"),
    availabilityStatus: oneOf(formData, "availabilityStatus", AVAILABILITY) ?? "LOOKING",
    availableFrom: dateOrNull(formData, "availableFrom"),
    weeklyDays: optStr(formData, "weeklyDays"),
    workStyle: oneOf(formData, "workStyle", WORK_STYLES) ?? "REMOTE_ONLY",
    locations: list(formData, "locations"),
    ngConditions: optStr(formData, "ngConditions"),
    preferences: optStr(formData, "preferences"),
    interviewAvailability: optStr(formData, "interviewAvailability"),
    skillSheetUrl: optStr(formData, "skillSheetUrl"),
    signature: optStr(formData, "signature"),
    writingStyle: optStr(formData, "writingStyle"),
    styleSamples: optStr(formData, "styleSamples"),
  };
  await prisma.profile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });
  await logActivity(user.id, { type: "settings.profile", message: "プロフィールを更新しました" });
  revalidatePath("/settings");
  redirect("/settings?saved=profile#profile");
}

export async function savePolicyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const categories = new Set<string>(MESSAGE_CATEGORIES);
  const commitments = new Set<string>(COMMITMENT_TYPES);
  const data = {
    mode: oneOf(formData, "mode", POLICY_MODES) ?? "AUTO_WITH_APPROVAL",
    approvalCategories: multi(formData, "approvalCategories").filter((c) => categories.has(c)),
    noReplyCategories: multi(formData, "noReplyCategories").filter((c) => categories.has(c)),
    approvalCommitments: multi(formData, "approvalCommitments").filter((c) => commitments.has(c)),
    requireApprovalForNewAgents: bool(formData, "requireApprovalForNewAgents"),
    confidenceThreshold: clamp(num(formData, "confidenceThreshold"), 0, 1, 0.7),
    maxAutoRepliesPerThreadPerDay: clamp(int(formData, "maxAutoRepliesPerThreadPerDay"), 0, 50, 2),
    timezone: validTimezone(str(formData, "timezone") || "Asia/Tokyo"),
    businessHoursStart: clamp(int(formData, "businessHoursStart"), 0, 23, 9),
    businessHoursEnd: clamp(int(formData, "businessHoursEnd"), 1, 24, 19),
    replyOnWeekends: bool(formData, "replyOnWeekends"),
    minDelayMinutes: clamp(int(formData, "minDelayMinutes"), 0, 1440, 20),
    maxDelayMinutes: clamp(int(formData, "maxDelayMinutes"), 0, 1440, 90),
    replyAll: bool(formData, "replyAll"),
    customInstructions: optStr(formData, "customInstructions"),
    excludedSenders: parseExcludedSenders(str(formData, "excludedSenders")),
  };
  if (data.maxDelayMinutes < data.minDelayMinutes) data.maxDelayMinutes = data.minDelayMinutes;
  await prisma.replyPolicy.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });
  await logActivity(user.id, { type: "settings.policy", message: `返信ポリシーを更新しました(モード: ${data.mode})` });
  revalidatePath("/settings");
  redirect("/settings?saved=policy#policy");
}

export async function disconnectGoogleAction(): Promise<void> {
  const user = await requireUser();
  await prisma.googleAccount.deleteMany({ where: { userId: user.id } });
  await logActivity(user.id, { type: "settings.gmail_disconnected", message: "Gmail 連携を解除しました" });
  revalidatePath("/settings");
  redirect("/settings?saved=gmail#gmail");
}
