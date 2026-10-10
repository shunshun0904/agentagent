import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { tryAcquireLock } from "@/lib/lock";
import type { AiService } from "@/lib/ai/service";
import { GmailNotConnectedError, type GmailContext } from "@/lib/gmail/client";
import { syncUserMailbox, type SyncResult } from "@/lib/gmail/sync";
import { dispatchDueReplies } from "@/lib/pipeline/dispatch";
import { processPendingMessages, type ProcessResult } from "@/lib/pipeline/process-message";

export type TickResult = {
  userId: string;
  /** 別の処理が実行中で今回はスキップした場合 "locked" */
  skipped: "locked" | null;
  sync: SyncResult | null;
  process: ProcessResult | null;
  dispatch: { sent: number; failed: number } | null;
  errors: string[];
  durationMs: number;
};

export type TickDeps = {
  ai?: AiService;
  gmail?: GmailContext;
  now?: () => Date;
  /** 1回の実行に使える時間(秒)。省略時は TICK_TIME_BUDGET_SECONDS */
  budgetSeconds?: number;
};

/** ロックの有効期限に足す余裕。処理が予算を超えて長引いても、この時間内は二重実行しない */
const LOCK_MARGIN_MS = 10 * 60 * 1000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 1ユーザー分の定期処理を実行する。
 * 1. Gmail 同期(予算の半分まで)。新着により古い返信案が取り消されるので、送信より先に行う
 * 2. 送信予定時刻を過ぎた返信の送信
 * 3. 未処理メールの分析と返信案の作成(残りの予算まで)
 * 同じユーザーの処理は JobLock で同時に1つしか動かない。
 */
export async function runTick(userId: string, deps: TickDeps = {}): Promise<TickResult> {
  const started = Date.now();
  const budgetMs = (deps.budgetSeconds ?? getEnv().TICK_TIME_BUDGET_SECONDS) * 1000;
  const result: TickResult = { userId, skipped: null, sync: null, process: null, dispatch: null, errors: [], durationMs: 0 };

  const lock = await tryAcquireLock(`tick:${userId}`, budgetMs + LOCK_MARGIN_MS);
  if (!lock) {
    result.skipped = "locked";
    result.durationMs = Date.now() - started;
    return result;
  }

  try {
    try {
      result.sync = await syncUserMailbox(userId, { ...deps, deadline: started + budgetMs * 0.5 });
    } catch (error) {
      if (!(error instanceof GmailNotConnectedError)) {
        result.errors.push(`sync: ${describe(error)}`);
      }
    }

    try {
      result.dispatch = await dispatchDueReplies(userId, { gmail: deps.gmail, now: deps.now });
    } catch (error) {
      result.errors.push(`dispatch: ${describe(error)}`);
    }

    try {
      result.process = await processPendingMessages(userId, { ai: deps.ai, now: deps.now, deadline: started + budgetMs });
    } catch (error) {
      result.errors.push(`process: ${describe(error)}`);
    }
  } finally {
    await lock.release();
  }

  result.durationMs = Date.now() - started;
  return result;
}

/** Gmail を連携している全ユーザー分を順番に実行する */
export async function runTickForAllUsers(deps: TickDeps = {}): Promise<TickResult[]> {
  const users = await prisma.user.findMany({
    where: { googleAccount: { isNot: null } },
    select: { id: true },
  });
  const results: TickResult[] = [];
  for (const user of users) {
    results.push(await runTick(user.id, deps));
  }
  return results;
}
