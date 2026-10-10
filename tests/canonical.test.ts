import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgresql://u:p@localhost:5432/db";
  process.env.APP_ENCRYPTION_KEY ??= "unit-test-encryption-key";
  process.env.APP_URL = "https://agentagent-123456789.asia-northeast1.run.app";
});

describe("canonicalUrlFor", () => {
  it("APP_URL と同じホストなら null", async () => {
    const { canonicalUrlFor } = await import("@/lib/canonical");
    expect(canonicalUrlFor("agentagent-123456789.asia-northeast1.run.app", "/login")).toBeNull();
    expect(canonicalUrlFor(null, "/login")).toBeNull();
  });
  it("別のホストなら APP_URL 側の URL を返す", async () => {
    const { canonicalUrlFor } = await import("@/lib/canonical");
    expect(canonicalUrlFor("agentagent-abcdef-an.a.run.app", "/api/auth/google")).toBe(
      "https://agentagent-123456789.asia-northeast1.run.app/api/auth/google",
    );
  });
});
