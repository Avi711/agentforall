import { startAnalytics } from "./lib/analytics/client";

startAnalytics(process.env.NEXT_PUBLIC_POSTHOG_TOKEN);
