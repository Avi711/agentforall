import type { ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { UserMenu } from "./UserMenu";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession("/login");

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <header className="border-b border-sand-light bg-white">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link
            href="/app"
            className="font-display text-xl text-espresso hover:text-terra transition"
          >
            Agent For All
          </Link>
          <UserMenu
            user={{
              email: session.user.email,
              name: session.user.name ?? null,
              image: session.user.image ?? null,
            }}
          />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
