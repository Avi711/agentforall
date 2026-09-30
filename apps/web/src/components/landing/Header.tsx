"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PendingLink } from "@/app/app/Pending";
import { WhatsAppChatLink } from "@/components/WhatsAppChatLink";
import { CTA_LABEL, NAV_LINKS, WHATSAPP_ASK } from "./content";
import { CONTAINER, FOCUS, NAV_LINK, SMALL, SMALL_PRIMARY_BUTTON } from "./theme";

const MENU_ID = "landing-menu";
const HEADER_HEIGHT_PX = 64;
const SCROLL_INTENT_PX = 8;
const MENU_LINK = `block py-3.5 text-[17px] font-semibold ${NAV_LINK}`;

export function Wordmark() {
  return (
    <Link href="/" dir="ltr" aria-label="Agent For All, לדף הבית" className={`rounded-md text-[20px] tracking-[-0.02em] text-(--ink) ${FOCUS}`}>
      <span className="font-extrabold">Agent</span>
      <span className="font-normal text-(--ink-2)">for</span>
      <span className="font-extrabold text-(--accent-ink)">All</span>
    </Link>
  );
}

export function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [scrollingDown, setScrollingDown] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > SCROLL_INTENT_PX);
      if (Math.abs(y - lastY) < SCROLL_INTENT_PX) return;
      setScrollingDown(y > lastY && y > HEADER_HEIGHT_PX);
      lastY = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const solid = scrolled || open;
  const tucked = scrollingDown && !open;
  const close = () => setOpen(false);

  return (
    <header
      onFocusCapture={() => setScrollingDown(false)}
      className={`sticky top-0 z-40 border-b transition-[background-color,border-color,translate] duration-300 ease-(--ease-out) ${solid ? "border-(--line) bg-(--page)/90 backdrop-blur-xl" : "border-transparent bg-(--page)"} ${tucked ? "max-lg:-translate-y-full" : ""}`}
    >
      <div className={`${CONTAINER} flex h-16 items-center justify-between gap-4`}>
        <Wordmark />
        <nav aria-label="ראשי" className={`${SMALL} hidden items-center gap-7 whitespace-nowrap lg:flex`}>
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className={NAV_LINK}>
              {link.label}
            </a>
          ))}
          <Link href="/blog" className={NAV_LINK}>
            בלוג
          </Link>
        </nav>
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap sm:gap-5">
          <PendingLink href="/app" className={`${SMALL} hidden sm:inline ${NAV_LINK}`}>
            כניסה
          </PendingLink>
          <PendingLink href="/app" className={SMALL_PRIMARY_BUTTON}>
            {CTA_LABEL}
          </PendingLink>
          <button
            ref={menuButton}
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={MENU_ID}
            aria-label={open ? "סגירת התפריט" : "פתיחת התפריט"}
            className={`flex h-11 w-11 items-center justify-center rounded-full border border-(--line-2) text-(--ink) transition-colors hover:border-(--ink)/50 lg:hidden ${FOCUS}`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 8h16M4 16h16" />}
            </svg>
          </button>
        </div>
      </div>
      {open ? (
        <nav id={MENU_ID} aria-label="תפריט" className="border-t border-(--line) lg:hidden">
          <ul className={`${CONTAINER} flex flex-col py-2`}>
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} onClick={close} className={MENU_LINK}>
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <Link href="/blog" onClick={close} className={MENU_LINK}>
                בלוג
              </Link>
            </li>
            <li className="border-t border-(--line)">
              <PendingLink href="/app" onClick={close} className={MENU_LINK}>
                כניסה לחשבון
              </PendingLink>
            </li>
            <li>
              <WhatsAppChatLink onClick={close} className={MENU_LINK}>
                {WHATSAPP_ASK}
              </WhatsAppChatLink>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
