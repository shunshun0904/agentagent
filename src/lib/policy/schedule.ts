/**
 * 送信時刻の計算。
 * ランダムな遅延を加えた上で、営業時間外や週末は次の営業時間の開始時刻以降にずらす。
 */

export type SchedulePolicy = {
  timezone: string;
  businessHoursStart: number;
  businessHoursEnd: number;
  replyOnWeekends: boolean;
  minDelayMinutes: number;
  maxDelayMinutes: number;
};

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=日曜
};

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** 指定タイムゾーンでの年月日時分と曜日 */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday ?? "Sun"] ?? 0,
  };
}

/** 指定タイムゾーンの壁時計時刻を UTC の Date に変換する */
export function zonedTimeToUtc(
  wall: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = getZonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += target - asUtc;
  }
  return new Date(guess);
}

function startOfDayAfter(parts: ZonedParts, timeZone: string, hour: number): Date {
  // 翌日の指定時刻。月末や年末の繰り上がりは Date.UTC に任せる
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return zonedTimeToUtc(
    {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour,
      minute: 0,
    },
    timeZone,
  );
}

function withJitter(date: Date, rng: () => number, maxMinutes = 25): Date {
  return new Date(date.getTime() + Math.floor(rng() * maxMinutes) * 60_000);
}

/** from 以降で最初の営業時間内の時刻を返す */
export function nextBusinessTime(from: Date, policy: SchedulePolicy, rng: () => number = Math.random): Date {
  const { timezone, businessHoursStart: start, businessHoursEnd: end, replyOnWeekends } = policy;
  const allDay = end <= start; // 営業時間が無効な設定なら終日送信可とみなす
  let current = from;
  for (let i = 0; i < 14; i++) {
    const parts = getZonedParts(current, timezone);
    const isWeekend = parts.weekday === 0 || parts.weekday === 6;
    if (isWeekend && !replyOnWeekends) {
      current = withJitter(startOfDayAfter(parts, timezone, allDay ? 0 : start), rng);
      continue;
    }
    if (allDay) return current;
    if (parts.hour < start) {
      return withJitter(
        zonedTimeToUtc({ year: parts.year, month: parts.month, day: parts.day, hour: start, minute: 0 }, timezone),
        rng,
      );
    }
    if (parts.hour >= end) {
      current = withJitter(startOfDayAfter(parts, timezone, start), rng);
      continue;
    }
    return current;
  }
  return current;
}

/** 返信の送信予定時刻を計算する */
export function computeSendTime(now: Date, policy: SchedulePolicy, rng: () => number = Math.random): Date {
  const min = Math.max(0, policy.minDelayMinutes);
  const max = Math.max(min, policy.maxDelayMinutes);
  const delayMinutes = min + rng() * (max - min);
  const candidate = new Date(now.getTime() + Math.round(delayMinutes * 60_000));
  return nextBusinessTime(candidate, policy, rng);
}

/** 営業時間内かどうか */
export function isWithinBusinessHours(date: Date, policy: SchedulePolicy): boolean {
  const parts = getZonedParts(date, policy.timezone);
  const isWeekend = parts.weekday === 0 || parts.weekday === 6;
  if (isWeekend && !policy.replyOnWeekends) return false;
  if (policy.businessHoursEnd <= policy.businessHoursStart) return true;
  return parts.hour >= policy.businessHoursStart && parts.hour < policy.businessHoursEnd;
}
