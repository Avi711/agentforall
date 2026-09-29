import InAppSpy from "inapp-spy";

type AppKey = ReturnType<typeof InAppSpy>["appKey"];

export interface BrowserHandoff {
  href: string | null;
}

// Only apps with documented Google refusals: a wrong entry would take away a sign-in that works today.
const GOOGLE_REFUSED_APPS: ReadonlySet<AppKey> = new Set<AppKey>([
  "instagram",
  "facebook",
  "messenger",
  "tiktok",
  "linkedin",
  "line",
  "wechat",
]);

export function browserHandoff(userAgent: string, url: string): BrowserHandoff | null {
  const { appKey } = InAppSpy({ ua: userAgent });
  if (!GOOGLE_REFUSED_APPS.has(appKey)) return null;
  return { href: handoffHref(appKey, userAgent, url) };
}

// Neither link is documented for these apps, so the menu steps stay on screen as the path that always works.
function handoffHref(appKey: AppKey, userAgent: string, url: string): string | null {
  if (/Android/i.test(userAgent)) {
    const { protocol, host, pathname, search } = new URL(url);
    return `intent://${host}${pathname}${search}#Intent;scheme=${protocol.slice(0, -1)};action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(url)};end`;
  }
  if (appKey === "instagram") return `instagram://extbrowser/?url=${encodeURIComponent(url)}`;
  return null;
}
