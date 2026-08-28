"use client";

import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition, type ComponentProps } from "react";

// Zero-size marker: globals.css styles the parent link through :has(), so a pending link can never reflow.
function LinkPendingHint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`link-hint${pending ? " is-pending" : ""}`} />;
}

export function PendingLink({ children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <LinkPendingHint />
    </Link>
  );
}

// Keeps a control busy until the refreshed server payload is painted, not just until its fetch resolved.
export function useRefresh(): { refreshing: boolean; refresh: (onSettled?: () => void) => void } {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const settle = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (refreshing || !settle.current) return;
    const done = settle.current;
    settle.current = null;
    done();
  }, [refreshing]);

  return {
    refreshing,
    refresh: (onSettled) => {
      settle.current = onSettled ?? null;
      startTransition(() => router.refresh());
    },
  };
}

// Same contract for a client-side navigation: pending stays true until the destination commits.
export function useNavigate(): { navigating: boolean; navigate: (href: string, mode?: "push" | "replace") => void } {
  const router = useRouter();
  const [navigating, startTransition] = useTransition();

  return {
    navigating,
    navigate: (href, mode = "push") => {
      startTransition(() => {
        if (mode === "replace") router.replace(href);
        else router.push(href);
      });
    },
  };
}
