import { describe, expect, it } from "vitest";
import { isConfigurationError, isTransientError, shouldRetryLater } from "@/lib/errors";

function errorWith(fields: Record<string, unknown>, message = "error"): Error {
  return Object.assign(new Error(message), fields);
}

describe("isTransientError", () => {
  it("Gmail API の利用上限エラーは一時的なエラー", () => {
    const quota = errorWith(
      { code: 429 },
      "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com'",
    );
    expect(isTransientError(quota)).toBe(true);
    expect(isTransientError(errorWith({ response: { status: 403 } }, "User Rate Limit Exceeded"))).toBe(true);
    expect(isTransientError(errorWith({ code: "429" }))).toBe(true);
  });

  it("サーバー側の失敗、通信の失敗、DB の接続エラーは一時的なエラー", () => {
    expect(isTransientError(errorWith({ status: 503 }))).toBe(true);
    expect(isTransientError(errorWith({ status: 529 }, "Overloaded"))).toBe(true);
    expect(isTransientError(errorWith({ code: "ECONNRESET" }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("Connection error."), { name: "APIConnectionError" }))).toBe(true);
    expect(isTransientError(errorWith({ code: "P1001" }))).toBe(true);
    expect(isTransientError(errorWith({ code: "08006" }))).toBe(true);
    expect(isTransientError(new Error("wrapped", { cause: errorWith({ code: "ETIMEDOUT" }) }))).toBe(true);
  });

  it("メール固有の失敗は一時的なエラーではない", () => {
    expect(isTransientError(errorWith({ code: 404 }, "Requested entity was not found."))).toBe(false);
    expect(isTransientError(errorWith({ code: "P2002" }, "Unique constraint failed"))).toBe(false);
    expect(isTransientError(errorWith({ code: "23505" }))).toBe(false);
    expect(isTransientError(new Error("bad input"))).toBe(false);
    expect(isTransientError("text")).toBe(false);
  });
});

describe("isConfigurationError", () => {
  it("認証切れ、権限不足、API キー未設定は設定のエラー", () => {
    expect(isConfigurationError(errorWith({ code: 401 }))).toBe(true);
    expect(isConfigurationError(errorWith({ response: { status: 403 } }, "Request had insufficient authentication scopes."))).toBe(true);
    expect(isConfigurationError(new Error("invalid_grant"))).toBe(true);
    expect(isConfigurationError(Object.assign(new Error("not configured"), { name: "AiError", code: "not_configured" }))).toBe(true);
  });

  it("利用上限の 403 や AI の出力の失敗は設定のエラーではない", () => {
    expect(isConfigurationError(errorWith({ response: { status: 403 } }, "Rate Limit Exceeded"))).toBe(false);
    expect(isConfigurationError(Object.assign(new Error("parse"), { name: "AiError", code: "parse_failed" }))).toBe(false);
  });
});

describe("shouldRetryLater", () => {
  it("一時的なエラーと設定のエラーは次回やり直し、それ以外は飛ばす", () => {
    expect(shouldRetryLater(errorWith({ code: 429 }))).toBe(true);
    expect(shouldRetryLater(errorWith({ code: 401 }))).toBe(true);
    expect(shouldRetryLater(errorWith({ code: 404 }))).toBe(false);
    expect(shouldRetryLater(Object.assign(new Error("refusal"), { name: "AiError", code: "refusal" }))).toBe(false);
  });
});
