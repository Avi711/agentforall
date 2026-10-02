import type { CaptureResult, CapturedNetworkRequest, Properties, SessionRecordingOptions } from "posthog-js";

export const SECRET_QUERY_PARAMS = ["token", "session", "_ptxn"];

const RELATIVE_BASE = "https://relative.invalid";
const KEPT_QUERY_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "mode", "error"]);
const DASHBOARD_EVENTS = new Set(["$pageview", "$pageleave", "$identify", "$set"]);
const CHAIN_HREF = /(attr__href|href)="((?:[^"\\]|\\.)*)"/g;
// Content attributes only: an allowlist would also strip the layout and SVG attributes replay needs to draw the page.
const MASKED_ATTRIBUTES = new Set([
  "href",
  "src",
  "srcset",
  "title",
  "alt",
  "placeholder",
  "value",
  "content",
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "aria-placeholder",
  "imagesrcset",
  "poster",
  "data",
  "action",
  "formaction",
  "xlink:href",
  "ping",
  "cite",
]);
const MASK = "***";
const OWN_STATIC_ASSETS = "/_next/static/";
const POSTHOG_MASK_CLASS = "ph-mask";

export const REPLAY_READABLE_CLASS = "replay-readable";

interface ReplayElement {
  closest(selector: string): unknown;
}

// Deny by default: a new page, a streamed segment or anything outside a readable section is over-masked, never leaked.
export const REPLAY_PRIVACY: SessionRecordingOptions = {
  maskAllInputs: true,
  maskTextSelector: "*",
  maskTextFn: maskReplayText,
  blockSelector: `img:not(.${REPLAY_READABLE_CLASS} img), iframe`,
  maskAttributeFn: maskReplayAttribute,
  maskCapturedNetworkRequestFn: maskReplayRequest,
  recordHeaders: false,
  recordBody: false,
  captureCanvas: { recordCanvas: false },
};

export function maskReplayText(text: string, element?: ReplayElement): string {
  return isReadable(element) ? text : text.replace(/\S/g, "*");
}

// Build assets stay linked: a stylesheet rrweb could not inline yet would otherwise replay unstyled.
export function maskReplayAttribute(name: string, value: string, element?: ReplayElement): string {
  if (!MASKED_ATTRIBUTES.has(name) || isReadable(element) || value.startsWith(OWN_STATIC_ASSETS)) return value;
  return MASK;
}

// Other origins keep only their origin: a path such as a profile-photo URL can identify the person.
export function maskReplayRequest(request: CapturedNetworkRequest, ownOrigin = globalThis.location?.origin): CapturedNetworkRequest {
  return { ...request, name: maskReplayUrl(request.name, ownOrigin) };
}

function maskReplayUrl(url: string, ownOrigin: string | undefined): string {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return scrubUrl(url);
  }
  return origin === ownOrigin ? scrubUrl(url) : origin;
}

function isReadable(element: ReplayElement | undefined): boolean {
  return Boolean(element?.closest(`.${REPLAY_READABLE_CLASS}`)) && !element?.closest(`.${POSTHOG_MASK_CLASS}`);
}

// Deny by default: the SDK masks only listed params, and never in referrers or clicked links.
export function scrubEvent(event: CaptureResult | null): CaptureResult | null {
  // Replay data is masked by the recorder; walking it here would rewrite every image and link URL it holds.
  if (event?.event === "$snapshot") return event;
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
