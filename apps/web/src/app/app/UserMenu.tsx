"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth/client";

interface MenuUser {
  email: string;
  name?: string | null;
  image?: string | null;
}

export function UserMenu({ user }: { user: MenuUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    firstItemRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  const initial = (user.name?.[0] ?? user.email[0] ?? "?").toUpperCase();
  const displayName = user.name ?? user.email.split("@")[0];

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-2 rounded-full p-1 pe-2 hover:bg-cream-dark transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <Avatar image={user.image ?? null} initial={initial} />
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={`w-4 h-4 text-espresso-light transition-transform ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute top-full mt-2 end-0 w-64 origin-top-left rtl:origin-top-left ltr:origin-top-right rounded-xl border border-sand-light bg-white shadow-[0_8px_24px_rgba(44,24,16,0.08)] overflow-hidden animate-menu"
        >
          <div className="px-4 py-3 bg-cream-dark/40 border-b border-sand-light">
            <div className="flex items-center gap-3">
              <Avatar image={user.image ?? null} initial={initial} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-espresso truncate">
                  {displayName}
                </p>
                <p
                  className="text-xs text-espresso-light truncate"
                  dir="ltr"
                >
                  {user.email}
                </p>
              </div>
            </div>
          </div>
          <div className="py-1.5">
            <MenuLink
              ref={firstItemRef}
              href="/app"
              icon={<IconHome />}
              onClick={() => setOpen(false)}
            >
              הבוטים שלי
            </MenuLink>
            <MenuLink
              href="/app/settings"
              icon={<IconSettings />}
              onClick={() => setOpen(false)}
            >
              הגדרות
            </MenuLink>
          </div>
          <div className="border-t border-sand-light py-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              disabled={busy}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-espresso-light hover:bg-cream-dark hover:text-espresso transition disabled:opacity-50"
            >
              <IconSignOut />
              <span>{busy ? "מתנתק…" : "התנתקות"}</span>
            </button>
          </div>
        </div>
      ) : null}

      <style jsx>{`
        @keyframes menuIn {
          from {
            opacity: 0;
            transform: translateY(-4px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        :global(.animate-menu) {
          animation: menuIn 140ms ease-out;
        }
      `}</style>
    </div>
  );
}

function Avatar({
  image,
  initial,
  size = "md",
}: {
  image: string | null;
  initial: string;
  size?: "md" | "lg";
}) {
  const dim = size === "lg" ? "w-10 h-10 text-base" : "w-8 h-8 text-sm";
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={image}
        alt=""
        className={`${dim} rounded-full object-cover border border-sand-light`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${dim} rounded-full bg-gradient-to-br from-terra to-terra-light text-white font-medium flex items-center justify-center select-none`}
    >
      {initial}
    </span>
  );
}

const MenuLink = forwardRef<
  HTMLAnchorElement,
  {
    href: string;
    icon: React.ReactNode;
    onClick?: () => void;
    children: React.ReactNode;
  }
>(function MenuLink({ href, icon, onClick, children }, ref) {
  return (
    <Link
      ref={ref}
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-2 text-sm text-espresso-light hover:bg-cream-dark hover:text-espresso transition focus:outline-none focus-visible:bg-cream-dark"
    >
      {icon}
      <span>{children}</span>
    </Link>
  );
});

function IconHome() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="w-[18px] h-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path
        d="M3.5 9l6.5-5.5L16.5 9v7a1 1 0 0 1-1 1H12v-4H8v4H4.5a1 1 0 0 1-1-1V9z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="w-[18px] h-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="10" cy="10" r="2.5" />
      <path
        d="M10 1.5v2.5M10 16v2.5M1.5 10h2.5M16 10h2.5M3.8 3.8l1.8 1.8M14.4 14.4l1.8 1.8M3.8 16.2l1.8-1.8M14.4 5.6l1.8-1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconSignOut() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="w-[18px] h-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path
        d="M12 4.5V3a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-1.5M8 10h10m0 0l-3-3m3 3l-3 3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
