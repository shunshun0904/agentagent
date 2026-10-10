import { describe, expect, it } from "vitest";
import { createGmailCaller } from "@/lib/gmail/throttle";

function rateLimitError(): Error {
  return Object.assign(new Error("Quota exceeded for quota metric 'Queries'"), { code: 429 });
}

function recorder() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

describe("createGmailCaller", () => {
  it("呼び出しの間隔をあける", async () => {
    const { waits, sleep } = recorder();
    const call = createGmailCaller({ minIntervalMs: 100, sleep });
    for (let i = 0; i < 3; i += 1) await call(async () => i);
    expect(waits).toHaveLength(2);
    for (const w of waits) {
      expect(w).toBeGreaterThan(50);
      expect(w).toBeLessThanOrEqual(100);
    }
  });

  it("利用上限のエラーは待ってからやり直す", async () => {
    const { waits, sleep } = recorder();
    const call = createGmailCaller({ minIntervalMs: 0, sleep });
    let attempts = 0;
    const value = await call(async () => {
      attempts += 1;
      if (attempts <= 2) throw rateLimitError();
      return "ok";
    });
    expect(value).toBe("ok");
    expect(attempts).toBe(3);
    expect(waits).toEqual([2_000, 5_000]);
  });

  it("やり直しの回数を超えたらエラーにする", async () => {
    const { sleep } = recorder();
    const call = createGmailCaller({ minIntervalMs: 0, sleep });
    let attempts = 0;
    await expect(
      call(async () => {
        attempts += 1;
        throw rateLimitError();
      }),
    ).rejects.toThrow("Quota exceeded");
    expect(attempts).toBe(4);
  });

  it("一時的でないエラーはやり直さない", async () => {
    const { waits, sleep } = recorder();
    const call = createGmailCaller({ minIntervalMs: 0, sleep });
    let attempts = 0;
    await expect(
      call(async () => {
        attempts += 1;
        throw Object.assign(new Error("Requested entity was not found."), { code: 404 });
      }),
    ).rejects.toThrow("not found");
    expect(attempts).toBe(1);
    expect(waits).toEqual([]);
  });

  it("期限を過ぎてまでは待たない", async () => {
    const { waits, sleep } = recorder();
    const call = createGmailCaller({ minIntervalMs: 0, sleep, deadline: Date.now() + 1_000 });
    await expect(
      call(async () => {
        throw rateLimitError();
      }),
    ).rejects.toThrow("Quota exceeded");
    expect(waits).toEqual([]);
  });
});
