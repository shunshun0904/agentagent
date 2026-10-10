import { describe, expect, it } from "vitest";
import { isExcludedSender, parseExcludedSenders } from "@/lib/policy/exclusions";

describe("parseExcludedSenders", () => {
  it("改行・カンマ区切りの入力を正規化し、重複と空行を除く", () => {
    const text = " Levtech-Direct@levtech.jp \n@scout.example.com\nexample.org, example.org\n\nnot-an-entry\n";
    expect(parseExcludedSenders(text)).toEqual(["levtech-direct@levtech.jp", "scout.example.com", "example.org"]);
  });
});

describe("isExcludedSender", () => {
  const list = ["levtech-direct@levtech.jp", "scout.example.com"];

  it("メールアドレスは完全一致で除外する", () => {
    expect(isExcludedSender("levtech-direct@levtech.jp", list)).toBe(true);
    expect(isExcludedSender("LEVTECH-DIRECT@levtech.jp", list)).toBe(true);
    expect(isExcludedSender("support_work@levtech.jp", list)).toBe(false);
  });

  it("ドメインはサブドメインを含めて除外する", () => {
    expect(isExcludedSender("info@scout.example.com", list)).toBe(true);
    expect(isExcludedSender("info@mail.scout.example.com", list)).toBe(true);
    expect(isExcludedSender("info@example.com", list)).toBe(false);
    expect(isExcludedSender("info@notscout.example.com", list)).toBe(false);
  });

  it("空の設定では何も除外しない", () => {
    expect(isExcludedSender("a@b.jp", [])).toBe(false);
  });
});
