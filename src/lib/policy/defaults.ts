import { prisma } from "@/lib/db";
import type { MessageCategory, PolicyMode } from "@/generated/prisma/client";

/** 返信に含まれ得るコミットメントの種類(AI の出力と一致させる) */
export const COMMITMENT_TYPES = [
  "express_interest",
  "decline",
  "propose_dates",
  "confirm_date",
  "share_rate",
  "agree_terms",
  "send_document",
  "share_personal_info",
  "none",
] as const;
export type CommitmentType = (typeof COMMITMENT_TYPES)[number];

/** 既定で承認を必須にするカテゴリ */
export const DEFAULT_APPROVAL_CATEGORIES: MessageCategory[] = [
  "RATE_NEGOTIATION",
  "CONTRACT",
  "INTERVIEW_CONFIRMATION",
  "SELECTION_RESULT",
];

/** 既定で返信しないカテゴリ */
export const DEFAULT_NO_REPLY_CATEGORIES: MessageCategory[] = ["NEWSLETTER", "THANKS_CLOSING"];

/** 既定で承認を必須にするコミットメント */
export const DEFAULT_APPROVAL_COMMITMENTS: CommitmentType[] = [
  "decline",
  "confirm_date",
  "share_rate",
  "agree_terms",
  "send_document",
  "share_personal_info",
];

export const DEFAULT_POLICY = {
  mode: "AUTO_WITH_APPROVAL" as PolicyMode,
  approvalCategories: DEFAULT_APPROVAL_CATEGORIES as string[],
  noReplyCategories: DEFAULT_NO_REPLY_CATEGORIES as string[],
  approvalCommitments: DEFAULT_APPROVAL_COMMITMENTS as string[],
  requireApprovalForNewAgents: true,
  confidenceThreshold: 0.7,
  maxAutoRepliesPerThreadPerDay: 2,
  timezone: "Asia/Tokyo",
  businessHoursStart: 9,
  businessHoursEnd: 19,
  replyOnWeekends: false,
  minDelayMinutes: 20,
  maxDelayMinutes: 90,
  replyAll: true,
  customInstructions: null as string | null,
};

/** プロフィールと返信ポリシーが無ければ既定値で作成する */
export async function ensureUserDefaults(userId: string, opts: { displayName: string }): Promise<void> {
  const [profile, policy] = await Promise.all([
    prisma.profile.findUnique({ where: { userId } }),
    prisma.replyPolicy.findUnique({ where: { userId } }),
  ]);
  if (!profile) {
    await prisma.profile.create({
      data: {
        userId,
        displayName: opts.displayName,
        signature: opts.displayName,
      },
    });
  }
  if (!policy) {
    await prisma.replyPolicy.create({ data: { userId, ...DEFAULT_POLICY } });
  }
}
