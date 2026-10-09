"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { runTick } from "@/lib/pipeline/tick";

/** 「今すぐ同期」: 同期 → 分析・返信案作成 → 予定送信 を実行する */
export async function syncNowAction(): Promise<void> {
  const user = await requireUser();
  await runTick(user.id);
  revalidatePath("/", "layout");
  redirect("/activity?synced=1");
}
