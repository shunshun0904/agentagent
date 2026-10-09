import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export type ActivityInput = {
  type: string;
  message: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
};

/** 活動ログを記録する。ログの失敗で本処理を止めないよう例外は握りつぶす。 */
export async function logActivity(userId: string, input: ActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        userId,
        type: input.type,
        message: input.message,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    console.error("[activity] ログの記録に失敗しました", error);
  }
}
