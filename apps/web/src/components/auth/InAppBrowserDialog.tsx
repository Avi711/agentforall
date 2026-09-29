"use client";

import { useEffect, useId, useRef } from "react";
import type { BrowserHandoff } from "@/lib/auth/in-app-browser";
import { ROW_ACTION_CLASS } from "@/app/app/action-buttons";
import { CloseButton } from "@/app/app/Marks";

const MENU_STEP = "הקישו על שלוש הנקודות בראש המסך ובחרו לפתוח בדפדפן.";

export function InAppBrowserDialog({ handoff, onClose }: { handoff: BrowserHandoff; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  // The dialog would otherwise focus its close button first; the title reads the situation aloud instead.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el || el.open) return;
    el.showModal();
    titleRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="fixed inset-0 m-auto w-[min(92vw,400px)] rounded-3xl border border-sand-light p-0 shadow-[0_20px_48px_rgba(44,24,16,0.18)] backdrop:bg-espresso/40"
    >
      <div className="relative px-6 pb-6 pt-7">
        <CloseButton onClick={() => dialogRef.current?.close()} className="absolute end-4 top-4" />
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="pe-8 font-display text-xl leading-snug text-espresso focus:outline-none">
          להתחברות עם גוגל, עוברים לדפדפן
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-espresso-light">גוגל לא מאפשרת להתחבר מתוך אינסטגרם ואפליקציות דומות.</p>
        {handoff.href ? (
          <>
            <a href={handoff.href} className={`${ROW_ACTION_CLASS.primary} mt-5 w-full`}>
              פתיחה בדפדפן
            </a>
            <p className="mt-3 text-center text-[13px] leading-relaxed text-espresso-light">לא נפתח? {MENU_STEP}</p>
          </>
        ) : (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-cream px-3.5 py-3 text-sm font-medium leading-relaxed text-espresso">
            <ArrowUpIcon />
            <span>{MENU_STEP}</span>
          </p>
        )}
      </div>
    </dialog>
  );
}

function ArrowUpIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 16V4M5 9l5-5 5 5" />
    </svg>
  );
}
