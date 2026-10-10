import { setTimeout as delay } from "node:timers/promises";
import { isTransientError } from "@/lib/errors";

/**
 * Gmail API のメソッドごとの利用単位(2026年5月1日以降に作られたプロジェクトの値)。
 * 上限は 1 ユーザーあたり毎分 6,000 単位(GMAIL_QUOTA_UNITS_PER_MINUTE で変更できる。古いプロジェクトは 15,000)。
 */
export const GMAIL_UNITS = { list: 5, get: 20, send: 100 } as const;

/** 上限のうち、同期で使う割合。送信など同期以外の呼び出しと、計測のずれに備えて余裕を残す */
export const GMAIL_BUDGET_RATIO = 0.75;

/** 呼び出し間隔の最小値(ミリ秒)。単位の少ない一覧取得でも連打しない */
export const GMAIL_MIN_INTERVAL_MS = 100;

/** 1 分あたりの上限は 1 分たたないと空かないため、短い間隔でやり直しても意味がない */
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

const WINDOW_MS = 60_000;

export type GmailCaller = <T>(fn: () => Promise<T>, units?: number) => Promise<T>;

export type GmailCallerOptions = {
  /** 1 分あたりに使ってよい単位。省略時は無制限(テスト用) */
  unitsPerMinute?: number;
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** この時刻(epoch ミリ秒)を過ぎてまで待たない */
  deadline?: number;
  now?: () => number;
};

/** 上限から、同期で使ってよい 1 分あたりの単位を求める */
export function gmailUnitsBudget(quotaUnitsPerMinute: number): number {
  return Math.floor(quotaUnitsPerMinute * GMAIL_BUDGET_RATIO);
}

/**
 * Gmail API の呼び出し口を作る。直近 1 分間に使った単位を数え、上限を超えそうなら枠が空くまで待つ。
 * 一時的な失敗は待ってからやり直す。
 */
export function createGmailCaller(options: GmailCallerOptions = {}): GmailCaller {
  const budget = options.unitsPerMinute ?? Number.POSITIVE_INFINITY;
  const minIntervalMs = options.minIntervalMs ?? GMAIL_MIN_INTERVAL_MS;
  const sleep = options.sleep ?? ((ms: number) => delay(ms).then(() => undefined));
  const now = options.now ?? Date.now;
  const ledger: { at: number; units: number }[] = [];
  let lastCallAt = Number.NEGATIVE_INFINITY;

  const usedUnits = () => {
    const cutoff = now() - WINDOW_MS;
    while (ledger.length > 0 && ledger[0]!.at <= cutoff) ledger.shift();
    return ledger.reduce((sum, e) => sum + e.units, 0);
  };

  const waitForBudget = async (units: number) => {
    while (usedUnits() + units > budget && ledger.length > 0) {
      const wait = ledger[0]!.at + WINDOW_MS - now();
      if (wait <= 0) continue;
      if (options.deadline !== undefined && now() + wait > options.deadline) {
        throw Object.assign(new Error("Gmail API の 1 分あたりの利用上限に近いため、残りは次回の処理に回します"), { code: 429 });
      }
      await sleep(wait);
    }
  };

  return async <T>(fn: () => Promise<T>, units: number = GMAIL_UNITS.get): Promise<T> => {
    for (let attempt = 0; ; attempt += 1) {
      await waitForBudget(units);
      const gap = lastCallAt + minIntervalMs - now();
      if (gap > 0) await sleep(gap);
      lastCallAt = now();
      ledger.push({ at: lastCallAt, units });
      try {
        return await fn();
      } catch (error) {
        const retryDelay = RETRY_DELAYS_MS[attempt];
        if (retryDelay === undefined || !isTransientError(error)) throw error;
        if (options.deadline !== undefined && now() + retryDelay > options.deadline) throw error;
        await sleep(retryDelay);
      }
    }
  };
}
