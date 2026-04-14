"use client";

import { useState, useEffect, useCallback } from "react";
import useEmblaCarousel from "embla-carousel-react";

const conversations = [
  {
    user: "תזיז לי את הפגישה עם דני למחר ב-3 ותשלח לו הודעה שזז",
    agent: "הזזתי ביומן ל-15:00 מחר. שלחתי לדני: ״היי, הפגישה עברה למחר ב-3, מקווה שמתאים.״ ✅ נשלח.",
    label: "יומן וניהול פגישות",
  },
  {
    user: "כל בוקר ב-7:00 תשלח לי סיכום של מה מחכה לי היום",
    agent: "נקבע. כל בוקר ב-7:00 תקבלו בריף: פגישות, משימות פתוחות, מזג אוויר, ואם יש ימי הולדת לאנשי קשר. מתחיל מחר.",
    label: "בריף יומי אוטומטי",
  },
  {
    user: "תוריד את כל החשבוניות מהמייל של החודש האחרון ותכין לי אקסל",
    agent: "מצאתי 14 חשבוניות. הכנתי קובץ Excel עם תאריך, ספק, סכום ומע״מ. סה״כ: 8,340 ש״ח. שולח לך את הקובץ.",
    label: "חשבוניות ודוחות",
  },
  {
    user: "תבנה לי דף נחיתה פשוט לאירוע שלי בשבוע הבא",
    agent: "בניתי דף עם הפרטים מההודעה שלך — תאריך, מיקום, טופס הרשמה. הוא רץ על https://event-xyz.vercel.app. רוצה שאשנה משהו?",
    label: "בניית אתרים",
  },
  {
    user: "תשלח לכל הקבוצה הודעה שהמפגש בשישי עבר לפארק הירקון",
    agent: "שלחתי לקבוצה ״חברים שישי״: ״היי לכולם! המפגש בשישי עבר לפארק הירקון, אותה שעה. נתראה!״ ✅",
    label: "הודעות קבוצתיות",
  },
  {
    user: "תעקוב אחרי המחיר של הטיסה לברלין ב-28/4 ותגיד לי אם יורד מתחת ל-200",
    agent: "מעקב פעיל. אבדוק את המחיר פעמיים ביום ואעדכן אתכם ברגע שיורד מ-200 ש״ח. כרגע עומד על 249.",
    label: "מעקב מחירים",
  },
];

const capRow1 = [
  "שליחת הודעות ומיילים בשמכם",
  "ניהול יומן — הזזה, קביעה, ביטול",
  "אוטומציות יומיות קבועות",
  "הורדת קבצים ויצירת דוחות",
  "מעקב מחירים והתראות",
];

const capRow2 = [
  "בניית אתרים ואפליקציות",
  "ניהול תקציב והוצאות",
  "חיפוש ובדיקת עובדות",
  "תסריטים ואינטגרציות",
  "שליחת תזכורות חכמות",
];

const DURATION = 5000;

