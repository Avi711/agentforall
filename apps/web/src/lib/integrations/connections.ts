import type { IntegrationConnection } from "@/lib/orchestrator/types";
import { INTEGRATION_MAX_ACCOUNTS_PER_APP, accountLabelKey } from "./schemas";

export type TileTone = "ok" | "wait" | "muted" | "error";
export interface TileStatus {
  label: string;
  tone: TileTone;
}

export const WATCH_INTERVAL_MS = 2000;
export const PENDING_INTERVAL_MS = 5000;
export const UNNAMED_ACCOUNT_HE = "חשבון ללא שם";

export interface PollPlan {
  target: string | null;
  intervalMs: number;
}

// The next connect sweeps these, so they neither count toward the cap nor need the owner's attention.
const SWEPT_STATUSES = new Set<IntegrationConnection["status"]>(["expired", "failed"]);

// Every account the orchestrator counts toward the cap is shown; an unnamed dead attempt only stands in for an empty app.
export function accountsFor(connections: readonly IntegrationConnection[], slug: string): IntegrationConnection[] {
  const mine = connections.filter((c) => c.app === slug);
  const kept = mine.filter((c) => c.label !== null || !SWEPT_STATUSES.has(c.status));
  if (kept.length > 0) return kept;
  return mine[0] ? [mine[0]] : [];
}

export function canAddAccount(accounts: readonly IntegrationConnection[]): boolean {
  return accounts.some((c) => c.status === "active") && accounts.length < INTEGRATION_MAX_ACCOUNTS_PER_APP;
}

// A new account may reuse the name of a dead or unfinished one: connecting under it replaces that attempt.
export function labelsTakenForNew(accounts: readonly IntegrationConnection[]): Set<string> {
  return labelKeys(accounts.filter((c) => c.status === "active"));
}

export function labelsTakenForRename(accounts: readonly IntegrationConnection[], ref: string): Set<string> {
  return labelKeys(accounts.filter((c) => c.ref !== ref));
}

function labelKeys(accounts: readonly IntegrationConnection[]): Set<string> {
  return new Set(accounts.flatMap((c) => (c.label === null ? [] : [accountLabelKey(c.label)])));
}

export function accountName(appName: string, account: Pick<IntegrationConnection, "label"> | null | undefined): string {
  return account?.label ? `${appName} · ${isolate(account.label)}` : appName;
}

// First-strong isolate: an English name inside a Hebrew sentence (or the reverse) keeps its own direction.
export function isolate(text: string): string {
  return `\u2068${text}\u2069`;
}

// Fixed to Israel time so the server render and the browser agree.
const CONNECTED_AT_HE = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jerusalem",
});

// Tells unnamed accounts apart, which otherwise read the same.
export function connectedAtHe(account: Pick<IntegrationConnection, "createdAt">): string | null {
  if (!account.createdAt) return null;
  const at = new Date(account.createdAt);
  return Number.isNaN(at.getTime()) ? null : `חובר ב־${CONNECTED_AT_HE.format(at)}`;
}

export function hasPending(connections: readonly IntegrationConnection[]): boolean {
  return connections.some((c) => c.status === "pending");
}

// The list is newest first, so this is the account the owner just went to connect.
export function latestFor(connections: readonly IntegrationConnection[], slug: string): IntegrationConnection | null {
  return connections.find((c) => c.app === slug) ?? null;
}

// A watched app (just back from consent) polls fast until its newest account is active; any pending account polls slowly.
export function pollPlan(connections: readonly IntegrationConnection[], watchApp: string | null): PollPlan | null {
  if (watchApp && latestFor(connections, watchApp)?.status !== "active") {
    return { target: watchApp, intervalMs: WATCH_INTERVAL_MS };
  }
  if (hasPending(connections)) return { target: null, intervalMs: PENDING_INTERVAL_MS };
  return null;
}

export function tileStatus(connection: IntegrationConnection | null): TileStatus | null {
  if (!connection) return null;
  switch (connection.status) {
    case "active":
      return { label: "מחובר", tone: "ok" };
    case "pending":
      return { label: "ממתין לאישור", tone: "wait" };
    // Providers expire abandoned consent flows too, so this is not necessarily a broken connection.
    case "expired":
      return { label: "פג תוקף", tone: "muted" };
    default:
      return { label: "נדרש חיבור מחדש", tone: "error" };
  }
}
