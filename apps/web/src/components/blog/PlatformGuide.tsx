"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Platform = "ios" | "android";
type Selection = Platform | "all";

const STORAGE_KEY = "guide-platform";

// Runs before paint so a returning/mobile reader never sees the other platform's steps flash.
const DETECT = `(function(){var p=null;try{p=localStorage.getItem(${JSON.stringify(STORAGE_KEY)})}catch(e){}if(p!=="ios"&&p!=="android"){var u=navigator.userAgent;p=/iPhone|iPad|iPod/.test(u)?"ios":/Android/.test(u)?"android":"all"}document.currentScript.parentElement.setAttribute("data-platform",p)})()`;

const PlatformContext = createContext<{ platform: Selection; choose: (p: Platform) => void } | null>(null);

function detect(): Selection {
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
  useEffect(() => setPlatform(detect()), []);
  const choose = useCallback((p: Platform) => {
    setPlatform(p);
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      // best-effort persistence
    }
  }, []);
  return (
    <PlatformContext.Provider value={{ platform, choose }}>
      <div data-platform={platform} suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: DETECT }} />
        {children}
      </div>
    </PlatformContext.Provider>
  );
}

export function Platform({ of, children }: { of: Platform; children: ReactNode }) {
  return <div data-only={of}>{children}</div>;
}

const OPTIONS: { id: Platform; label: string; icon: ReactNode }[] = [
  { id: "ios", label: "iPhone", icon: <AppleIcon /> },
  { id: "android", label: "Android", icon: <AndroidIcon /> },
];

export function PlatformPicker() {
  const ctx = useContext(PlatformContext);
  if (!ctx) return null;
  const { platform, choose } = ctx;
  return (
    <div className="mt-6 rounded-[20px] border border-sand-light bg-cream-dark/50 p-4 sm:p-5">
      <p className="text-sm font-bold text-espresso">באיזה טלפון אתם משתמשים?</p>
      <div role="group" aria-label="בחירת סוג טלפון" className="mt-3 grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => {
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

function AppleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
      <path d="M16.4 12.7c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.8-1.1-2.8-4.1zM14 5.4c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
    </svg>
  );
}

function AndroidIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
      <path d="M17.5 8.3l1.6-2.8c.1-.2 0-.4-.1-.5-.2-.1-.4 0-.5.1l-1.6 2.9c-1.3-.6-2.7-.9-4.3-.9s-3 .3-4.3.9L6.7 5.1c-.1-.2-.3-.2-.5-.1-.2.1-.2.3-.1.5l1.6 2.8C4.9 9.8 3 12.6 3 15.8h18c0-3.2-1.9-6-4.5-7.5zM8 13.2c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9zm8 0c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9z" />
    </svg>
  );
}
