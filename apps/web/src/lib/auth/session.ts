import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./server";

export type SessionPayload = Awaited<ReturnType<typeof auth.api.getSession>>;
export type AuthenticatedUser = NonNullable<SessionPayload>["user"];

export async function getServerSession(): Promise<SessionPayload> {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession(redirectTo = "/login") {
  const session = await getServerSession();
  if (!session) {
    redirect(redirectTo);
  }
  return session;
}
