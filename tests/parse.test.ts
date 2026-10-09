import { describe, expect, it } from "vitest";
import { htmlToText, parseAddressList, parseGmailMessage, stripQuotedText } from "@/lib/gmail/parse";

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("parseAddressList", () => {
  it("表示名付き・なしを混在して解析する", () => {
    const list = parseAddressList('"山田 太郎" <Taro@Example.com>, suzuki@example.jp, 佐藤 <sato@agent.example.jp>');
    expect(list).toEqual([
      { name: "山田 太郎", email: "taro@example.com" },
      { name: null, email: "suzuki@example.jp" },
      { name: "佐藤", email: "sato@agent.example.jp" },
    ]);
  });
  it("空なら空配列", () => {
    expect(parseAddressList(undefined)).toEqual([]);
  });
});

describe("stripQuotedText", () => {
  it("Gmail の日本語引用ヘッダー以降を取り除く", () => {
    const text = "ご連絡ありがとうございます。\n承知しました。\n\n2026年10月9日(金) 10:00 山田太郎 <taro@example.com>:\n> お世話になっております。\n> 山田です。";
    expect(stripQuotedText(text)).toBe("ご連絡ありがとうございます。\n承知しました。");
  });
  it("Outlook 形式の From: 以降を取り除く", () => {
    const text = "了解です。\n\nFrom: 山田 太郎 <taro@example.com>\nSent: Friday\nTo: 佐藤\n本文";
    expect(stripQuotedText(text)).toBe("了解です。");
  });
  it("引用しか無い場合は元の本文を返す", () => {
    const text = "> 引用のみ\n> です";
    expect(stripQuotedText(text)).toBe("> 引用のみ\n> です");
  });
});

describe("htmlToText", () => {
  it("タグを除去して改行を保つ", () => {
    const text = htmlToText("<html><style>p{}</style><body><p>こんにちは<br>世界</p><div>&amp; テスト</div></body></html>");
    expect(text).toBe("こんにちは\n世界\n& テスト");
  });
});

describe("parseGmailMessage", () => {
  it("マルチパートのメールを解析する", () => {
    const parsed = parseGmailMessage({
      id: "m1",
      threadId: "t1",
      labelIds: ["INBOX", "UNREAD"],
      snippet: "お世話になっております",
      internalDate: "1791000000000",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: "佐藤 美咲 <sato@agent.example.jp>" },
          { name: "To", value: "me@example.com" },
          { name: "Cc", value: "assist@agent.example.jp" },
          { name: "Subject", value: "【案件のご紹介】Go 案件" },
          { name: "Message-ID", value: "<abc@agent.example.jp>" },
          { name: "In-Reply-To", value: "<prev@example.com>" },
          { name: "References", value: "<prev@example.com>" },
          { name: "List-Unsubscribe", value: "<mailto:unsub@agent.example.jp>" },
          { name: "Auto-Submitted", value: "auto-replied" },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: b64url("お世話になっております。\n\n> 引用") } },
          { mimeType: "text/html", body: { data: b64url("<p>html</p>") } },
        ],
      },
    });
    expect(parsed.gmailMessageId).toBe("m1");
    expect(parsed.gmailThreadId).toBe("t1");
    expect(parsed.from).toEqual({ name: "佐藤 美咲", email: "sato@agent.example.jp" });
    expect(parsed.to.map((a) => a.email)).toEqual(["me@example.com"]);
    expect(parsed.cc.map((a) => a.email)).toEqual(["assist@agent.example.jp"]);
    expect(parsed.subject).toBe("【案件のご紹介】Go 案件");
    expect(parsed.rfcMessageId).toBe("<abc@agent.example.jp>");
    expect(parsed.inReplyTo).toBe("<prev@example.com>");
    expect(parsed.bodyText).toBe("お世話になっております。");
    expect(parsed.rawBodyText).toContain("> 引用");
    expect(parsed.sentAt.getTime()).toBe(1791000000000);
    expect(parsed.isBulk).toBe(true);
    expect(parsed.isAutoSubmitted).toBe(true);
  });

  it("HTML のみのメールはテキストに変換する", () => {
    const parsed = parseGmailMessage({
      id: "m2",
      threadId: "t2",
      payload: {
        mimeType: "text/html",
        headers: [{ name: "From", value: "a@example.com" }, { name: "Subject", value: "Hi" }, { name: "Date", value: "Fri, 09 Oct 2026 10:00:00 +0900" }],
        body: { data: b64url("<div>第一行</div><div>第二行</div>") },
      },
    });
    expect(parsed.bodyText).toBe("第一行\n第二行");
    expect(parsed.isBulk).toBe(false);
    expect(parsed.isAutoSubmitted).toBe(false);
    expect(parsed.sentAt.toISOString()).toBe("2026-10-09T01:00:00.000Z");
  });
});
