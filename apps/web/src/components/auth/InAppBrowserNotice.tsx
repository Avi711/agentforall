"use client";

import { useEffect, useRef } from "react";
import type { BrowserHandoff } from "@/lib/auth/in-app-browser";
import { useCopy } from "@/lib/use-copy";
import { AUTH_LINK, AUTH_PRIMARY } from "./styles";

export function InAppBrowserNotice({ handoff }: { handoff: BrowserHandoff }) {
  const titleRef = useRef<HTMLParagraphElement>(null);
  const { copied, failed, copy } = useCopy(handoff.url);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <div className="space-y-4 rounded-xl border border-sand bg-cream p-4 text-sm text-espresso">
      <div className="space-y-1">
        <p ref={titleRef} tabIndex={-1} className="font-medium focus:outline-none">
          כדי להתחבר עם גוגל, פתחו את העמוד בדפדפן
        </p>
        <p className="text-espresso-light">גוגל לא מאפשרת להתחבר מתוך אפליקציות כמו אינסטגרם ופייסבוק.</p>
      </div>
      {handoff.href ? (
        <a href={handoff.href} className={`block text-center ${AUTH_PRIMARY}`}>
          פתיחה בדפדפן
        </a>
      ) : null}
      <p className={`flex items-start gap-2 leading-relaxed ${handoff.href ? "text-espresso-light" : "font-medium"}`}>
        <ArrowUpIcon />
        <span>{handoff.href ? "לא נפתח? " : ""}הקישו על שלוש הנקודות בראש המסך ובחרו לפתוח בדפדפן.</span>
      </p>
      <div>
        <button type="button" onClick={copy ?? undefined} className={`py-1 ${AUTH_LINK}`}>
          {copied ? "הקישור הועתק" : "העתקת הקישור"}
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? "הקישור הועתק" : ""}
        </span>
        {failed ? (
          <p dir="ltr" className="mt-2 select-all break-all rounded-lg bg-white px-3 py-2 text-left text-espresso-light">
            {handoff.url}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ArrowUpIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 16V4M5 9l5-5 5 5" />
    </svg>
  );
}
