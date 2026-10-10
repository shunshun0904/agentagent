/**
 * 取り込まない送信者の設定(返信ポリシーの「除外する送信者」)。
 * メールアドレス(user@example.com)か、ドメイン(example.com または @example.com)を指定する。
 * ドメインを指定すると、そのサブドメインも除外する。
 */

/** 設定画面の入力(改行・カンマ区切り)を正規化した一覧にする */
export function parseExcludedSenders(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,、]/)) {
    const entry = raw.trim().toLowerCase().replace(/^@/, "");
    if (entry && entry.includes(".")) seen.add(entry);
  }
  return Array.from(seen);
}

/** 送信者が除外の対象か */
export function isExcludedSender(email: string, excludedSenders: readonly string[]): boolean {
  const address = email.trim().toLowerCase();
  const domain = address.split("@")[1] ?? "";
  if (!address) return false;
  return excludedSenders.some((entry) => {
    const e = entry.trim().toLowerCase().replace(/^@/, "");
    if (!e) return false;
    if (e.includes("@")) return e === address;
    return domain === e || domain.endsWith(`.${e}`);
  });
}
