import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { getEnv, isDevLoginEnabled } from "@/lib/env";
import { ensureUserDefaults } from "@/lib/policy/defaults";

export const dynamic = "force-dynamic";

const DEMO_USER_EMAIL = "demo@example.com";

/** 開発用ログイン。DEV_LOGIN_ENABLED=true かつ本番以外でのみ有効。 */
export async function POST() {
  if (!isDevLoginEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    create: { email: DEMO_USER_EMAIL, name: "デモユーザー" },
    update: {},
  });
  await ensureUserDefaults(user.id, { displayName: user.name ?? "デモユーザー" });
  const session = await createSession(user.id);
  const response = NextResponse.redirect(new URL("/", getEnv().APP_URL), 303);
  response.cookies.set(session.name, session.value, session.options);
  return response;
}
