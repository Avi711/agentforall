"use client";

import { useState, useEffect } from "react";

const links = [
  { label: "יכולות", href: "#features" },
  { label: "איך זה עובד", href: "#how-it-works" },
  { label: "שאלות נפוצות", href: "#faq" },
];

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 z-50 w-full transition-all duration-300 ${
        scrolled
          ? "border-b border-sand/40 bg-cream/90 shadow-sm backdrop-blur-xl"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <a href="#" className="text-xl text-espresso" style={{ letterSpacing: '-0.02em' }}>
          <span className="font-extrabold">Agent</span><span className="font-normal text-espresso-light">for</span><span className="font-extrabold text-terra">All</span>
        </a>

        <div className="hidden items-center gap-7 sm:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-espresso-light transition-colors hover:text-terra"
            >
              {link.label}
            </a>
          ))}
          <a
            href="#signup"
            className="rounded-full bg-espresso px-6 py-2.5 text-sm font-bold text-cream transition-all hover:bg-terra hover:shadow-lg hover:shadow-terra/20"
          >
            הצטרפו לרשימה
          </a>
        </div>

        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="rounded-full p-2 text-espresso transition-colors hover:bg-sand-light sm:hidden"
          aria-label="תפריט"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {menuOpen && (
        <div className="bg-cream px-5 pb-6 sm:hidden">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="block border-b border-sand/30 py-4 text-base font-medium text-espresso-light"
            >
              {link.label}
            </a>
          ))}
          <a
            href="#signup"
            onClick={() => setMenuOpen(false)}
            className="mt-4 block rounded-full bg-terra px-6 py-3 text-center text-base font-bold text-white"
          >
            הצטרפו לרשימה
          </a>
        </div>
      )}
    </nav>
  );
}
