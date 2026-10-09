import { randomUUID } from "node:crypto";
import type { ParsedAddress } from "@/lib/gmail/parse";

export type ReplyMimeInput = {
  from: ParsedAddress;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  subject: string;
  bodyText: string;
  inReplyTo: string | null;
  references: string | null;
  date?: Date;
};

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;

/** 非 ASCII を含むヘッダー値を RFC 2047 (UTF-8, Base64) で符号化する */
export function encodeHeaderWord(value: string): string {
  if (ASCII_PRINTABLE.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function quoteIfNeeded(name: string): string {
  // ASCII の表示名に特殊文字があれば引用符で囲む
  if (/[()<>@,;:\\".[\]]/.test(name)) {
    return `"${name.replace(/(["\\])/g, "\\$1")}"`;
  }
  return name;
}

export function formatAddress(address: ParsedAddress): string {
  if (!address.name) return address.email;
  const encoded = ASCII_PRINTABLE.test(address.name) ? quoteIfNeeded(address.name) : encodeHeaderWord(address.name);
  return `${encoded} <${address.email}>`;
}

/** 件名に Re: を付ける(既に付いていればそのまま) */
export function replySubject(original: string): string {
  const trimmed = original.trim();
  if (/^(re|返信|回答)\s*:/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`;
}

function wrapBase64(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n").replace(/\r\n$/, "");
}

export function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** References ヘッダーを組み立てる(元の References + In-Reply-To) */
export function buildReferences(references: string | null, inReplyTo: string | null): string | null {
  const ids: string[] = [];
  for (const id of (references ?? "").split(/\s+/)) {
    if (id.length > 0 && !ids.includes(id)) ids.push(id);
  }
  if (inReplyTo && !ids.includes(inReplyTo)) ids.push(inReplyTo);
  return ids.length > 0 ? ids.join(" ") : null;
}

/** Gmail API の messages.send に渡す raw(base64url)を組み立てる */
export function buildReplyRaw(input: ReplyMimeInput): { raw: string; messageId: string; mime: string } {
  const domain = input.from.email.split("@")[1] ?? "localhost";
  const messageId = `<${randomUUID()}@${domain}>`;
  const date = (input.date ?? new Date()).toUTCString();
  const references = buildReferences(input.references, input.inReplyTo);

  const headers: string[] = [
    `From: ${formatAddress(input.from)}`,
    `To: ${input.to.map(formatAddress).join(", ")}`,
  ];
  if (input.cc.length > 0) headers.push(`Cc: ${input.cc.map(formatAddress).join(", ")}`);
  headers.push(`Subject: ${encodeHeaderWord(input.subject)}`);
  headers.push(`Date: ${date}`);
  headers.push(`Message-ID: ${messageId}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: base64");

  const body = wrapBase64(Buffer.from(input.bodyText.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64"));
  const mime = `${headers.join("\r\n")}\r\n\r\n${body}\r\n`;
  return { raw: base64UrlEncode(mime), messageId, mime };
}