function ConversationCard({ user, agent }: { user: string; agent: string }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-sand/40 bg-[#f7f4ef] lg:rounded-3xl">
      <div className="flex flex-1 flex-col justify-center space-y-3 px-5 py-5 lg:space-y-4 lg:px-7 lg:py-9" dir="rtl">
        <div className="flex justify-end">
          <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-wa-light px-4 py-2.5 text-[14px] leading-relaxed text-espresso shadow-sm lg:px-5 lg:py-3 lg:text-[15.5px]">
            {user}
          </div>
        </div>
        <div className="flex justify-start">
          <div className="max-w-[88%] rounded-2xl rounded-tr-sm bg-white px-4 py-2.5 text-[14px] leading-relaxed text-espresso shadow-sm lg:px-5 lg:py-3 lg:text-[15.5px]">
            {agent}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Features() {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    direction: "rtl",
    align: "center",
  });

  const [activeIndex, setActiveIndex] = useState(0);
  // Key forces remount of the fill div, cleanly restarting the CSS animation
  const [animKey, setAnimKey] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setActiveIndex(emblaApi.selectedScrollSnap());
    setAnimKey((k) => k + 1);
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  // CSS animation ends → advance to next slide
  const handleAnimationEnd = useCallback(() => {
    if (!emblaApi) return;
    emblaApi.scrollNext();
  }, [emblaApi]);

  const goTo = useCallback(
    (index: number) => {
      if (!emblaApi) return;
      emblaApi.scrollTo(index);
    },
    [emblaApi],
  );

  return (
    <section id="features" className="relative py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="max-w-2xl">
          <h2 className="text-4xl font-black tracking-tight text-espresso sm:text-5xl">
            כל מה שצריך,
            <br />
            <span className="text-terra">במרחק הודעה</span>
          </h2>
          <p className="mt-4 text-lg font-light text-espresso-light">
            הסוכן שלכם יכול לעשות כמעט כל דבר. הנה כמה דוגמאות מהחיים:
          </p>
        </div>
      </div>

      {/* ── Stories carousel (mobile + desktop) ── */}
      <div className="mt-10">
        {/* Progress bars */}
        <div className="mx-auto flex max-w-6xl gap-1.5 px-5 sm:px-8">
          {conversations.map((conv, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={conv.label}
              className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-sand/40"
            >
              <div
                key={i === activeIndex ? `a-${animKey}` : `s-${i}`}
                className={i === activeIndex ? "bar-fill-active" : undefined}
                onAnimationEnd={i === activeIndex ? handleAnimationEnd : undefined}
                style={{
                  height: "100%",
                  width: "100%",
                  borderRadius: "inherit",
                  backgroundColor: "var(--color-terra)",
                  transformOrigin: "right center",
                  transform: i < activeIndex ? "scaleX(1)" : "scaleX(0)",
                  ...(i === activeIndex
                    ? { ["--bar-duration" as string]: `${DURATION}ms` }
                    : {}),
                }}
              />
            </button>
          ))}
        </div>

        {/* Label */}
        <p className="mx-auto mt-3 max-w-6xl px-5 text-sm font-bold text-terra sm:px-8">
          {conversations[activeIndex].label}
        </p>

        {/* Carousel viewport */}
        <div className="mx-auto mt-3 max-w-7xl overflow-hidden" ref={emblaRef}>
          <div className="flex items-stretch">
            {conversations.map((conv, i) => (
              <div
                key={i}
                className="min-w-0 flex-[0_0_85%] pl-4 sm:flex-[0_0_50%] lg:flex-[0_0_33.333%] lg:pl-5"
              >
                <div className="h-full">
                  <ConversationCard user={conv.user} agent={conv.agent} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Capability marquee — two rows, opposite directions */}
      <div className="mt-14 sm:mt-20">
        <p className="mb-5 text-center text-sm font-medium tracking-wide text-espresso-light/70 sm:mb-6">
          ועוד המון דברים שהסוכן יודע לעשות
        </p>
      </div>
      <div className="relative overflow-hidden py-1" dir="ltr">
        {/* Fade edges */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-cream to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-cream to-transparent" />

        {/* Row 1 — scrolls right (tripled for seamless loop) */}
        <div className="marquee-row mb-3 flex gap-3" style={{ ["--marquee-direction" as string]: "normal" }}>
          {[...capRow1, ...capRow1, ...capRow1].map((cap, i) => (
            <span
              key={`r1-${i}`}
              className="flex-shrink-0 rounded-full border border-sand/50 bg-white px-4 py-2 text-sm font-medium text-espresso-light"
            >
              {cap}
            </span>
          ))}
        </div>

        {/* Row 2 — scrolls left (tripled for seamless loop) */}
        <div className="marquee-row flex gap-3" style={{ ["--marquee-direction" as string]: "reverse" }}>
          {[...capRow2, ...capRow2, ...capRow2].map((cap, i) => (
            <span
              key={`r2-${i}`}
              className="flex-shrink-0 rounded-full border border-sand/50 bg-white px-4 py-2 text-sm font-medium text-espresso-light"
            >
              {cap}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
