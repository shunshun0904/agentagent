import { NextResponse } from "next/server";
import { buildGoogleAuthUrl } from "@/lib/auth/google-oauth";
import { randomToken } from "@/lib/crypto";
import { getEnv, isGoogleConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

const OAUTH_STATE_COOKIE = "aa_oauth_state";

export async function GET() {
  const env = getEnv();
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL("/login?error=google_not_configured", env.APP_URL));
  }
  const state = randomToken(16);
  const response = NextResponse.redirect(buildGoogleAuthUrl(state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return response;
}
