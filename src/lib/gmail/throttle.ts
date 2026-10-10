import { setTimeout as delay } from "node:timers/promises";
import { isTransientError } from "@/lib/errors";

/**
 * Gmail API の呼び出し間隔の最小値(ミリ秒)。
 * 利用上限は1ユーザーあたり毎分 6,000 単位で、messages.get と messages.list は1回 5 単位。
 * 100 ミリ秒間隔なら最大でも毎分 600 回(3,000 単位)に収まる。
 */
export const GMAIL_MIN_INTERVAL_MS = 100;

/** 利用上限や一時的な失敗のときに待つ時間(この回数だけやり直す) */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

export type GmailCaller = <T>(fn: () => Promise<T>) => Promise<T>;

export type GmailCallerOptions = {
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** この時刻(epoch ミリ秒)を過ぎてまで待たない */
  deadline?: number;
};

/** 呼び出しの間隔をあけ、一時的な失敗は待ってからやり直す Gmail API の呼び出し口を作る */
export function createGmailCaller(options: GmailCallerOptions = {}): GmailCaller {
  const minIntervalMs = options.minIntervalMs ?? GMAIL_MIN_INTERVAL_MS;
  const sleep = options.sleep ?? ((ms: number) => delay(ms).then(() => undefined));
  let lastCallAt = 0;

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt += 1) {
      const wait = lastCallAt + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastCallAt = Date.now();
      try {
        return await fn();
      } catch (error) {
        const retryDelay = RETRY_DELAYS_MS[attempt];
        if (retryDelay === undefined || !isTransientError(error)) throw error;
        if (options.deadline !== undefined && Date.now() + retryDelay > options.deadline) throw error;
        await sleep(retryDelay);
      }
    }
  };
}
