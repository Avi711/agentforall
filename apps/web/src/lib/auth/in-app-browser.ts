import InAppSpy from "inapp-spy";

type AppKey = ReturnType<typeof InAppSpy>["appKey"];

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

export function googleSignInBlocked(userAgent: string): boolean {
  return GOOGLE_REFUSED_APPS.has(InAppSpy({ ua: userAgent }).appKey);
}
