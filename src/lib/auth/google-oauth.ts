import { google } from "googleapis";
import { getEnv } from "@/lib/env";

/** ログインと Gmail 連携に必要なスコープ */
export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.modify",
];

export function googleRedirectUri(): string {
  return `${getEnv().APP_URL}/api/auth/google/callback`;
}

export function createOAuth2Client() {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が設定されていません");
  }
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, googleRedirectUri());
}

export function buildGoogleAuthUrl(state: string): string {
  return createOAuth2Client().generateAuthUrl({
    access_type: "offline",
    // リフレッシュトークンを毎回確実に受け取るため同意画面を表示する
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export type GoogleTokenSet = {
  accessToken: string | null;
  refreshToken: string | null;
  expiryDate: number | null;
  scope: string | null;
};

export type GoogleUserInfo = {
  id: string;
  email: string;
  name: string | null;
};

/** 認可コードをトークンに交換し、ユーザー情報を取得する */
export async function exchangeGoogleCode(code: string): Promise<{ tokens: GoogleTokenSet; userinfo: GoogleUserInfo }> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  if (!data.id || !data.email) {
    throw new Error("Google からユーザー情報を取得できませんでした");
  }
  return {
    tokens: {
      accessToken: tokens.access_token ?? null,
      refreshToken: tokens.refresh_token ?? null,
      expiryDate: tokens.expiry_date ?? null,
      scope: tokens.scope ?? null,
    },
    userinfo: { id: data.id, email: data.email, name: data.name ?? null },
  };
}
