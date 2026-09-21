import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./server";

export type SessionPayload = Awaited<ReturnType<typeof auth.api.getSession>>;
export type AuthenticatedUser = NonNullable<SessionPayload>["user"];

// An unconfirmed email is never a session: admin, trial and lead lookups all trust user.email.
export async function getServerSession(): Promise<SessionPayload> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.emailVerified ? session : null;
}

export async function requireSession(redirectTo = "/login") {
  const session = await getServerSession();
  if (!session) {
    redirect(redirectTo);
  }
  return session;
}
