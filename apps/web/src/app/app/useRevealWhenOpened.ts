"use client";

import { useEffect, useRef } from "react";

// "nearest" scrolls only as far as needed, and the page's CSS scroll-behavior keeps reduced motion honoured.
export function useRevealWhenOpened<T extends HTMLElement>(opened: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (opened) ref.current?.scrollIntoView({ block: "nearest" });
  }, [opened]);
  return ref;
}
