import type { gmail_v1 } from "googleapis";
import { collapseBlankLines } from "@/lib/text";

export type ParsedAddress = { name: string | null; email: string };

export type ParsedGmailMessage = {
  gmailMessageId: string;
  gmailThreadId: string;
  labelIds: string[];
  from: ParsedAddress;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  subject: string;
  sentAt: Date;
  rfcMessageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  isAutoSubmitted: boolean;
  isBulk: boolean;
  /** 引用部分を除いた本文 */
  bodyText: string;
  /** 引用部分を含む本文 */
  rawBodyText: string;
  snippet: string;
};

const ADDRESS_RE = /(?:"([^"]*)"|([^<,"]*?))\s*<([^>]+)>|([^\s,<>"]+@[^\s,<>"]+)/g;

/** "山田 太郎 <taro@example.com>" のような文字列を解析する */
export function parseAddress(raw: string | null | undefined): ParsedAddress | null {
  const list = parseAddressList(raw);
  return list[0] ?? null;
}

export function parseAddressList(raw: string | null | undefined): ParsedAddress[] {
  if (!raw) return [];
  const results: ParsedAddress[] = [];
  for (const match of raw.matchAll(ADDRESS_RE)) {
    const quotedName = match[1];
    const bareName = match[2];
    const bracketEmail = match[3];
    const plainEmail = match[4];
    if (bracketEmail) {
      const name = (quotedName ?? bareName ?? "").trim();
      results.push({ name: name.length > 0 ? name : null, email: bracketEmail.trim().toLowerCase() });
    } else if (plainEmail) {
      results.push({ name: null, email: plainEmail.trim().toLowerCase() });
    }
  }
  return results;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

/** 簡易的な HTML → テキスト変換 */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "・")
    .replace(/<[^>]+>/g, "");
  text = text.replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m);
  text = text.replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)));
  text = text.replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)));
  return collapseBlankLines(text.replace(/[ \t]+\n/g, "\n"));
}

type BodyCandidates = { plain: string | null; html: string | null };

function collectBodies(part: gmail_v1.Schema$MessagePart | undefined, acc: BodyCandidates): void {
  if (!part) return;
  const mime = (part.mimeType ?? "").toLowerCase();
  const data = part.body?.data;
  if (data && mime === "text/plain" && acc.plain === null) {
    acc.plain = decodeBase64Url(data);
  } else if (data && mime === "text/html" && acc.html === null) {
    acc.html = decodeBase64Url(data);
  }
  for (const child of part.parts ?? []) {
    collectBodies(child, acc);
  }
}

const QUOTE_MARKERS: RegExp[] = [
  /^>/,
  /^On .+ wrote:\s*$/,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^-{5,}\s*$/,
  /^_{5,}\s*$/,
  /^\d{4}年\d{1,2}月\d{1,2}日\(.\)\s*\d{1,2}:\d{2}.*<[^>]+>:?\s*$/,
  /^\d{4}年\d{1,2}月\d{1,2}日.*(?:wrote|さんは書きました|様のメッセージ):?\s*$/,
  /^\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}.*:\s*$/,
  /^From:\s.+$/,
  /^差出人:\s.+$/,
  /^送信元:\s.+$/,
];

/** 返信時に引用された過去メールを取り除く */
export function stripQuotedText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cut = lines.length;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (QUOTE_MARKERS.some((re) => re.test(line))) {
      cut = i;
      break;
    }
  }
  const kept = lines.slice(0, cut).filter((line) => !line.startsWith(">"));
  const result = collapseBlankLines(kept.join("\n"));
  // 全て引用だった場合は元の本文を返す
  return result.length > 0 ? result : collapseBlankLines(text);
}

function headerMap(headers: gmail_v1.Schema$MessagePartHeader[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers ?? []) {
    if (h.name && h.value && !map.has(h.name.toLowerCase())) {
      map.set(h.name.toLowerCase(), h.value);
    }
  }
  return map;
}

const AUTO_REPLY_SUBJECT = /自動応答|自動返信|不在|out of office|auto(?:matic)?[\s-]*reply|away from/i;

/** Gmail API のメッセージ(format=full)をアプリ用の構造に変換する */
export function parseGmailMessage(msg: gmail_v1.Schema$Message): ParsedGmailMessage {
  if (!msg.id || !msg.threadId) {
    throw new Error("Gmail メッセージに id または threadId がありません");
  }
  const headers = headerMap(msg.payload?.headers);
  const from = parseAddress(headers.get("from")) ?? { name: null, email: "unknown@invalid" };
  const subject = headers.get("subject") ?? "(件名なし)";

  const bodies: BodyCandidates = { plain: null, html: null };
  collectBodies(msg.payload, bodies);
  let rawBody = bodies.plain ?? (bodies.html ? htmlToText(bodies.html) : "");
  if (rawBody.trim().length === 0 && msg.snippet) rawBody = msg.snippet;
  rawBody = collapseBlankLines(rawBody);

  const internalDate = msg.internalDate ? Number(msg.internalDate) : NaN;
  const dateHeader = headers.get("date");
  const sentAt = Number.isFinite(internalDate)
    ? new Date(internalDate)
    : dateHeader && !Number.isNaN(Date.parse(dateHeader))
      ? new Date(dateHeader)
      : new Date();

  const autoSubmitted = (headers.get("auto-submitted") ?? "no").toLowerCase();
  const precedence = (headers.get("precedence") ?? "").toLowerCase();
  const isAutoSubmitted =
    (autoSubmitted !== "" && autoSubmitted !== "no") ||
    headers.has("x-autoreply") ||
    headers.has("x-autorespond") ||
    AUTO_REPLY_SUBJECT.test(subject);
  const isBulk = headers.has("list-unsubscribe") || headers.has("list-id") || ["bulk", "list", "junk"].includes(precedence);

  return {
    gmailMessageId: msg.id,
    gmailThreadId: msg.threadId,
    labelIds: msg.labelIds ?? [],
    from,
    to: parseAddressList(headers.get("to")),
    cc: parseAddressList(headers.get("cc")),
    subject,
    sentAt,
    rfcMessageId: headers.get("message-id") ?? null,
    inReplyTo: headers.get("in-reply-to") ?? null,
    references: headers.get("references") ?? null,
    isAutoSubmitted,
    isBulk,
    bodyText: stripQuotedText(rawBody),
    rawBodyText: rawBody,
    snippet: msg.snippet ?? rawBody.slice(0, 120),
  };
}
