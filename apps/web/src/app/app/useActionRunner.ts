"use client";

import { useState } from "react";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";

export function useActionRunner<Key extends string>() {
  const [pending, setPending] = useState<Key | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `leaves` work hands the tab to another page: clearing pending would un-busy the button mid-unload.
  async function run(key: Key, work: () => Promise<void>, leaves = false) {
    if (pending) return;
    setPending(key);
    setError(null);
    try {
      await work();
      if (!leaves) setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : UNEXPECTED_ERROR_HE);
      setPending(null);
    }
  }

  function redirect(key: Key, destination: () => Promise<string>) {
    return run(key, async () => window.location.assign(await destination()), true);
  }

  return { pending, error, run, redirect };
}
