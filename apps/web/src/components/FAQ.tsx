"use client";

import { useState } from "react";
import { faqs } from "@/content/faq.he";

export function FAQ() {
  const [open, setOpen] = useState<number | null>(null);
  const [noteOpen, setNoteOpen] = useState<number | null>(null);

  return (
    <section id="faq" className="px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-display text-center text-4xl font-black tracking-tight text-espresso sm:text-5xl">
          שאלות נפוצות
        </h2>

        <div className="mt-14 space-y-3">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className={`overflow-hidden rounded-2xl border transition-all duration-300 ${
                open === i
                  ? "border-terra/20 bg-terra-pale/30"
                  : "border-sand/30 bg-white hover:border-sand"
              }`}
            >
              <button
                onClick={() => { setOpen(open === i ? null : i); setNoteOpen(null); }}
                className="flex w-full items-center justify-between px-6 py-5 text-start"
              >
                <span className="text-base font-bold text-espresso">
                  {faq.q}
                </span>
                <span
                  className={`mr-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
                    open === i ? "rotate-45 bg-terra text-white" : "bg-cream-dark text-espresso-light"
                  }`}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </span>
              </button>
              <div
                className={`grid transition-all duration-300 ${
                  open === i ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <p className="px-6 pb-4 leading-relaxed text-espresso-light">
                    {faq.a}
                  </p>

                  {faq.note && open === i && (
                    <div className="mx-6 mb-5">
                      <button
                        onClick={() => setNoteOpen(noteOpen === i ? null : i)}
                        className="flex w-full items-center gap-2 rounded-xl bg-cream px-4 py-3 text-start text-sm font-semibold text-espresso transition-colors hover:bg-cream-dark"
                      >
                        <svg className="h-4 w-4 shrink-0 text-terra" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {faq.note.title}
                        <svg
                          className={`mr-auto h-3.5 w-3.5 shrink-0 text-espresso-light transition-transform ${noteOpen === i ? "rotate-180" : ""}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <div
                        className={`grid transition-all duration-300 ${
                          noteOpen === i ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                        }`}
                      >
                        <div className="overflow-hidden">
                          <p className="px-4 pt-3 text-sm leading-relaxed text-espresso-light">
                            {faq.note.body}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
