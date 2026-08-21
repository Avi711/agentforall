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
