import type { PostHog } from "posthog-js";
import { ANALYTICS_APP_HOST, ANALYTICS_ORIGIN } from "./hosts";
import { REPLAY_PRIVACY, SECRET_QUERY_PARAMS, scrubEvent } from "./privacy";

let ready: Promise<PostHog | null> | undefined;

// Loaded after hydration: the SDK is ~100 KB gzipped and Next.js runs this file before the page is interactive.
export function startAnalytics(token: string | undefined): void {
  if (!token || ready) return;
  ready = import("posthog-js").then(
    ({ default: posthog }) => {
      posthog.init(token, {
        api_host: ANALYTICS_ORIGIN,
        ui_host: ANALYTICS_APP_HOST,
        defaults: "2026-08-30",
        cross_subdomain_cookie: false,
        mask_personal_data_properties: true,
        custom_personal_data_properties: SECRET_QUERY_PARAMS,
        // Flags are unused and every /flags call sends the raw first-visit URL and referrer; surveys cannot show without them.
        advanced_disable_feature_flags: true,
        disable_surveys: true,
        session_recording: REPLAY_PRIVACY,
        enable_recording_console_log: false,
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
