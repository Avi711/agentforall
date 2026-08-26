import type { BillingInterval } from "./pricing";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

// Calendar-aware in UTC: Jan 31 + 1 month = Feb 28/29, never an overflow into March.
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + months;
  const lastDayOfTarget = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDayOfTarget);
  return new Date(
    Date.UTC(
      year,
      monthIndex,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

export function addInterval(date: Date, interval: BillingInterval): Date {
  switch (interval) {
    case "month":
      return addMonths(date, 1);
  }
}

export function laterOf(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}
