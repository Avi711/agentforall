// Rightmost XFF value is Vercel-attested; leftmost is client-spoofable.
export function extractClientIp(xff: string | null): string | null {
  if (!xff) return null;
  const parts = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.at(-1) ?? null;
}
