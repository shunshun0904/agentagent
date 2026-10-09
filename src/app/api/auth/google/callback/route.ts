import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeGoogleCode } from "@/lib/auth/google-oauth";
import { LoginNotAllowedError, completeGoogleLogin } from "@/lib/auth/google-login";
import { createSession } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const OAUTH_STATE_COOKIE = "aa_oauth_state";

function loginRedirect(error: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${error}`, getEnv().APP_URL));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;

  if (oauthError) return loginRedirect("google_denied");
  if (!code || !state || !expectedState || state !== expectedState) return loginRedirect("invalid_state");

  try {
    const { tokens, userinfo } = await exchangeGoogleCode(code);
    const userId = await completeGoogleLogin(tokens, userinfo);
    const session = await createSession(userId);
    const response = NextResponse.redirect(new URL("/", getEnv().APP_URL));
    response.cookies.set(session.name, session.value, session.options);
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    if (error instanceof LoginNotAllowedError) return loginRedirect("not_allowed");
    console.error("[auth] Google ログインに失敗しました", error);
    return loginRedirect("login_failed");
  }
}
