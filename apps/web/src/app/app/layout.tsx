import type { ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { UserMenu } from "./UserMenu";
import { BrandMark } from "./Marks";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession("/login");

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <header className="bg-cream/85 backdrop-blur supports-[backdrop-filter]:bg-cream/70 sticky top-0 z-30 border-b border-sand-light/70">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link
            href="/app"
            className="group inline-flex items-center gap-2.5 text-espresso hover:text-terra transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra rounded-md"
          >
            <BrandMark className="w-[18px] h-[18px] text-terra group-hover:rotate-45 transition-transform duration-300" />
            <span className="font-display text-xl tracking-tight">Agent For All</span>
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
      <main id="main" className="flex-1 relative">{children}</main>
    </div>
  );
}
