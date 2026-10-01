"use client";

import { useEffect, useState } from "react";
import { PendingLink } from "@/app/app/Pending";
import { WhatsAppChatLink } from "@/components/WhatsAppChatLink";
import { WhatsAppIcon } from "@/components/WhatsAppIcon";
import { CTA_LABEL, WHATSAPP_ASK } from "./content";
import { ArrowForward } from "./marks";
import { FOCUS, SMALL_PRIMARY_BUTTON } from "./theme";

const HIDE_NEAR = "[data-final-cta], footer";

function useBarVisible(): boolean {
  const [heroOut, setHeroOut] = useState(false);
  const [nearEnd, setNearEnd] = useState(false);
  useEffect(() => {
    const hero = document.querySelector("[data-hero-cta]");
    if (!hero) return;
    const heroObserver = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      setHeroOut(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    heroObserver.observe(hero);
    const visible = new Set<Element>();
    const endObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      setNearEnd(visible.size > 0);
    });
    document.querySelectorAll(HIDE_NEAR).forEach((el) => endObserver.observe(el));
    return () => {
      heroObserver.disconnect();
      endObserver.disconnect();
    };
  }, []);
  return heroOut && !nearEnd;
}

export function StickyCta() {
  const visible = useBarVisible();
  return (
    <div
      data-sticky-cta=""
      data-visible={visible ? "" : undefined}
      inert={!visible}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-(--line) bg-(--page) pb-[env(safe-area-inset-bottom)] transition-transform duration-[350ms] ease-(--ease-out) lg:hidden ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="flex h-(--sticky-cta-h) items-center justify-between gap-3 pe-(--a11y-clearance) ps-4">
        <PendingLink href="/app" className={SMALL_PRIMARY_BUTTON}>
          {CTA_LABEL}
          <ArrowForward className="h-4 w-4" />
        </PendingLink>
        <WhatsAppChatLink className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-(--line-2) text-wa-teal hover:bg-(--surface) ${FOCUS}`}>
          <WhatsAppIcon className="h-6 w-6" />
          <span className="sr-only">{WHATSAPP_ASK}</span>
        </WhatsAppChatLink>
      </div>
    </div>
  );
}
