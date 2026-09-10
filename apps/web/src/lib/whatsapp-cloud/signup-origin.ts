// The Embedded Signup popup posts its ids from these origins only; a suffix match would admit look-alike hosts.
const EMBEDDED_SIGNUP_ORIGINS: ReadonlySet<string> = new Set(["https://www.facebook.com", "https://web.facebook.com"]);

export function isEmbeddedSignupOrigin(origin: string): boolean {
  return EMBEDDED_SIGNUP_ORIGINS.has(origin);
}
