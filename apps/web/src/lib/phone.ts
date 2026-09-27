// Israeli-first input: "050-1234567" → "972501234567"; already-international input passes through.
export function normalizeIsraeliPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("972")) return digits;
  return `972${digits.replace(/^0+/, "")}`;
}

export function isValidIsraeliPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("972") ? digits.slice(3) : digits.replace(/^0+/, "");
  return local.length === 9;
}

export function formatE164(value: string): string {
  return value.startsWith("+") ? value : `+${value}`;
}

const INTERNATIONAL_RE = /^\+[1-9]\d{6,14}$/;

// "050-1234567" → "+972501234567"; "+44…" passes through; anything else is rejected.
export function normalizePhoneInput(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("+")) {
    const compact = value.replace(/[\s().-]/g, "");
    return INTERNATIONAL_RE.test(compact) ? compact : null;
  }
  return isValidIsraeliPhone(value) ? `+${normalizeIsraeliPhone(value)}` : null;
}

// Israeli numbers read best in their local form ("050-123-4567"); anything else keeps its international prefix.
export function formatPhoneForDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!/^972\d{8,9}$/.test(digits)) return `+${digits}`;
  const local = `0${digits.slice(3)}`;
  const area = local.length === 10 ? 3 : 2;
  return `${local.slice(0, area)}-${local.slice(area, area + 3)}-${local.slice(area + 3)}`;
}
