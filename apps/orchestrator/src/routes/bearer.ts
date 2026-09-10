const MAX_TOKEN_LENGTH = 256;

export function extractBearer(header: string | string[] | undefined): string | null {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 && token.length <= MAX_TOKEN_LENGTH ? token : null;
}
