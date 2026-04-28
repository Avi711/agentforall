import { createHash } from "node:crypto";

// https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function normalizeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

// Meta's fbevents.js accepts unicode letters for fn/ln, so Hebrew names keep
// their characters. Caller is responsible for omitting empty results.
export function normalizeName(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return normalized || null;
}

export interface NameParts {
  fn: string | null;
  ln: string | null;
}

export function splitName(full: string): NameParts {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { fn: null, ln: null };
  const [first, ...rest] = parts;
  return { fn: first, ln: rest.length ? rest.join(" ") : null };
}

const ISRAEL_COUNTRY_CODE = "972";

// Accepts national (05X-XXXXXXX, 0501234567), international (+972-50-1234567,
// 972501234567), and 00-prefixed intl dial formats. Returns digits-only E.164
// without the leading +, as Meta requires.
export function normalizeIsraeliPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith(ISRAEL_COUNTRY_CODE)) return digits;
  if (digits.startsWith("0")) digits = digits.slice(1);
  return `${ISRAEL_COUNTRY_CODE}${digits}`;
}

// _fbc is usually set by fbevents.js a few seconds after a click lands on the
// page. If it isn't ready but fbclid is in the URL, synthesize the same value
// Meta would eventually write to the cookie.
export function deriveFbcFromUrl(url: string | undefined, now: number = Date.now()): string | null {
  if (!url) return null;
  try {
    const fbclid = new URL(url).searchParams.get("fbclid");
    if (!fbclid) return null;
    return `fb.1.${now}.${fbclid}`;
  } catch {
    // URL parse failed — referer is malformed, treat as if there were no fbclid.
    return null;
  }
}
