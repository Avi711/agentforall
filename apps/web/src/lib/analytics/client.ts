import type { PostHog } from "posthog-js";
import { ANALYTICS_ORIGIN, ANALYTICS_UI_HOST } from "./hosts";
import { SECRET_QUERY_PARAMS, scrubEvent } from "./privacy";

let ready: Promise<PostHog | null> | undefined;

// Loaded after hydration: the SDK is ~100 KB gzipped and Next.js runs this file before the page is interactive.
export function startAnalytics(token: string | undefined): void {
  if (!token || ready) return;
  ready = import("posthog-js").then(
    ({ default: posthog }) => {
      posthog.init(token, {
        api_host: ANALYTICS_ORIGIN,
        ui_host: ANALYTICS_UI_HOST,
        defaults: "2026-08-30",
        cross_subdomain_cookie: false,
        mask_personal_data_properties: true,
        custom_personal_data_properties: SECRET_QUERY_PARAMS,
        advanced_disable_feature_flags: true,
        // What is collected is decided here; toggles in PostHog's settings cannot widen it.
        disable_session_recording: true,
        disable_surveys: true,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        autocapture: { capture_copied_text: false },
        before_send: scrubEvent,
      });
      return posthog;
    },
    (err: unknown) => {
      console.warn("[analytics] SDK failed to load", err instanceof Error ? err.message : err);
      return null;
    },
  );
}

export function identifyUser(userId: string): void {
  void ready?.then((posthog) => {
    if (!posthog) return;
    const previous: unknown = posthog.get_property("$user_id");
    if (previous && previous !== userId) posthog.reset();
    posthog.identify(userId);
  });
}

export function forgetUser(): void {
  void ready?.then((posthog) => posthog?.reset());
}
