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
        // Flags are unused and every /flags call sends the raw first-visit URL and referrer; surveys cannot show without them.
        advanced_disable_feature_flags: true,
        disable_surveys: true,
        // Stays off until pairing codes, phone numbers and emails on the dashboard are masked.
        disable_session_recording: true,
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
