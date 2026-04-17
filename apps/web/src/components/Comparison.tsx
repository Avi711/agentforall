"use client";

import { useState, useEffect, useRef } from "react";

const rows = [
  {
    label: "מחיר לחודש",
    chatgpt: "~80 ש״ח",
    agent: "מ-199 ש״ח",
    highlight: false,
    agentNote: true,
  },
  {
    label: '"חי" איפה?',
    chatgpt: "לא קיים בלי שתפתחו",
    agent: "שרת פרטי רץ 24/7",
    highlight: true,
  },
  {
    label: "איפה הוא נמצא",
    chatgpt: "אתר / אפליקציה",
    agent: "וואטסאפ שלכם",
    highlight: false,
  },
  {
    label: "מי מתחיל את השיחה",
    chatgpt: "אתם תמיד",
    agent: "הוא מגיע אליכם",
    highlight: true,
  },
  {
    label: "פועל כשאתם ישנים",
    chatgpt: false,
    agent: true,
    highlight: false,
  },
  {
    label: "כלים ויכולות",
    chatgpt: "שיחה בלבד",
    agent: "גולש, שולח, מזמין, מתזכר, עוקב...",
    highlight: true,
  },
  {
    label: "זיכרון",
    chatgpt: "שומר, אבל לא לומד",
    agent: "מתפתח — מכיר אתכם יותר כל יום",
    highlight: false,
  },
  {
    label: "הקמה",
    chatgpt: "לבד",
    agent: "בכמה קלילים",
    highlight: false,
  },
];

function Cell({
  value,
  isAgent,
}: {
  value: string | boolean;
  isAgent: boolean;
}) {
  if (typeof value === "boolean") {
    return (
      <span
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-base font-bold transition-all ${
          value
            ? "bg-sage/20 text-sage"
            : "bg-espresso/6 text-espresso-light/30"
        }`}
      >
        {value ? "✓" : "✕"}
      </span>
    );
  }
  return (
    <span
      className={`text-[13px] leading-snug sm:text-sm ${
        isAgent
          ? "font-semibold text-espresso"
          : "font-normal text-espresso-light/60"
      }`}
    >
      {value}
    </span>
  );
}

export function Comparison() {
  const [isMobile, setIsMobile] = useState(true);
  const [isSticky, setIsSticky] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (containerRef.current) {
            // Only trigger sticky logic if we are genuinely on mobile view (sm matches 640px)
            if (window.innerWidth < 640) {
              setIsSticky(containerRef.current.getBoundingClientRect().top <= 75);
            } else {
              setIsSticky(false);
            }
          }
          ticking = false;
        });
        ticking = true;
      }
    };
    
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      handleScroll();
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize, { passive: true });
    
    // Initial evaluation
    handleResize();
    
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <section id="comparison" className="px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-4xl relative">
        {/* Heading */}
        <div className="mb-12 text-center">
          <p className="mb-3 text-sm font-bold uppercase tracking-widest text-terra">
            למה לא פשוט ChatGPT?
          </p>
          <h2 className="font-display text-4xl font-black leading-[1.05] tracking-tight text-espresso sm:text-5xl">
            ChatGPT הוא כלי.
            <br />
            <span className="text-terra">זה סוכן.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg font-light leading-relaxed text-espresso-light">
            ChatGPT מחכה שתפתחו אותו. הסוכן שלכם חי על שרת פרטי, פועל 24/7,
            ומגיע אליכם — גם כשאתם לא מחשבים בכלל על AI.
          </p>
        </div>

        {/* Table Container - We track this unmoving wrapper to prevent jitter */}
        <div ref={containerRef} className="relative rounded-3xl border border-sand/40 bg-white shadow-xl shadow-espresso/5">
          
          {/* Header — Edge-to-edge frosted glass on scroll. Does NOT mutate structural margins to prevent table jitter! */}
          <div
            className={`sticky sm:static top-[72px] z-30 transition-all duration-300 ease-out sm:grid-cols-[1fr_1fr_1fr] overflow-hidden rounded-t-3xl border-b ${
              isSticky
                ? "shadow-2xl shadow-espresso/15 bg-cream/80 backdrop-blur-xl border-sand/10"
                : "bg-cream/60 shadow-none border-sand/30"
            }`}
          >
            <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr]">
              {/* Empty label col — desktop only */}
              <div className="hidden sm:block sm:px-7 sm:py-4" />

              {/* Agent col — RIGHT in RTL (first child in RTL grid = right side) */}
              <div className="relative order-first px-4 py-4 text-center sm:order-none sm:px-7">
                <div
                  className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-terra/60 via-terra to-terra/60 transition-all duration-500 opacity-100"
                />
                <span className={`text-sm font-bold transition-colors duration-500 ${isSticky ? "text-terra drop-shadow-sm" : "text-terra"}`}>
                  הסוכן שלכם
                </span>
              </div>

              {/* ChatGPT col — LEFT in RTL */}
              <div className="border-r border-sand/30 px-4 py-4 text-center sm:order-none sm:border-r-0 sm:border-l sm:px-7">
                <span className="text-sm font-bold text-espresso-light/50">
                  ChatGPT Plus
                </span>
              </div>
            </div>
          </div>

          {/* Rows List */}
          <div className="flex flex-col rounded-b-3xl bg-white relative z-0">
            {rows.map((row, i) => (
              <div
                key={i}
                className={`border-b border-sand/20 ${i === rows.length - 1 ? 'border-0 rounded-b-3xl' : ''} transition-colors ${
                  row.highlight ? "bg-terra-pale/15 hover:bg-terra-pale/25" : "hover:bg-cream/20"
                }`}
              >
                {/* RTL Table implementation matching previous structure */}
                <div className="border-b border-sand/10 bg-cream/40 px-4 py-2 text-center sm:hidden">
                  <span className="text-xs font-bold uppercase tracking-wide text-espresso/50">
                    {row.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr]">
                  <div className="hidden items-center px-7 py-4 sm:flex">
                    <span className="text-[15px] font-medium text-espresso">
                      {row.label}
                    </span>
                  </div>

                  <div className="order-first flex items-center justify-center bg-terra-pale/10 px-3 py-3.5 text-center sm:order-none sm:px-6 sm:py-4">
                    <Cell value={row.agent} isAgent={true} />
                    {row.agentNote && (
                      <span className="mr-1 text-[11px] text-espresso-light/40">*</span>
                    )}
                  </div>

                  <div className="flex items-center justify-center border-r border-sand/20 px-3 py-3.5 text-center sm:order-none sm:border-r-0 sm:border-l sm:px-6 sm:py-4">
                    <Cell value={row.chatgpt} isAgent={false} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Note */}
        <p className="mt-4 text-center text-xs text-espresso-light/50">
          * המחיר כולל שרת פרטי מאובטח, מספר וואטסאפ ייעודי, והקמה מלאה.
          חיוב לפי שימוש — שיחה יומיומית רגילה יוצאת בדרך כלל בטווח הזה.
        </p>
      </div>
    </section>
  );
}
