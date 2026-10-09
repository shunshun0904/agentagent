/** メールアドレスからドメイン部分(小文字)を取り出す */
export function extractDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.co.jp",
  "yahoo.com",
  "outlook.com",
  "outlook.jp",
  "hotmail.com",
  "hotmail.co.jp",
  "live.jp",
  "icloud.com",
  "me.com",
  "docomo.ne.jp",
  "ezweb.ne.jp",
  "au.com",
  "softbank.ne.jp",
  "i.softbank.jp",
  "protonmail.com",
  "proton.me",
]);

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}

const NO_REPLY_PATTERNS = [
  /^no-?reply/i,
  /^do-?not-?reply/i,
  /^mailer-daemon/i,
  /^postmaster/i,
  /^bounce/i,
  /^notification/i,
  /^notifications?@/i,
];

/** 自動送信アドレスらしいか(返信しても届かない可能性が高い) */
export function looksLikeNoReply(email: string): boolean {
  const local = email.split("@")[0] ?? "";
  return NO_REPLY_PATTERNS.some((re) => re.test(local));
}

/** 配列から重複を除く(順序維持) */
export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/** 文字列を改行で分割し、空行を詰めて返す */
export function collapseBlankLines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
