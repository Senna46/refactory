// Sunday-cycle helpers for refactory.
// All calendar math uses a fixed UTC+9 offset (Asia/Tokyo has no DST)
// so launchd on a misconfigured machine still treats "this week's run"
// as last Sunday 00:00 JST through next Sunday 00:00 JST.
// Limitations: A run at exactly Sunday 00:00 JST counts as the new cycle.
//   A Friday --force trial is before the coming Sunday, so Sunday still runs.

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface JstDateParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
}

export function toJstParts(date: Date): JstDateParts {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth(),
    day: jst.getUTCDate(),
    weekday: jst.getUTCDay(),
    hour: jst.getUTCHours(),
    minute: jst.getUTCMinutes(),
  };
}

export function lastSundayMidnightJst(now: Date = new Date()): Date {
  const parts = toJstParts(now);
  const midnightThisJstDayUtcMs =
    Date.UTC(parts.year, parts.month, parts.day) - JST_OFFSET_MS;
  return new Date(midnightThisJstDayUtcMs - parts.weekday * DAY_MS);
}

export function formatJstDate(now: Date = new Date()): string {
  const parts = toJstParts(now);
  const month = String(parts.month + 1).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

export function formatJstHourMinute(now: Date = new Date()): string {
  const parts = toJstParts(now);
  const hour = String(parts.hour).padStart(2, "0");
  const minute = String(parts.minute).padStart(2, "0");
  return `${hour}${minute}`;
}

export function hasCompletedThisSundayCycle(
  lastRunAtIso: string | null,
  now: Date = new Date()
): boolean {
  if (!lastRunAtIso) {
    return false;
  }
  const lastRunMs = Date.parse(lastRunAtIso);
  if (Number.isNaN(lastRunMs)) {
    return false;
  }
  return lastRunMs >= lastSundayMidnightJst(now).getTime();
}

export function isForceRun(argv: string[] = process.argv): boolean {
  if (argv.includes("--force")) {
    return true;
  }
  const envForce = process.env.REFACTORY_FORCE?.trim();
  return envForce === "1" || envForce?.toLowerCase() === "true";
}
