import { describe, expect, it } from "vitest";
import { buildReferences, buildReplyRaw, encodeHeaderWord, formatAddress, replySubject } from "@/lib/gmail/mime";

function decodeRaw(raw: string): string {
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

describe("replySubject", () => {
  it("Re: を付ける", () => {
    expect(replySubject("案件のご紹介")).toBe("Re: 案件のご紹介");
  });
  it("既に Re: があればそのまま", () => {
    expect(replySubject("Re: 案件のご紹介")).toBe("Re: 案件のご紹介");
    expect(replySubject("RE: hello")).toBe("RE: hello");
  });
});

describe("encodeHeaderWord / formatAddress", () => {
  it("ASCII はそのまま", () => {
    expect(encodeHeaderWord("Hello")).toBe("Hello");
  });
  it("日本語は RFC 2047 で符号化し、復号できる", () => {
    const encoded = encodeHeaderWord("山田 太郎");
    const match = /^=\?UTF-8\?B\?(.+)\?=$/.exec(encoded);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1]!, "base64").toString("utf8")).toBe("山田 太郎");
  });
  it("表示名付きアドレスを整形する", () => {
    expect(formatAddress({ name: null, email: "a@example.com" })).toBe("a@example.com");
    expect(formatAddress({ name: "Taro", email: "a@example.com" })).toBe("Taro <a@example.com>");
    expect(formatAddress({ name: "山田", email: "a@example.com" })).toMatch(/^=\?UTF-8\?B\?.+\?= <a@example.com>$/);
  });
});

describe("buildReferences", () => {
  it("References と In-Reply-To を重複なく結合する", () => {
    expect(buildReferences("<a@x> <b@x>", "<b@x>")).toBe("<a@x> <b@x>");
    expect(buildReferences(null, "<c@x>")).toBe("<c@x>");
    expect(buildReferences("<a@x>", "<c@x>")).toBe("<a@x> <c@x>");
    expect(buildReferences(null, null)).toBeNull();
  });
});

describe("buildReplyRaw", () => {
  it("スレッド返信に必要なヘッダーと本文を含む", () => {
    const { raw, messageId } = buildReplyRaw({
      from: { name: "山田 太郎", email: "me@example.com" },
      to: [{ name: "佐藤", email: "sato@agent.example.jp" }],
      cc: [{ name: null, email: "cc@agent.example.jp" }],
      subject: "Re: 案件のご紹介",
      bodyText: "お世話になっております。\n山田です。",
      inReplyTo: "<orig@agent.example.jp>",
      references: "<first@agent.example.jp>",
      date: new Date("2026-10-09T01:00:00Z"),
    });
    const mime = decodeRaw(raw);
    expect(mime).toContain("In-Reply-To: <orig@agent.example.jp>");
    expect(mime).toContain("References: <first@agent.example.jp> <orig@agent.example.jp>");
    expect(mime).toContain("Cc: cc@agent.example.jp");
    expect(mime).toContain(`Message-ID: ${messageId}`);
    expect(messageId).toMatch(/^<.+@example\.com>$/);
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain("Content-Transfer-Encoding: base64");
    const body = mime.split("\r\n\r\n")[1]!.replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("お世話になっております。\r\n山田です。");
    const subjectLine = mime.split("\r\n").find((l) => l.startsWith("Subject: "))!;
    const encoded = /=\?UTF-8\?B\?(.+)\?=/.exec(subjectLine)![1]!;
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe("Re: 案件のご紹介");
  });
});
