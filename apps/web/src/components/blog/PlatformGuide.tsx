"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DevicePlatform } from "@/lib/blog";
import { AndroidIcon, AppleIcon } from "./icons";

type Selection = DevicePlatform | "all";

const STORAGE_KEY = "guide-platform";

// Runs before paint so a returning/mobile reader never sees the other platform's steps flash.
const DETECT = `(function(){var p=null;try{p=localStorage.getItem(${JSON.stringify(STORAGE_KEY)})}catch(e){}if(p!=="ios"&&p!=="android"){var u=navigator.userAgent;p=/iPhone|iPad|iPod/.test(u)?"ios":/Android/.test(u)?"android":"all"}document.currentScript.parentElement.setAttribute("data-platform",p)})()`;

interface PlatformChoice {
  platform: Selection;
  choose: (p: DevicePlatform, remember?: boolean) => void;
}

const PlatformContext = createContext<PlatformChoice | null>(null);

export const PLATFORM_OPTIONS: { id: DevicePlatform; label: string; icon: ReactNode }[] = [
  { id: "ios", label: "iPhone", icon: <AppleIcon /> },
  { id: "android", label: "Android", icon: <AndroidIcon /> },
];

export function detectPlatform(): Selection {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "ios" || stored === "android") return stored;
  } catch {
    // storage may be blocked; fall through to UA sniffing
  }
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "all";
}

export function PlatformGuide({ children }: { children: ReactNode }) {
  const [platform, setPlatform] = useState<Selection>("all");
  useEffect(() => setPlatform((current) => (current === "all" ? detectPlatform() : current)), []);
  const choose = useCallback((p: DevicePlatform, remember = true) => {
    setPlatform(p);
    if (!remember) return;
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      // best-effort persistence
    }
  }, []);
  const value = useMemo(() => ({ platform, choose }), [platform, choose]);
  return (
    <PlatformContext.Provider value={value}>
      <div data-platform={platform} suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: DETECT }} />
        {children}
      </div>
    </PlatformContext.Provider>
  );
}

export function usePlatformChoice() {
  return useContext(PlatformContext);
}

export function Platform({ of, children }: { of: DevicePlatform; children: ReactNode }) {
  return <div data-only={of}>{children}</div>;
}

export function PlatformPicker() {
  const ctx = useContext(PlatformContext);
  if (!ctx) return null;
  const { platform, choose } = ctx;
  return (
    <div className="mt-6 rounded-[20px] border border-sand-light bg-cream-dark/50 p-4 sm:p-5">
      <p className="text-sm font-bold text-espresso">באיזה טלפון אתם משתמשים?</p>
      <div role="group" aria-label="בחירת סוג טלפון" className="mt-3 grid grid-cols-2 gap-2">
        {PLATFORM_OPTIONS.map((o) => {
          const on = platform === o.id;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => choose(o.id)}
              className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-base font-bold transition ${
                on
                  ? "border-espresso bg-espresso text-white"
                  : "border-sand bg-white text-espresso hover:border-espresso"
              }`}
            >
              {o.icon}
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-espresso-light" aria-live="polite">
        {platform === "all" ? "בחרו, ונציג רק את השלבים שמתאימים לטלפון שלכם." : "מציגים רק את השלבים לטלפון שבחרתם. אפשר להחליף בכל רגע."}
      </p>
    </div>
  );
}
