export const TENANT_TIMEZONE = "Asia/Jerusalem";

export interface TenantClock {
  date: string;
  hour: number;
}

const tenantFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TENANT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function tenantClockOf(at: Date): TenantClock {
  const parts = tenantParts(at);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

// Exact whenever the hour exists once on that date; Israel's clock changes skip or repeat only the small hours.
export function atTenantHour(date: string, hour: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  const wallClock = Date.UTC(year!, month! - 1, day!, hour);
  const firstGuess = wallClock - offsetAt(wallClock);
  return new Date(wallClock - offsetAt(firstGuess));
}

function offsetAt(instant: number): number {
  const parts = tenantParts(new Date(instant));
  const wallClock = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return wallClock - Math.floor(instant / 1000) * 1000;
}

function tenantParts(at: Date): Record<string, string> {
  return Object.fromEntries(tenantFormat.formatToParts(at).map((part) => [part.type, part.value]));
}
