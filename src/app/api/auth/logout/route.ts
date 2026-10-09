import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, destroyCurrentSession } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST() {
  await destroyCurrentSession();
  const response = NextResponse.redirect(new URL("/login", getEnv().APP_URL), 303);
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
