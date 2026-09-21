"use client";
import { useEffect, useRef, useState } from "react";
import { createAuthClient } from "better-auth/react";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import { authErrorMessage } from "./error-messages";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "",
});

export const { signIn, signOut, useSession, getSession } = authClient;

// Back after a redirect restores the page from the bfcache with its busy state still set.
export function useOnBfcacheRestore(callback: () => void) {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) latest.current();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
}

export function useGoogleSignIn() {
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useOnBfcacheRestore(() => setRedirecting(false));

  async function start(callbackURL: string) {
    setRedirecting(true);
    setError(null);
    try {
      const { error: signInError } = await signIn.social({ provider: "google", callbackURL });
      if (signInError) {
        setError(authErrorMessage(signInError));
        setRedirecting(false);
      }
    } catch {
      setError(UNEXPECTED_ERROR_HE);
      setRedirecting(false);
    }
  }

  return { redirecting, error, start };
}
