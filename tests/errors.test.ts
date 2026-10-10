import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { describeError, isConfigurationError, isTransientError, shouldRetryLater } from "@/lib/errors";

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
    expect(describeError(quota)).toContain("Gmail API の 1 分あたりの利用上限");
    expect(describeError(quota).startsWith("一時的な")).toBe(true);
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

describe("Anthropic API のエラー", () => {
  // SDK が API の応答から作るのと同じ方法でエラーを作る
  const apiError = (status: number, type: string, message: string) =>
    Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers());

  it("API キーが無効(401)なら、次回やり直し、設定方法を案内する", () => {
    const error = apiError(401, "authentication_error", "invalid x-api-key");
    expect(error).toBeInstanceOf(Anthropic.AuthenticationError);
    expect(isConfigurationError(error)).toBe(true);
    expect(shouldRetryLater(error)).toBe(true);
    expect(describeError(error)).toContain("Anthropic API キーが無効です");
    expect(describeError(error)).toContain("set-secret.sh ANTHROPIC_API_KEY");
  });

  it("混雑(529)や接続の失敗は一時的なエラー", () => {
    expect(isTransientError(apiError(529, "overloaded_error", "Overloaded"))).toBe(true);
    expect(isTransientError(new Anthropic.APIConnectionError({ message: "Connection error." }))).toBe(true);
    expect(describeError(apiError(529, "overloaded_error", "Overloaded"))).toContain("次回の処理でやり直します");
  });

  it("支払いの問題は案内する", () => {
    expect(describeError(apiError(402, "billing_error", "billing problem"))).toContain("支払い設定");
  });

  it("リクエストの誤り(400)はそのメールだけの失敗として扱う", () => {
    const error = apiError(400, "invalid_request_error", "bad request");
    expect(shouldRetryLater(error)).toBe(false);
  });
});

describe("describeError(Google)", () => {
  it("ログイン切れと権限不足は、やり直し方を案内する", () => {
    expect(describeError(new Error("invalid_grant"))).toContain("もう一度 Google でログイン");
    expect(describeError(errorWith({ code: 403 }, "Request had insufficient authentication scopes."))).toContain("Gmail の項目にチェック");
  });
});
