"use client";

import { useState } from "react";
import { signIn } from "@/lib/auth/client";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";

type State = "idle" | "submitting" | "error";

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const [state, setState] = useState<State>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleGoogle() {
    setState("submitting");
    setErrorMessage("");
    try {
      await signIn.social({
        provider: "google",
        callbackURL: redirectTo,
      });
    } catch (err) {
      setState("error");
      setErrorMessage(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
    }
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={handleGoogle}
        disabled={state === "submitting"}
        className="w-full flex items-center justify-center gap-3 px-5 py-3 rounded-xl border border-sand bg-white hover:bg-cream-dark transition disabled:opacity-50 text-espresso font-medium"
      >
        <GoogleMark />
        <span>המשך עם Google</span>
      </button>

      {state === "error" && errorMessage ? (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.97 10.97 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
        fill="#EA4335"
      />
    </svg>
  );
}
