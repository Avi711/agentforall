"use client";

import { useEffect, useState } from "react";
import type { GuideSection } from "@/lib/blog";
import { PlayIcon } from "./icons";

export function GuideToc({ items }: { items: GuideSection[] }) {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const onScroll = () => {
      const line = window.innerHeight / 3;
      let current = items[0]?.id;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top <= line) current = item.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [items]);

  return (
    <nav aria-label="תוכן המדריך" className="sticky top-28 rounded-[22px] border border-sand-light bg-white p-4">
      <p className="px-2 text-xs font-bold text-espresso-light">במדריך</p>
      <ol className="mt-2 space-y-0.5">
        {items.map((item) => {
          const on = item.id === active;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={on ? "location" : undefined}
                className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[15px] transition ${
                  on ? "bg-terra-pale font-bold text-espresso" : "text-espresso-light hover:bg-cream-dark/60 hover:text-espresso"
                }`}
              >
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-terra" : "border border-sand"}`} />
                {item.label}
              </a>
            </li>
          );
        })}
      </ol>
      <a
        href="#video"
        className="mt-3 flex items-center gap-3 rounded-2xl bg-[#1E1E22] p-3 text-white transition hover:bg-[#2A2A2F]"
      >
        <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-terra">
          <PlayIcon className="h-4 w-4 translate-x-[1px]" />
        </span>
        <span className="text-sm font-bold">צפו במדריך בווידאו</span>
      </a>
    </nav>
  );
}
