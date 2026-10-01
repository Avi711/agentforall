"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PendingLink } from "@/app/app/Pending";
import { WhatsAppChatLink } from "@/components/WhatsAppChatLink";
import { CTA_LABEL, HEADER_LINKS, WHATSAPP_ASK } from "./content";
import { ThemeSwitch, ThemeToggle } from "./ThemeToggle";
import { CONTAINER, FOCUS, NAV_LINK, SMALL, SMALL_PRIMARY_BUTTON } from "./theme";

const MENU_ID = "landing-menu";
const HEADER_HEIGHT_PX = 64;
const SCROLL_INTENT_PX = 8;
const SECTION_BAND = "-40% 0px -55% 0px";
const BAR = "mx-auto flex h-14 w-full items-center justify-between gap-4 rounded-full border backdrop-blur-md transition-[max-width,padding,background-color,border-color,box-shadow] duration-[450ms] ease-(--ease-smooth)";
const BAR_FLOATING = "max-w-full border-(--line) bg-(--header-glass) px-3 shadow-(--header-shadow) sm:px-4 lg:max-w-[82%]";
const BAR_RESTING = "max-w-full border-transparent px-0";
const NAV_IDS = new Set<string>(HEADER_LINKS.map((link) => link.href.slice(1)));
const MENU_ITEM = `block rounded-lg py-3.5 text-[17px] font-semibold transition-colors hover:text-(--accent-ink) ${FOCUS}`;
const MENU_LINK = `${MENU_ITEM} text-(--ink)`;
const NAV_ITEM = `rounded-full px-3.5 py-2 font-medium transition-colors ${FOCUS}`;

export function Wordmark() {
  return (
    <Link href="/" dir="ltr" aria-label="Agent For All, לדף הבית" className={`rounded-md text-[20px] tracking-[-0.02em] text-(--ink) ${FOCUS}`}>
      <span className="font-extrabold">Agent</span>
      <span className="font-normal text-(--ink-2)">for</span>
      <span className="font-extrabold text-(--accent-ink)">All</span>
    </Link>
  );
}

function useScrollState() {
  const [scrolled, setScrolled] = useState(false);
  const [scrollingDown, setScrollingDown] = useState(false);
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
  return { scrolled, scrollingDown, reveal: () => setScrollingDown(false) };
}

function useActiveSection(): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(NAV_IDS.has(entry.target.id) ? entry.target.id : null);
        }
      },
      { rootMargin: SECTION_BAND },
    );
    document.querySelectorAll("main > section").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  return active;
}

export function Header() {
  const [open, setOpen] = useState(false);
  const { scrolled, scrollingDown, reveal } = useScrollState();
  const active = useActiveSection();
  const menuButton = useRef<HTMLButtonElement>(null);

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

  const floating = scrolled || open;
  const tucked = scrollingDown && !open;
  const close = () => setOpen(false);

  return (
    <header onFocusCapture={reveal} className={`sticky top-0 transition-[translate] duration-300 ease-(--ease-out) ${open ? "z-50" : "z-40"} ${tucked ? "max-lg:-translate-y-full" : ""}`}>
      <div className={`${CONTAINER} flex h-16 items-center`}>
        <div className={`${BAR} ${floating ? BAR_FLOATING : BAR_RESTING}`}>
          <Wordmark />
          <nav aria-label="ראשי" className={`${SMALL} hidden items-center gap-1 whitespace-nowrap lg:flex`}>
            {HEADER_LINKS.map((link) => {
              const current = active === link.href.slice(1);
              return (
                <a
                  key={link.href}
                  href={link.href}
                  aria-current={current ? "true" : undefined}
                  className={`${NAV_ITEM} ${current ? "bg-(--surface-2) text-(--ink)" : "text-(--ink-2) hover:text-(--ink)"}`}
                >
                  {link.label}
                </a>
              );
            })}
            <Link href="/blog" className={`${NAV_ITEM} text-(--ink-2) hover:text-(--ink)`}>
              בלוג
            </Link>
          </nav>
          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap sm:gap-3">
            <ThemeToggle className="max-lg:hidden" />
            <PendingLink href="/app" className={`${SMALL} hidden px-1 font-medium sm:inline ${NAV_LINK}`}>
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
              className={`flex h-11 w-11 items-center justify-center rounded-full text-(--ink) transition-colors hover:bg-(--surface-2) lg:hidden ${FOCUS}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 8h16M4 16h16" />}
              </svg>
            </button>
          </div>
        </div>
      </div>
      {open ? <div aria-hidden="true" onClick={close} className="scrim fixed inset-0 -z-10 bg-black/30 lg:hidden" /> : null}
      {open ? (
        <nav id={MENU_ID} aria-label="תפריט" className="absolute inset-x-0 top-full px-1.5 lg:hidden">
          <div className="animate-popover origin-top rounded-[28px] border border-(--line) bg-(--page) px-5 py-2 shadow-(--header-shadow)">
            <ul className="divide-y divide-(--line)">
              {HEADER_LINKS.map((link) => (
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
              <li>
                <ThemeSwitch />
              </li>
              <li>
                <PendingLink href="/app" onClick={close} className={MENU_LINK}>
                  כניסה לחשבון
                </PendingLink>
              </li>
              <li>
                <WhatsAppChatLink onClick={close} className={`${MENU_ITEM} text-(--accent-ink)`}>
                  {WHATSAPP_ASK}
                </WhatsAppChatLink>
              </li>
            </ul>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
