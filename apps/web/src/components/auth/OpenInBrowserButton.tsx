"use client";

import { useEffect, useRef, useState } from "react";
import type { BrowserHandoff, HandoffTarget } from "@/lib/auth/in-app-browser";
import { AUTH_WIDE_BUTTON } from "./styles";

const COPY: Record<HandoffTarget, { label: string; caption: string }> = {
  "default-browser": { label: "פתיחה בדפדפן הרגיל", caption: "בספארי או בכרום חשבון הגוגל שלכם בדרך כלל כבר מחובר" },
  chrome: { label: "פתיחה בכרום", caption: "בכרום חשבון הגוגל שלכם בדרך כלל כבר מחובר" },
};

const HANDOFF_TIMEOUT_MS = 1500;
// Phones pause timers in the background, so a timer that fires this late means the app did switch.
const PAUSED_SLACK_MS = 1000;

export function OpenInBrowserButton({ handoff }: { handoff: BrowserHandoff }) {
  const [showHint, setShowHint] = useState(false);
  const stopWatching = useRef(() => {});
  const { label, caption } = COPY[handoff.opens];

  useEffect(() => () => stopWatching.current(), []);

  function watchHandoff() {
    stopWatching.current();
    const startedAt = Date.now();
    const onLeave = () => stopWatching.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onLeave();
    };
    const timer = window.setTimeout(() => {
      stopWatching.current();
      if (Date.now() - startedAt < HANDOFF_TIMEOUT_MS + PAUSED_SLACK_MS) setShowHint(true);
    }, HANDOFF_TIMEOUT_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("blur", onLeave);
    stopWatching.current = () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }

  return (
    <div>
      <a href={handoff.href} onClick={watchHandoff} className={AUTH_WIDE_BUTTON}>
        <OpenExternallyIcon />
        <span>{label}</span>
      </a>
      <p className="mt-2 text-balance text-center text-[13px] text-espresso-light">{caption}</p>
      <div className="disclosure" data-open={showHint || undefined} aria-live="polite">
        <div>
          {showHint ? (
            <p className="mt-2 text-balance rounded-lg bg-cream px-3 py-2 text-center text-[13px] leading-relaxed text-espresso">
              לא נפתח? הקישו על שלוש הנקודות למעלה ובחרו לפתוח בדפדפן.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OpenExternallyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4h5v5M16 4l-7 7M14 12v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3" />
    </svg>
  );
}
