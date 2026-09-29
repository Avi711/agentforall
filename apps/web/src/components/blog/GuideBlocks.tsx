import type { ReactNode } from "react";
import type { GuideStep } from "@/lib/blog";

export function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="font-display mt-14 scroll-mt-28 text-2xl text-espresso sm:text-3xl">
      {children}
    </h2>
  );
}

export function Step({ id, steps }: { id: string; steps: GuideStep[] }) {
  const index = steps.findIndex((s) => s.id === id);
  if (index < 0) throw new Error(`Unknown guide step "${id}"`);
  const n = index + 1;
  return (
    <header id={id} className="mt-16 scroll-mt-28">
      <p className="text-sm font-bold text-terra-dark">
        שלב {n} מתוך {steps.length}
      </p>
      <div className="mt-3 flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-terra text-xl font-bold text-white"
        >
          {n}
        </span>
        <h2 className="font-display text-3xl leading-tight text-espresso sm:text-4xl">{steps[index].title}</h2>
      </div>
    </header>
  );
}

export function Tip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="mt-8 flex gap-3 rounded-[20px] bg-sage-pale px-5 py-4 text-sage-dark">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
      </svg>
      <p className="leading-relaxed">
        <strong className="font-bold">{title}</strong> {children}
      </p>
    </aside>
  );
}

export function KeyPoint({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10 rounded-[24px] bg-espresso p-5 text-white sm:p-6">
      <h3 className="text-lg font-bold sm:text-xl">{title}</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function KeyPointItem({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <div className="rounded-[18px] bg-white/10 p-4">
      <p className="text-[13px] font-bold text-terra-light">{label}</p>
      <p className="mt-1 text-base font-bold">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-white/80">{children}</p>
    </div>
  );
}
