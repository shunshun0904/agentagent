import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export type LockHandle = {
  name: string;
  holder: string;
  release(): Promise<void>;
};

/**
 * 期限付きロックの取得を試みる。取得できなければ null を返す(待たない)。
 *
 * 接続プール(トランザクションモード)経由でも動くよう、セッションに依存する
 * advisory lock ではなく JobLock テーブルの行で排他する。
 * 処理中にプロセスが落ちても、lockedUntil を過ぎれば次の実行が取得できる。
 */
export async function tryAcquireLock(name: string, ttlMs: number, now: Date = new Date()): Promise<LockHandle | null> {
  const holder = randomUUID();
  const lockedUntil = new Date(now.getTime() + ttlMs);

  // 1. 期限切れのロックを奪う(行ロックにより同時に1件しか成功しない)
  const taken = await prisma.jobLock.updateMany({
    where: { name, lockedUntil: { lt: now } },
    data: { holder, lockedUntil },
  });

  // 2. ロック行がまだ無ければ作る(主キー重複なら他の処理が先に取得している)
  if (taken.count === 0) {
    try {
      await prisma.jobLock.create({ data: { name, holder, lockedUntil } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
      throw error;
    }
  }

  return {
    name,
    holder,
    async release() {
      try {
        await prisma.jobLock.updateMany({ where: { name, holder }, data: { lockedUntil: new Date(0) } });
      } catch (error) {
        console.error(`[lock] ロック ${name} の解放に失敗しました`, error);
      }
    },
  };
}
