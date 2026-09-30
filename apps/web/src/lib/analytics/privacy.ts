import type { CaptureResult, Properties } from "posthog-js";

export const SECRET_QUERY_PARAMS = ["token", "session", "_ptxn"];

// PostHog autocapture skips elements with this class; used on links whose href carries a phone number or bot handle.
export const NO_CAPTURE_CLASS = "ph-no-capture";

const RELATIVE_BASE = "https://relative.invalid";
const KEPT_QUERY_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "mode", "error"]);

// Deny by default: the SDK masks only listed params, and never in referrers or clicked links.
export function scrubEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event || isAdminPath(event.properties.$pathname)) return null;
  return {
    ...event,
    properties: scrubProperties(event.properties),
    ...(event.$set ? { $set: scrubProperties(event.$set) } : {}),
    ...(event.$set_once ? { $set_once: scrubProperties(event.$set_once) } : {}),
  };
}

export function scrubUrl(value: string): string {
  const relative = value.startsWith("/") && !value.startsWith("//");
  if (!relative && !/^https?:\/\//i.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value, RELATIVE_BASE);
  } catch {
    return value.split(/[?#]/)[0];
  }
  const dropped = [...url.searchParams.keys()].filter((key) => !KEPT_QUERY_PARAMS.has(key));
  if (dropped.length === 0) return value;
  for (const key of dropped) url.searchParams.delete(key);
  return relative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

// Admin screens list other customers' emails.
function isAdminPath(pathname: unknown): boolean {
  return typeof pathname === "string" && (pathname === "/admin" || pathname.startsWith("/admin/"));
}

function scrubProperties(properties: Properties): Properties {
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, scrubValue(value)]));
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubUrl(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (isPlainObject(value)) return scrubProperties(value);
  return value;
}

function isPlainObject(value: unknown): value is Properties {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}
