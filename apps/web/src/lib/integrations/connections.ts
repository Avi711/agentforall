import type { IntegrationConnection } from "@/lib/orchestrator/types";

export type TileTone = "ok" | "wait" | "muted" | "error";
export interface TileStatus {
  label: string;
  tone: TileTone;
}

export const WATCH_INTERVAL_MS = 2000;
export const PENDING_INTERVAL_MS = 5000;

export interface PollPlan {
  target: string | null;
  intervalMs: number;
}

// Reconnecting adds an account beside older ones; the tile reflects the best of them (list is newest first).
export function connectionFor(connections: readonly IntegrationConnection[], slug: string): IntegrationConnection | null {
  const mine = connections.filter((c) => c.app === slug);
  return mine.find((c) => c.status === "active") ?? mine.find((c) => c.status === "pending") ?? mine[0] ?? null;
}

export function hasPending(connections: readonly IntegrationConnection[]): boolean {
  return connections.some((c) => c.status === "pending");
}

export function isActive(connections: readonly IntegrationConnection[], slug: string): boolean {
  return connections.some((c) => c.app === slug && c.status === "active");
}

// A watched app (just back from consent) polls fast until active; any pending account polls slowly.
export function pollPlan(connections: readonly IntegrationConnection[], watchApp: string | null): PollPlan | null {
  if (watchApp && !isActive(connections, watchApp)) return { target: watchApp, intervalMs: WATCH_INTERVAL_MS };
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
