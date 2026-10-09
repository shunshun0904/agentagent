import { prisma } from "@/lib/db";

/** 期限切れセッションの掃除(ワーカーから定期的に呼ぶ) */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}
