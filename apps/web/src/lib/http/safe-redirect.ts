// Pages only: browsers strip tabs/newlines (`/\t/evil.com` becomes `//evil.com`), and an /api/ target would let a redirect chain call an endpoint as the user.
const SAFE_PATH_RE = /^\/(?![/\\])(?!api(?:[/?#]|$))[^\s\\\u0000-\u001f\u007f]*$/;

export function safeRedirectPath(value: unknown, fallback = "/app"): string {
  return typeof value === "string" && SAFE_PATH_RE.test(value) ? value : fallback;
}
