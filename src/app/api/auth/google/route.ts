import { NextResponse } from "next/server";
import { buildGoogleAuthUrl } from "@/lib/auth/google-oauth";
import { canonicalUrlFor } from "@/lib/canonical";
import { randomToken } from "@/lib/crypto";
import { getEnv, isGoogleConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

const OAUTH_STATE_COOKIE = "aa_oauth_state";

export async function GET(request: Request) {
  const env = getEnv();
  // APP_URL 以外のホスト(Cloud Run の別 URL など)から来た場合は APP_URL 側でやり直す
  const canonical = canonicalUrlFor(request.headers.get("host"), "/api/auth/google");
  if (canonical) return NextResponse.redirect(canonical);
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
