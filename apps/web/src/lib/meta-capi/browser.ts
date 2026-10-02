import { extractClientIp } from "../http/client-ip";
import { deriveFbcFromUrl } from "./normalize";

export interface BrowserIds {
  fbp: string | null;
  fbc: string | null;
  clientIp: string | null;
  userAgent: string | null;
  country: string | null;
}

// fb.<subdomain index>.<creation ms>.<payload>; anything else is a hand-edited cookie Meta would reject.
const META_COOKIE = /^fb\.\d\.\d{10,13}\.[\w.-]{1,500}$/;
const COUNTRY_CODE = /^[A-Za-z]{2}$/;

export function browserIdsFrom(headers: Headers, now: number = Date.now()): BrowserIds {
  const cookies = headers.get("cookie");
  const fbc = metaCookie(cookies, "_fbc") ?? deriveFbcFromUrl(headers.get("referer") ?? undefined, now);
  const country = headers.get("x-vercel-ip-country");
  return {
    fbp: metaCookie(cookies, "_fbp"),
    fbc: fbc && META_COOKIE.test(fbc) ? fbc : null,
    clientIp: extractClientIp(headers.get("x-forwarded-for")),
    userAgent: headers.get("user-agent") || null,
    country: country && COUNTRY_CODE.test(country) ? country.toLowerCase() : null,
  };
}

function metaCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const pair = part.trim();
    const eq = pair.indexOf("=");
    if (eq < 0 || pair.slice(0, eq) !== name) continue;
    const value = pair.slice(eq + 1);
    return META_COOKIE.test(value) ? value : null;
  }
  return null;
}
