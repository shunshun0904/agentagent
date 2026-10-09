import { describe, expect, it } from "vitest";
import { computeSendTime, getZonedParts, isWithinBusinessHours, nextBusinessTime, zonedTimeToUtc } from "@/lib/policy/schedule";

const policy = {
  timezone: "Asia/Tokyo",
  businessHoursStart: 9,
  businessHoursEnd: 19,
  replyOnWeekends: false,
  minDelayMinutes: 20,
  maxDelayMinutes: 90,
};
const half = () => 0.5; // 遅延 55 分、ジッター 12 分

function jst(date: Date) {
  return getZonedParts(date, "Asia/Tokyo");
}

describe("zonedTimeToUtc", () => {
  it("東京の壁時計時刻を UTC に変換する", () => {
    const d = zonedTimeToUtc({ year: 2026, month: 10, day: 7, hour: 9, minute: 0 }, "Asia/Tokyo");
    expect(d.toISOString()).toBe("2026-10-07T00:00:00.000Z");
  });
});

describe("computeSendTime", () => {
  it("営業時間内なら遅延を加えるだけ", () => {
    // 2026-10-07(水) 10:00 JST
    const now = new Date("2026-10-07T01:00:00Z");
    const sendAt = computeSendTime(now, policy, half);
    const p = jst(sendAt);
    expect([p.month, p.day, p.hour, p.minute]).toEqual([10, 7, 10, 55]);
  });

  it("営業時間前は当日の開始時刻以降にずらす", () => {
    // 2026-10-08(木) 07:00 JST
    const now = new Date("2026-10-07T22:00:00Z");
    const p = jst(computeSendTime(now, policy, half));
    expect([p.day, p.hour, p.minute]).toEqual([8, 9, 12]);
  });

  it("営業時間後は翌営業日の開始時刻以降にずらす", () => {
    // 2026-10-07(水) 20:00 JST
    const now = new Date("2026-10-07T11:00:00Z");
    const p = jst(computeSendTime(now, policy, half));
    expect([p.day, p.hour, p.weekday]).toEqual([8, 9, 4]);
  });

  it("金曜の夜は月曜の朝になる", () => {
    // 2026-10-09(金) 20:30 JST
    const now = new Date("2026-10-09T11:30:00Z");
    const p = jst(computeSendTime(now, policy, half));
    expect([p.month, p.day, p.weekday, p.hour]).toEqual([10, 12, 1, 9]);
  });

  it("週末送信を許可していれば土曜でも送る", () => {
    // 2026-10-10(土) 10:00 JST
    const now = new Date("2026-10-10T01:00:00Z");
    const p = jst(computeSendTime(now, { ...policy, replyOnWeekends: true }, half));
    expect([p.day, p.weekday, p.hour]).toEqual([10, 6, 10]);
  });

  it("営業時間の設定が無効なら終日送信できる", () => {
    const now = new Date("2026-10-07T14:00:00Z"); // 23:00 JST
    const p = jst(computeSendTime(now, { ...policy, businessHoursStart: 9, businessHoursEnd: 9 }, half));
    expect([p.day, p.hour, p.minute]).toEqual([7, 23, 55]);
  });

  it("遅延は min〜max の範囲に収まる", () => {
    const now = new Date("2026-10-07T01:00:00Z");
    const earliest = computeSendTime(now, policy, () => 0);
    const latest = computeSendTime(now, policy, () => 0.999);
    expect(earliest.getTime() - now.getTime()).toBe(20 * 60_000);
    expect(latest.getTime() - now.getTime()).toBeLessThanOrEqual(90 * 60_000);
    expect(latest.getTime() - now.getTime()).toBeGreaterThan(89 * 60_000);
  });
});

describe("nextBusinessTime / isWithinBusinessHours", () => {
  it("営業時間内の時刻はそのまま返す", () => {
    const t = new Date("2026-10-07T03:00:00Z"); // 12:00 JST 水曜
    expect(nextBusinessTime(t, policy, half).getTime()).toBe(t.getTime());
    expect(isWithinBusinessHours(t, policy)).toBe(true);
  });
  it("日曜は営業時間外", () => {
    const t = new Date("2026-10-11T03:00:00Z"); // 日曜 12:00 JST
    expect(isWithinBusinessHours(t, policy)).toBe(false);
  });
});
