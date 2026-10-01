import "server-only";
import { z } from "zod";
import { fetchWithRetry } from "../http/fetch-with-retry";
import { ANALYTICS_APP_HOST } from "./hosts";

const PROJECT_ID = 289867;
const LOG_PREFIX = "[analytics]";
const RETRY = { attempts: 3, timeoutMs: 10_000, backoffMs: 500 };

const BulkDeleteResponseSchema = z.object({ deletion_errors: z.array(z.unknown()).optional() });

// Never throws: it runs after the response, and every miss is logged with the id for a manual delete in PostHog.
export async function eraseAnalyticsPerson(
  userId: string,
  apiKey = process.env.POSTHOG_PERSONAL_API_KEY,
  send: typeof fetch = fetch,
): Promise<void> {
  if (!apiKey) {
    console.error(LOG_PREFIX, "POSTHOG_PERSONAL_API_KEY is not set; delete this person in PostHog by hand", { userId });
    return;
  }
  try {
    const res = await fetchWithRetry(
      `${ANALYTICS_APP_HOST}/api/projects/${PROJECT_ID}/persons/bulk_delete/`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ distinct_ids: [userId], delete_events: true, delete_recordings: true }),
      },
      { ...RETRY, fetch: send },
    );
    if (!res.ok) {
      await res.body?.cancel();
      console.error(LOG_PREFIX, "PostHog refused the erasure; delete this person by hand", { userId, status: res.status });
      return;
    }
    const body = BulkDeleteResponseSchema.safeParse(await res.json());
    if (!body.success || (body.data.deletion_errors?.length ?? 0) > 0) {
      console.error(LOG_PREFIX, "PostHog did not confirm the erasure; delete this person by hand", { userId });
    }
  } catch (err) {
    console.error(LOG_PREFIX, "erasure failed; delete this person in PostHog by hand", {
      userId,
      message: err instanceof Error ? err.message : "unknown",
    });
  }
}
