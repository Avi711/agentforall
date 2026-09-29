import "server-only";
import InAppSpy from "inapp-spy";

type AppKey = ReturnType<typeof InAppSpy>["appKey"];

export type HandoffTarget = "default-browser" | "chrome";

export interface BrowserHandoff {
  opens: HandoffTarget;
  href: string;
}

const SOCIAL_APPS: ReadonlySet<AppKey> = new Set<AppKey>([
  "instagram",
  "facebook",
  "messenger",
  "threads",
  "tiktok",
  "linkedin",
  "line",
  "wechat",
]);

export function browserHandoff(userAgent: string, url: string): BrowserHandoff | null {
  const { appKey } = InAppSpy({ ua: userAgent });
  if (!SOCIAL_APPS.has(appKey)) return null;
  if (/Android/i.test(userAgent)) return { opens: "chrome", href: chromeIntent(url) };
  if (appKey === "instagram") return { opens: "default-browser", href: `instagram://extbrowser/?url=${encodeURIComponent(url)}` };
  return null;
}

// Chrome by name: it holds the phone's Google account, and the button says which app will open.
function chromeIntent(url: string): string {
  const { protocol, host, pathname, search } = new URL(url);
  return `intent://${host}${pathname}${search}#Intent;scheme=${protocol.slice(0, -1)};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}
