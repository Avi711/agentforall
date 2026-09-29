"use client";
import { useState } from "react";

export function useCopy(text: string | undefined): {
  copied: boolean;
  failed: boolean;
  copy: (() => Promise<void>) | null;
} {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!text) return { copied, failed, copy: null };
  return {
    copied,
    failed,
    copy: async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        setFailed(true);
      }
    },
  };
}
