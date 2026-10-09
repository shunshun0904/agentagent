import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { allowedGoogleEmails } from "@/lib/env";
import { logActivity } from "@/lib/activity";
import { ensureUserDefaults } from "@/lib/policy/defaults";
import type { GoogleTokenSet, GoogleUserInfo } from "@/lib/auth/google-oauth";

export class LoginNotAllowedError extends Error {
  constructor(email: string) {
    super(`${email} はログインを許可されていません`);
    this.name = "LoginNotAllowedError";
  }
}

/**
 * Google ログイン完了処理。ユーザーと Google アカウント(暗号化トークン)を保存し、
 * プロフィールと返信ポリシーの既定値を用意する。戻り値はユーザー ID。
 */
export async function completeGoogleLogin(tokens: GoogleTokenSet, userinfo: GoogleUserInfo): Promise<string> {
  const email = userinfo.email.toLowerCase();
  const allowed = allowedGoogleEmails();
  if (allowed && !allowed.includes(email)) {
    throw new LoginNotAllowedError(email);
  }

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: userinfo.name },
    update: { name: userinfo.name ?? undefined },
  });

  const existing = await prisma.googleAccount.findUnique({ where: { userId: user.id } });
  const refreshToken = tokens.refreshToken;
  if (!refreshToken && !existing) {
    throw new Error(
      "Google からリフレッシュトークンを受け取れませんでした。Google アカウントの「サードパーティのアクセス」からこのアプリを削除してから再度ログインしてください",
    );
  }

  const encryptedAccessToken = tokens.accessToken ? encryptSecret(tokens.accessToken) : null;
  const accessTokenExpiresAt = tokens.expiryDate ? new Date(tokens.expiryDate) : null;

  await prisma.googleAccount.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      googleId: userinfo.id,
      email,
      encryptedRefreshToken: encryptSecret(refreshToken as string),
      encryptedAccessToken,
      accessTokenExpiresAt,
      scopes: tokens.scope ?? "",
    },
    update: {
      googleId: userinfo.id,
      email,
      ...(refreshToken ? { encryptedRefreshToken: encryptSecret(refreshToken) } : {}),
      encryptedAccessToken,
      accessTokenExpiresAt,
      scopes: tokens.scope ?? existing?.scopes ?? "",
      lastSyncError: null,
    },
  });

  await ensureUserDefaults(user.id, { displayName: userinfo.name ?? email.split("@")[0] ?? "" });
  await logActivity(user.id, { type: "auth.login", message: `${email} が Google でログインしました` });
  return user.id;
}
