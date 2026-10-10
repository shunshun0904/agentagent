import { getEnv } from "@/lib/env";

/**
 * リクエストのホストが APP_URL と異なる場合、APP_URL 側の同じパスの URL を返す。
 * Cloud Run はサービスごとに複数の URL を持つため、OAuth の state Cookie とリダイレクト先の
 * ドメインを APP_URL にそろえる目的で使う。ホストが一致していれば null。
 */
export function canonicalUrlFor(requestHost: string | null, path: string): string | null {
  if (!requestHost) return null;
  const appUrl = new URL(getEnv().APP_URL);
  if (requestHost.toLowerCase() === appUrl.host.toLowerCase()) return null;
  return new URL(path, appUrl).toString();
}
