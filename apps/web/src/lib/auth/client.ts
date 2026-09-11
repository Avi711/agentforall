"use client";
import { useEffect, useState } from "react";
import { createAuthClient } from "better-auth/react";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "",
});

export const { signIn, signOut, useSession, getSession } = authClient;

export function useGoogleSignIn() {
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Back from Google restores the page from the bfcache with `redirecting` still set.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function start(callbackURL: string) {
    setRedirecting(true);
    setError(null);
    try {
      const { error: signInError } = await signIn.social({ provider: "google", callbackURL });
      if (signInError) throw new Error(signInError.message ?? UNEXPECTED_ERROR_HE);
    } catch (err) {
      setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
      setRedirecting(false);
    }
  }

  return { redirecting, error, start };
}
