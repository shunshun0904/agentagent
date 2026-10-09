import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { randomToken, sha256Hex } from "@/lib/crypto";
import type { User } from "@/generated/prisma/client";

export const SESSION_COOKIE_NAME = "aa_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日

export type SessionCookie = {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: "lax";
    secure: boolean;
    path: "/";
    expires: Date;
  };
};

/** セッションを作成し、呼び出し側で設定する Cookie 情報を返す */
export async function createSession(userId: string): Promise<SessionCookie> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: sha256Hex(token), expiresAt },
  });
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: expiresAt,
    },
  };
}

/** 現在のリクエストのユーザー。未ログインなら null。リクエスト内でキャッシュされる。 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  return session.user;
});

/** ログイン必須のページ・アクションで使う。未ログインなら /login へ。 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** 現在のセッションを破棄する(Cookie の削除は呼び出し側で行う) */
export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
}
