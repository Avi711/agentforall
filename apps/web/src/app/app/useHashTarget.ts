"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useHashTarget(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash === `#${id}`,
    () => false,
  );
}
