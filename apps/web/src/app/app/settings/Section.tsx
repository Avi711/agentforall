import type { ReactNode, Ref } from "react";
import { Spinner } from "../Marks";

export const SUBSECTION_TITLE = "text-base font-semibold text-espresso";

export function PageSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-24 flex-col gap-3">
      <h2 id={`${id}-title`} className="font-display text-xl text-espresso sm:text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function CardSection({
  id,
  labelledBy,
  tinted = false,
  sectionRef,
  children,
}: {
  id?: string;
  labelledBy: string;
  tinted?: boolean;
  sectionRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      ref={sectionRef}
      aria-labelledby={labelledBy}
      className={`scroll-mt-24 border-t border-sand-light/70 px-6 py-6 sm:px-8 ${tinted ? "bg-cream" : ""}`}
    >
      {children}
    </section>
  );
}

export interface OptionRowProps {
  title: string;
  detail: string;
  pending?: boolean;
  external?: boolean;
  danger?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function OptionRow({ title, detail, pending = false, external = false, danger = false, expanded, disabled, onSelect }: OptionRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-busy={pending}
      aria-expanded={expanded}
      onClick={onSelect}
      className="-mx-3 flex w-[calc(100%+1.5rem)] items-center justify-between gap-4 rounded-xl px-3 py-3.5 text-start transition hover:bg-cream-dark/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-60"
    >
      <span className="flex flex-col gap-0.5">
        <span className={`text-[15px] font-semibold ${danger ? "text-red-700" : "text-espresso"}`}>{title}</span>
        <span className="text-[13px] text-espresso-light">{detail}</span>
      </span>
      <span className="text-espresso-light">
        {pending ? <Spinner /> : external ? <ExternalMark /> : <ChevronDown open={expanded ?? false} />}
      </span>
    </button>
  );
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExternalMark() {
  return (
    <>
      <span className="sr-only">(נפתח אצל ספק התשלומים)</span>
      <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] rtl:-scale-x-100">
        <path d="M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5" />
      </svg>
    </>
  );
}
