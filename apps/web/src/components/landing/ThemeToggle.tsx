"use client";

import { useSyncExternalStore } from "react";
import { DARK_MODE_ATTRIBUTE, DARK_MODE_KEY } from "./darkMode";
import { FOCUS } from "./theme";

const LABEL = "מצב כהה";
const ICON = "absolute h-5 w-5 transition-[opacity,rotate,scale] duration-300 ease-(--ease-out)";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [DARK_MODE_ATTRIBUTE] });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.getAttribute(DARK_MODE_ATTRIBUTE) === "dark";

function useDarkMode(): [boolean, () => void] {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const toggle = () => {
    const next = !isDark();
    if (next) document.documentElement.setAttribute(DARK_MODE_ATTRIBUTE, "dark");
    else document.documentElement.removeAttribute(DARK_MODE_ATTRIBUTE);
    try {
      localStorage.setItem(DARK_MODE_KEY, next ? "dark" : "light");
    } catch {
      // Storage can be blocked (private mode); the choice then lasts for this visit only.
    }
  };
  return [dark, toggle];
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, toggle] = useDarkMode();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={LABEL}
      className={`relative flex h-11 w-11 items-center justify-center rounded-full text-(--ink-2) transition-colors hover:bg-(--surface-2) hover:text-(--ink) ${FOCUS} ${className}`}
    >
      <SunIcon className={`${ICON} landing-dark:rotate-90 landing-dark:scale-50 landing-dark:opacity-0`} />
      <MoonIcon className={`${ICON} -rotate-90 scale-50 opacity-0 landing-dark:rotate-0 landing-dark:scale-100 landing-dark:opacity-100`} />
    </button>
  );
}

export function ThemeSwitch() {
  const [dark, toggle] = useDarkMode();
  return (
    <button type="button" role="switch" aria-checked={dark} onClick={toggle} className={`flex w-full items-center justify-between rounded-lg py-3.5 text-[17px] font-semibold text-(--ink) ${FOCUS}`}>
      <span className="flex items-center gap-3">
        <MoonIcon className="h-5 w-5 text-(--ink-2)" />
        {LABEL}
      </span>
      <span aria-hidden="true" className="relative h-7 w-12 rounded-full bg-(--line-2) transition-colors landing-dark:bg-terra-strong">
        <span className="absolute start-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-[inset-inline-start] duration-200 landing-dark:start-6" />
      </span>
    </button>
  );
}

function SunIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
    </svg>
  );
}

function MoonIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" />
    </svg>
  );
}
