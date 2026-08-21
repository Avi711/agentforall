// E.164 without the "+": 7–15 digits, no leading zero.
const E164_DIGITS_RE = /^[1-9]\d{6,14}$/;

// Accepts "+972501234567", "972501234567", "whatsapp:+972…", "972…@s.whatsapp.net".
export function normalizeE164(raw: string): string | null {
  const stripped = raw
    .trim()
    .replace(/^whatsapp:/i, "")
    .replace(/@.*$/, "")
    .replace(/[\s().-]/g, "");
  const digits = stripped.startsWith("+") ? stripped.slice(1) : stripped;
  if (!E164_DIGITS_RE.test(digits)) return null;
  return `+${digits}`;
}

export function isSameE164(a: string, b: string): boolean {
  const na = normalizeE164(a);
  const nb = normalizeE164(b);
  return na !== null && na === nb;
}
