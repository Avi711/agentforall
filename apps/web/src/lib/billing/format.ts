import { ilsFromAgorot } from "./pricing";

const credits = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });
const ils = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });
// Fixed time zone so the server render and the client hydration agree.
const day = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
const dayWithYear = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Jerusalem",
});

export function formatCredits(value: number): string {
  return credits.format(value);
}

export function formatIls(amount: number): string {
  return `₪${ils.format(amount)}`;
}

export function formatAgorot(agorot: number): string {
  return formatIls(ilsFromAgorot(agorot));
}

// Views carry ISO strings (they cross the JSON boundary); formatting happens at render time only.
export function formatDay(iso: string): string {
  return day.format(new Date(iso));
}

export function formatDate(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : dayWithYear.format(date);
}
