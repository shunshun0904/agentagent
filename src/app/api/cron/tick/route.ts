import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { runTickForAllUsers } from "@/lib/pipeline/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const custom = request.headers.get("x-cron-secret") ?? "";
  return bearer === secret || custom === secret;
}

/**
 * 外部 cron(Vercel Cron など)から定期的に呼ぶエンドポイント。
 * 同期 → 分析・返信案作成 → 予定送信 を全ユーザー分実行する。
 */
async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results = await runTickForAllUsers();
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), results });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
