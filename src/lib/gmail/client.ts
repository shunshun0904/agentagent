import { google, type gmail_v1, type Auth } from "googleapis";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createOAuth2Client } from "@/lib/auth/google-oauth";

export class GmailNotConnectedError extends Error {
  constructor() {
    super("Gmail が連携されていません");
    this.name = "GmailNotConnectedError";
  }
}

export type GmailContext = {
  gmail: gmail_v1.Gmail;
  accountId: string;
  accountEmail: string;
};

async function persistRefreshedTokens(accountId: string, tokens: Auth.Credentials): Promise<void> {
  try {
    await prisma.googleAccount.update({
      where: { id: accountId },
      data: {
        ...(tokens.access_token ? { encryptedAccessToken: encryptSecret(tokens.access_token) } : {}),
        ...(tokens.expiry_date ? { accessTokenExpiresAt: new Date(tokens.expiry_date) } : {}),
        ...(tokens.refresh_token ? { encryptedRefreshToken: encryptSecret(tokens.refresh_token) } : {}),
      },
    });
  } catch (error) {
    console.error("[gmail] トークンの保存に失敗しました", error);
  }
}

/** ユーザーの Gmail API クライアントを返す。アクセストークンは自動更新される。 */
export async function getGmailForUser(userId: string): Promise<GmailContext> {
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  if (!account) throw new GmailNotConnectedError();

  const auth = createOAuth2Client();
  auth.setCredentials({
    refresh_token: decryptSecret(account.encryptedRefreshToken),
    access_token: account.encryptedAccessToken ? decryptSecret(account.encryptedAccessToken) : undefined,
    expiry_date: account.accessTokenExpiresAt?.getTime(),
  });
  auth.on("tokens", (tokens) => {
    void persistRefreshedTokens(account.id, tokens);
  });

  return {
    gmail: google.gmail({ version: "v1", auth }),
    accountId: account.id,
    accountEmail: account.email.toLowerCase(),
  };
}
