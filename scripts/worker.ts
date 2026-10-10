import "dotenv/config";
import { purgeExpiredSessions } from "@/lib/auth/maintenance";
import { getEnv } from "@/lib/env";
import { runTickForAllUsers } from "@/lib/pipeline/tick";

/**
 * バックグラウンドワーカー。
 * SYNC_INTERVAL_SECONDS ごとに「Gmail 同期 → 分析・返信案作成 → 予定送信」を実行する。
 */

let stopping = false;
let wake: (() => void) | null = null;

function requestStop(signal: string) {
  console.log(`[worker] ${signal} を受信しました。現在の処理が終わり次第停止します`);
  stopping = true;
  wake?.();
}
process.on("SIGINT", () => requestStop("SIGINT"));
process.on("SIGTERM", () => requestStop("SIGTERM"));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
  });
}

async function main() {
  const env = getEnv();
  const intervalMs = env.SYNC_INTERVAL_SECONDS * 1000;
  console.log(`[worker] 開始(間隔 ${env.SYNC_INTERVAL_SECONDS} 秒、モデル ${env.AGENTAGENT_MODEL})`);
  let tick = 0;

  while (!stopping) {
    const startedAt = Date.now();
    try {
      const results = await runTickForAllUsers();
      for (const r of results) {
        if (r.skipped === "locked") {
          console.log(`[worker] user=${r.userId} 別の処理が実行中のためスキップしました`);
          continue;
        }
        const sync = r.sync ? `取込 ${r.sync.ingested}/除外 ${r.sync.skipped}` : "同期なし";
        const proc = r.process ? `処理 ${r.process.processed}(自動 ${r.process.autoScheduled}/承認 ${r.process.needsApproval}/不要 ${r.process.noReply}/失敗 ${r.process.errors})` : "処理なし";
        const disp = r.dispatch ? `送信 ${r.dispatch.sent}/失敗 ${r.dispatch.failed}` : "送信なし";
        const errors = r.errors.length > 0 ? ` エラー: ${r.errors.join(" | ")}` : "";
        console.log(`[worker] user=${r.userId} ${sync} / ${proc} / ${disp} (${r.durationMs}ms)${errors}`);
      }
      if (results.length === 0) console.log("[worker] Gmail を連携済みのユーザーがいません");
      if (tick % 12 === 0) {
        const purged = await purgeExpiredSessions();
        if (purged > 0) console.log(`[worker] 期限切れセッション ${purged} 件を削除しました`);
      }
    } catch (error) {
      console.error("[worker] 実行中にエラーが発生しました", error);
    }
    tick += 1;
    if (stopping) break;
    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(1000, intervalMs - elapsed));
  }
  console.log("[worker] 停止しました");
  process.exit(0);
}

main().catch((error) => {
  console.error("[worker] 起動に失敗しました", error);
  process.exit(1);
});
