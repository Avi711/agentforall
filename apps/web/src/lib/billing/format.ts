import { ilsFromAgorot, type BillingInterval, type Plan } from "./pricing";

const credits = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });
const ratio = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 });
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

export function formatRatio(value: number): string {
  return `פי ${ratio.format(value)}`;
}

export function formatIls(amount: number): string {
  return `₪${ils.format(amount)}`;
}

export function formatAgorot(agorot: number): string {
  return formatIls(ilsFromAgorot(agorot));
}

export function formatDay(iso: string): string {
  return day.format(new Date(iso));
}

export function formatDate(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : dayWithYear.format(date);
}

const INTERVAL_ADJECTIVE: Record<BillingInterval, string> = { month: "חודשי", year: "שנתי" };

export function intervalAdjective(interval: BillingInterval): string {
  return INTERVAL_ADJECTIVE[interval];
}

export function planLabel(plan: Plan): string {
  return plan.interval === "year" ? `${plan.name} ${intervalAdjective("year")}` : plan.name;
}
