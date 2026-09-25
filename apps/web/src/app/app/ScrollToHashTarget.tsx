"use client";

import { useEffect } from "react";

// Next.js spends a link's #fragment on the loading skeleton, before the streamed target exists.
export function ScrollToHashTarget() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
