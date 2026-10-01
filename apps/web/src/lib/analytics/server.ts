import "server-only";
import { after } from "next/server";
import { PostHog } from "posthog-node";
import type { TrackProductEvent } from "./events";
import { ANALYTICS_INGEST_HOST } from "./hosts";

let client: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (client !== undefined) return client;
  const token = process.env.NEXT_PUBLIC_POSTHOG_TOKEN;
  if (!token) {
    client = null;
    return client;
  }
  // The SDK default (10 s timeout, 3 retries 3 s apart) would hold a function for ~49 s through a PostHog outage.
  client = new PostHog(token, {
    host: ANALYTICS_INGEST_HOST,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: 5_000,
    fetchRetryCount: 1,
  });
  client.on("error", (err: unknown) => {
    console.error("[analytics] PostHog capture failed", err instanceof Error ? err.message : err);
  });
  return client;
}

// Sent after the response: a slow or failing PostHog never delays or fails the request that caused the event.
export const trackProductEvent: TrackProductEvent = (userId, event) => {
  const posthog = getClient();
  if (!posthog) return;
  const { name, ...properties } = event;
  after(() => posthog.captureImmediate({ distinctId: userId, event: name, properties }));
};
