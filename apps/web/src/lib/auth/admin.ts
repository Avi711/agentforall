import "server-only";
import { notFound } from "next/navigation";
import { authenticatedHandler, errorJson, type Handler, type HandlerOptions } from "./api";
import { requireSession, type AuthenticatedUser } from "./session";

// Admin is a role granted to specific Google accounts (ADMIN_EMAILS), never a shared password.
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

export function isAdminUser(user: Pick<AuthenticatedUser, "email">): boolean {
  return ADMIN_EMAILS.has(user.email.toLowerCase());
}

// Pages: signed out → login; signed in but not admin → 404, so the area stays invisible.
export async function requireAdminSession() {
  const session = await requireSession("/login");
  if (!isAdminUser(session.user)) notFound();
  return session;
}

// API routes: same rule, as JSON.
export function adminHandler<Body = undefined>(
  opts: HandlerOptions<Body>,
  handler: Handler<Body>,
) {
  return authenticatedHandler<Body>(opts, (ctx) =>
    isAdminUser(ctx.user) ? handler(ctx) : errorJson("not_found", 404),
  );
}
