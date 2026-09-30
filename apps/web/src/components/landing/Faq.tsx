"use client";

import { useState } from "react";
import { WhatsAppChatLink } from "@/components/WhatsAppChatLink";
import { WhatsAppIcon } from "@/components/WhatsAppIcon";
import type { FaqItem } from "@/content/faq.he";
import { LANDING_FAQS, WHATSAPP_ASK } from "./content";
import { BODY, CARD, CONTAINER, FOCUS, H2, H3, SECTION, SMALL, TEXT_LINK } from "./theme";

export function Faq() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section id="faq" aria-labelledby="faq-title" className={`${SECTION} border-t border-(--line)`}>
      <div className={`${CONTAINER} grid gap-10 lg:grid-cols-12 lg:gap-12`}>
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-24">
            <h2 id="faq-title" className={H2}>
              שאלות נפוצות.
            </h2>
            <div className={`${CARD} mt-8 p-6`}>
              <p className={H3}>לא מצאתם תשובה?</p>
              <p className={`${SMALL} mt-2 text-(--ink-2)`}>עונים בעברית, לפני שמתחילים ואחרי.</p>
              <WhatsAppChatLink className={`${SMALL} mt-4 inline-flex items-center gap-2 ${TEXT_LINK}`}>
                <WhatsAppIcon className="h-5 w-5 text-wa-teal" />
                {WHATSAPP_ASK}
              </WhatsAppChatLink>
            </div>
          </div>
        </div>
        <ul className="border-t border-(--line) lg:col-span-8">
          {LANDING_FAQS.map((faq, i) => (
            <Question key={faq.q} faq={faq} index={i} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function Question({ faq, index, open, onToggle }: { faq: FaqItem; index: number; open: boolean; onToggle: () => void }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const answerId = `faq-answer-${index}`;
  return (
    <li className="border-b border-(--line)">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={answerId}
          className={`group flex w-full items-center justify-between gap-6 rounded-lg py-5 text-start text-[17px] font-bold text-(--ink) sm:text-[20px] ${FOCUS}`}
        >
          {faq.q}
          <span
            aria-hidden="true"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
              open ? "rotate-45 border-terra-strong bg-terra-strong text-white" : "border-(--line-2) text-(--ink-2) group-hover:border-(--ink)/50 group-hover:text-(--ink)"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
        </button>
      </h3>
      <div id={answerId} className="disclosure" data-open={open ? "" : undefined}>
        <div inert={!open}>
          <p className={`${BODY} max-w-[62ch] pb-5 text-(--ink-2)`}>{faq.a}</p>
          {faq.note ? (
            <div className="mb-5 rounded-[12px] border border-(--line) bg-(--surface-2)">
              <button
                type="button"
                onClick={() => setNoteOpen((o) => !o)}
                aria-expanded={noteOpen}
                className={`${SMALL} flex w-full items-center gap-3 rounded-[12px] px-4 py-3.5 text-start font-semibold text-(--ink) ${FOCUS}`}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-(--accent-ink)" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
                {faq.note.title}
                <svg aria-hidden="true" viewBox="0 0 20 20" className={`ms-auto h-4 w-4 shrink-0 text-(--ink-2) transition-transform ${noteOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 8 5 5 5-5" />
                </svg>
              </button>
              <div className="disclosure" data-open={noteOpen ? "" : undefined}>
                <div inert={!noteOpen}>
                  <p className={`${SMALL} px-4 pb-4 text-(--ink-2)`}>{faq.note.body}</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
