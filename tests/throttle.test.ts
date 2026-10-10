import { describe, expect, it } from "vitest";
import { GMAIL_UNITS, createGmailCaller, gmailUnitsBudget } from "@/lib/gmail/throttle";

function rateLimitError(): Error {
  return Object.assign(new Error("Quota exceeded for quota metric 'Total Query Cost'"), { code: 429 });
}

/** 待機すると時刻が進む偽の時計 */
function fakeClock(start = 1_000_000) {
  let t = start;
  const waits: number[] = [];
  return {
    waits,
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("gmailUnitsBudget", () => {
  it("上限の 75% を使う", () => {
    expect(gmailUnitsBudget(6000)).toBe(4500);
    expect(gmailUnitsBudget(15000)).toBe(11250);
  });
});

describe("createGmailCaller", () => {
  it("呼び出しの間隔をあける", async () => {
    const clock = fakeClock();
    const call = createGmailCaller({ minIntervalMs: 100, sleep: clock.sleep, now: clock.now });
    for (let i = 0; i < 3; i += 1) await call(async () => i);
    expect(clock.waits).toEqual([100, 100]);
  });

  it("1 分あたりの単位が上限に達したら、枠が空くまで待つ", async () => {
    const clock = fakeClock();
    // 上限 100 単位: get(20 単位)は 5 回まで。6 回目は最初の呼び出しから 1 分たつまで待つ
    const call = createGmailCaller({ unitsPerMinute: 100, minIntervalMs: 0, sleep: clock.sleep, now: clock.now });
    for (let i = 0; i < 5; i += 1) {
      await call(async () => i, GMAIL_UNITS.get);
      clock.advance(1_000);
    }
    expect(clock.waits).toEqual([]);
    await call(async () => "ok", GMAIL_UNITS.get);
    expect(clock.waits).toEqual([55_000]); // 最初の呼び出し(5 秒前)から 60 秒後
    // 枠が空いた分だけ続けて呼べる(2 回目の呼び出しは 1 秒後に空く)
    await call(async () => "ok", GMAIL_UNITS.get);
    expect(clock.waits).toEqual([55_000, 1_000]);
  });

  it("単位の少ない一覧取得は、同じ上限でも多く呼べる", async () => {
    const clock = fakeClock();
    const call = createGmailCaller({ unitsPerMinute: 100, minIntervalMs: 0, sleep: clock.sleep, now: clock.now });
    for (let i = 0; i < 20; i += 1) await call(async () => i, GMAIL_UNITS.list);
    expect(clock.waits).toEqual([]);
  });

  it("枠が空くまで待つと期限を過ぎる場合は、待たずにエラーにする", async () => {
    const clock = fakeClock();
    const call = createGmailCaller({ unitsPerMinute: 20, minIntervalMs: 0, sleep: clock.sleep, now: clock.now, deadline: clock.now() + 10_000 });
    await call(async () => "first", GMAIL_UNITS.get);
    await expect(call(async () => "second", GMAIL_UNITS.get)).rejects.toMatchObject({ code: 429 });
    expect(clock.waits).toEqual([]);
  });

  it("利用上限のエラーは待ってからやり直す", async () => {
    const clock = fakeClock();
    const call = createGmailCaller({ minIntervalMs: 0, sleep: clock.sleep, now: clock.now });
    let attempts = 0;
    const value = await call(async () => {
      attempts += 1;
      if (attempts <= 2) throw rateLimitError();
      return "ok";
    });
    expect(value).toBe("ok");
    expect(attempts).toBe(3);
    expect(clock.waits).toEqual([5_000, 15_000]);
  });

  it("やり直しの回数を超えたらエラーにする", async () => {
    const clock = fakeClock();
    const call = createGmailCaller({ minIntervalMs: 0, sleep: clock.sleep, now: clock.now });
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
    const clock = fakeClock();
    const call = createGmailCaller({ minIntervalMs: 0, sleep: clock.sleep, now: clock.now });
    let attempts = 0;
    await expect(
      call(async () => {
        attempts += 1;
        throw Object.assign(new Error("Requested entity was not found."), { code: 404 });
      }),
    ).rejects.toThrow("not found");
    expect(attempts).toBe(1);
    expect(clock.waits).toEqual([]);
  });

  it("やり直しの待ち時間が期限を過ぎる場合は待たない", async () => {
    const clock = fakeClock();
    const call = createGmailCaller({ minIntervalMs: 0, sleep: clock.sleep, now: clock.now, deadline: clock.now() + 1_000 });
    await expect(
      call(async () => {
        throw rateLimitError();
      }),
    ).rejects.toThrow("Quota exceeded");
    expect(clock.waits).toEqual([]);
  });
});
