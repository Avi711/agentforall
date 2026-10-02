import type { CaptureResult, Properties } from "posthog-js";

export const SECRET_QUERY_PARAMS = ["token", "session", "_ptxn"];

const RELATIVE_BASE = "https://relative.invalid";
const KEPT_QUERY_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "mode", "error"]);
const DASHBOARD_EVENTS = new Set(["$pageview", "$pageleave", "$identify", "$set"]);
const CHAIN_HREF = /(attr__href|href)="((?:[^"\\]|\\.)*)"/g;

// Deny by default: the SDK masks only listed params, and never in referrers or clicked links.
export function scrubEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event || !isAllowedOnScreen(event.event, event.properties.$pathname)) return null;
  return {
    ...event,
    properties: scrubProperties(event.properties),
    ...(event.$set ? { $set: scrubProperties(event.$set) } : {}),
    ...(event.$set_once ? { $set_once: scrubProperties(event.$set_once) } : {}),
  };
}

export function scrubUrl(value: string): string {
  const pathOnly = value.startsWith("/") && !value.startsWith("//");
  const schemeless = value.startsWith("//");
  if (!pathOnly && !schemeless && !/^https?:\/\//i.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value, RELATIVE_BASE);
  } catch {
    return value.split(/[?#]/)[0];
  }
  const dropped = [...url.searchParams.keys()].filter((key) => !KEPT_QUERY_PARAMS.has(key));
  if (dropped.length === 0) return value;
  for (const key of dropped) url.searchParams.delete(key);
  const rest = `${url.pathname}${url.search}${url.hash}`;
  if (pathOnly) return rest;
  return schemeless ? `//${url.host}${rest}` : url.toString();
}

// Admin screens list other customers; dashboard screens show the owner's phone numbers, bot names and email in clickable elements.
function isAllowedOnScreen(eventName: string, pathname: unknown): boolean {
  if (typeof pathname !== "string") return true;
  if (isUnder(pathname, "/admin")) return false;
  return !isUnder(pathname, "/app") || DASHBOARD_EVENTS.has(eventName);
}

export function isUnder(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

function scrubProperties(properties: Properties): Properties {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      key === "$elements_chain" && typeof value === "string" ? scrubElementsChain(value) : scrubValue(value),
    ]),
  );
}

function scrubElementsChain(chain: string): string {
  return chain.replace(CHAIN_HREF, (_match, name: string, href: string) => `${name}="${scrubUrl(href)}"`);
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
