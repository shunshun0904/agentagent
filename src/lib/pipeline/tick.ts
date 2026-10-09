import { prisma } from "@/lib/db";
import type { AiService } from "@/lib/ai/service";
import { GmailNotConnectedError, type GmailContext } from "@/lib/gmail/client";
import { syncUserMailbox, type SyncResult } from "@/lib/gmail/sync";
import { dispatchDueReplies } from "@/lib/pipeline/dispatch";
import { processPendingMessages, type ProcessResult } from "@/lib/pipeline/process-message";

export type TickResult = {
  userId: string;
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
};

/** 1ユーザー分の「同期 → 分析・返信案作成 → 送信」を実行する */
export async function runTick(userId: string, deps: TickDeps = {}): Promise<TickResult> {
  const started = Date.now();
  const result: TickResult = { userId, sync: null, process: null, dispatch: null, errors: [], durationMs: 0 };

  try {
    result.sync = await syncUserMailbox(userId, deps);
  } catch (error) {
    if (!(error instanceof GmailNotConnectedError)) {
      result.errors.push(`sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    result.process = await processPendingMessages(userId, { ai: deps.ai, now: deps.now });
  } catch (error) {
    result.errors.push(`process: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    result.dispatch = await dispatchDueReplies(userId, { gmail: deps.gmail, now: deps.now });
  } catch (error) {
    result.errors.push(`dispatch: ${error instanceof Error ? error.message : String(error)}`);
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
