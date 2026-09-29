"use client";
import { useState } from "react";

export function useCopy(text: string | undefined): { copied: boolean; copy: (() => Promise<void>) | null } {
  const [copied, setCopied] = useState(false);
  if (!text) return { copied, copy: null };
  return {
    copied,
    copy: async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        // Clipboard blocked (insecure context); the value stays visible to copy by hand.
      }
    },
  };
}
