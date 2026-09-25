"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./motion";

const AGENT_NAME = "יובל";

const STEPS = [
  { title: "נרשמים עם גוגל או במייל ונותנים לסוכן שם", body: "בלי כרטיס אשראי. שם אחד, וזהו." },
  { title: "תוך דקה הוא רץ על שרת פרטי משלכם", body: "אנחנו מקימים אותו. אתם לא מתקינים כלום." },
  { title: "מחברים טלגרם או וואטסאפ ושולחים הודעה", body: "בטלגרם זה שתי לחיצות, בוואטסאפ סורקים קוד. ומכאן כותבים לו כמו לחבר." },
] as const;

// Motion is opt-in via the `motion-on:` and `stack:` variants (globals.css); without them every card renders finished, in flow.
const CARD =
  "flex flex-col gap-4 sm:gap-5 rounded-[24px] sm:rounded-[28px] border border-sand-light bg-white p-5 sm:p-8 shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)]";
const LABEL = "text-[11px] uppercase tracking-[0.22em] text-espresso-light/70";
const PILL = "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide";
const PILL_BUSY = "bg-cream-dark/70 text-espresso-light border-sand-light";
const PILL_LIVE = "bg-sage-pale/70 text-sage-dark border-sage-light/40";
const STAGE_TOP = 200;

type Select = (sel: string) => HTMLElement[];


export function HowItWorks() {
  const root = useRef<HTMLElement>(null);

  // Phones stack the cards under a sticky title when the stack fits the screen; measured, never assumed.
  useEffect(() => {
    const el = root.current;
    const header = el?.querySelector<HTMLElement>("[data-header]");
    const cards = el ? Array.from(el.querySelectorAll<HTMLElement>("[data-step]")) : [];
    const nav = document.querySelector<HTMLElement>("[data-site-nav]");
    if (!el || !header || cards.length === 0) return;
    const measure = () => {
      const navH = nav?.offsetHeight ?? 0;
      const headerH = header.offsetHeight;
      // Cards take their min-height from this variable, so clear it before reading their natural height.
      el.style.setProperty("--how-card", "0px");
      const cardH = Math.max(...cards.map((c) => c.offsetHeight));
      el.style.setProperty("--how-nav", `${navH}px`);
      el.style.setProperty("--how-header", `${headerH}px`);
      el.style.setProperty("--how-card", `${cardH}px`);
      const fits = navH + headerH + cardH + 24 * cards.length <= window.innerHeight;
      if (fits) el.dataset.stack = "";
      else delete el.dataset.stack;
    };
    measure();
    document.fonts?.ready.then(measure);
    const ro = new ResizeObserver(measure);
    [header, nav, ...cards].forEach((node) => node && ro.observe(node));
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let unbind: (() => void) | null = null;
    let cancelled = false;

    const bind = async () => {
      if (prefersReducedMotion() || unbind) return;
      el.dataset.motion = "on";
      try {
        // GSAP is only needed once the page is interactive, so it stays off the critical path.
        const [{ gsap }, { ScrollTrigger }] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger")]);
        if (cancelled || prefersReducedMotion() || unbind) { if (!unbind) delete el.dataset.motion; return; }
        gsap.registerPlugin(ScrollTrigger);
        const q = gsap.utils.selector(el);
        const within = (scope: string): Select => (sel) => q<HTMLElement>(`${scope} ${sel}`);
        const steps = q<HTMLElement>("[data-step]");
        const list = q<HTMLElement>("[data-steps]")[0];
        const setStep = (i: number) => steps.forEach((s, j) => { s.style.opacity = i === j ? "1" : "0.35"; });
        const quiet = { immediateRender: false };

        // The three beats, each written against one card and padded to its span so every card scrubs alike.
        const typeName = (at: Select, start: number, span: number) => {
          const typed = at("[data-typed]")[0];
          const hint = at("[data-hint]")[0];
          const typing = { n: 0 };
          return gsap.timeline().to(typing, {
            n: AGENT_NAME.length,
            ease: "none",
            duration: span * 0.4,
            onUpdate: () => {
              if (typed) typed.textContent = AGENT_NAME.slice(0, Math.round(typing.n));
              if (hint) hint.style.display = typing.n > 0 ? "none" : "";
            },
          }, start + span * 0.2).set({}, {}, start + span);
        };
        const bootServer = (at: Select, start: number, span: number) =>
          gsap.timeline()
            .fromTo(at("[data-progress]"), { width: "0%" }, { width: "100%", ease: "none", ...quiet, duration: span * 0.5 }, start + span * 0.3)
            .fromTo(at("[data-tick]"), { opacity: 0 }, { opacity: 1, stagger: span * 0.15, ...quiet, duration: span * 0.08 }, start + span * 0.4)
            .fromTo(at("[data-pill-busy]"), { opacity: 1 }, { opacity: 0, ...quiet, duration: span * 0.08 }, start + span * 0.82)
            .fromTo(at("[data-pill-live]"), { opacity: 0 }, { opacity: 1, ...quiet, duration: span * 0.08 }, start + span * 0.82)
            .set({}, {}, start + span);
        const firstChat = (at: Select, start: number, span: number) =>
          gsap.timeline()
            .fromTo(at("[data-msg='0']"), { opacity: 0 }, { opacity: 1, ...quiet, duration: span * 0.12 }, start + span * 0.35)
            .fromTo(at("[data-msg='1']"), { opacity: 0 }, { opacity: 1, ...quiet, duration: span * 0.12 }, start + span * 0.55)
            .set({}, {}, start + span);
        const beats = [typeName, bootServer, firstChat];

        const mm = gsap.matchMedia();

        // Desktop: one stage beside the text, one scrubbed timeline over the whole list; it ends where the stage releases.
        mm.add("(min-width: 1024px)", () => {
          const stage = within("[data-stage]");
          const share = steps.map((s) => s.offsetHeight / list.offsetHeight);
          const at = (i: number) => share.slice(0, i).reduce((a, b) => a + b, 0) * 10;
          const span = (i: number) => share[i]! * 10;
          const swap = (from: number, to: number, start: number, len: number) =>
            gsap.timeline()
              .fromTo(stage(`[data-panel='${from}']`), { opacity: 1, y: 0, scale: 1 }, { opacity: 0, y: -30, scale: 0.96, ease: "power2.in", ...quiet, duration: len * 0.15 }, start)
              .fromTo(stage(`[data-panel='${to}']`), { opacity: 0, y: 30, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, ease: "power2.out", ...quiet, duration: len * 0.2 }, start + len * 0.08);
          const tl = gsap.timeline({ paused: true })
            .add(typeName(stage, at(0), span(0)), 0)
            .add(swap(0, 1, at(1), span(1)), 0)
            .add(bootServer(stage, at(1), span(1)), 0)
            .add(swap(1, 2, at(2), span(2)), 0)
            .add(firstChat(stage, at(2), span(2)), 0);
          setStep(0);
          const trigger = ScrollTrigger.create({
            trigger: list,
            start: "top 55%",
            end: `bottom center+=${STAGE_TOP}px`,
            scrub: 0.6,
            animation: tl,
            onUpdate: () => {
              const y = window.innerHeight * 0.55;
              setStep(steps.reduce((acc, s, i) => (s.getBoundingClientRect().top <= y ? i : acc), 0));
            },
          });
          return () => {
            trigger.kill();
            tl.kill();
            steps.forEach((s) => { s.style.opacity = ""; });
          };
        });

        // Phones: each card sits under its own text and fills in as it rises through the viewport.
        mm.add("(max-width: 1023px)", () => {
          const cards = q<HTMLElement>("[data-card]");
          const tls = cards.map((card, i) => gsap.timeline({ paused: true }).add(beats[i]!(within(`[data-card='${i}']`), 0, 10), 0));
          const triggers = cards.map((card, i) =>
            ScrollTrigger.create({ trigger: card, start: "top 90%", end: "center 45%", scrub: 0.5, animation: tls[i]! }),
          );
          return () => {
            triggers.forEach((t) => t.kill());
            tls.forEach((t) => t.kill());
          };
        });

        unbind = () => {
          mm.revert();
          delete el.dataset.motion;
          unbind = null;
        };
      } catch (err: unknown) {
        // Motion is optional: a failed chunk load leaves the finished cards in place.
        delete el.dataset.motion;
        console.error("how-it-works motion failed to start", err);
      }
    };

    void bind();
    // The site's own accessibility toggle flips the attribute at runtime; follow it both ways.
    const watcher = new MutationObserver(() => { if (prefersReducedMotion()) unbind?.(); else void bind(); });
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduced-motion"] });

    return () => {
      cancelled = true;
      watcher.disconnect();
      unbind?.();
    };
  }, []);

  const panels = [<SignInPanel key="sign-in" />, <ServerPanel key="server" />, <ChannelsPanel key="channels" />];

  return (
    <section ref={root} id="how-it-works" aria-labelledby="how-it-works-title" className="py-16 sm:py-24 lg:pt-0 lg:pb-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 max-lg:relative lg:grid lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:gap-x-20">
        {/* On phones the title pins inside an overlay that ends one card (plus its two 24px margins) early, so it leaves with the cards. */}
        <div
          className={`stack:max-lg:absolute stack:max-lg:inset-x-0 stack:max-lg:top-0 lg:contents`}
          style={{ bottom: "calc(var(--how-card, 480px) + 48px)" }}
        >
          <header
            data-header
            className={`max-lg:px-4 max-lg:pb-5 sm:max-lg:px-6 stack:max-lg:sticky stack:max-lg:top-[var(--how-nav,73px)] stack:max-lg:z-20 stack:max-lg:bg-cream lg:col-start-1 lg:row-start-1 lg:pt-24`}
          >
            <p className="text-xs uppercase tracking-[0.22em] text-espresso-light/80 mb-3">איך זה עובד</p>
            <h2 id="how-it-works-title" className="font-display text-3xl sm:text-4xl text-espresso leading-tight">
              מאפס לעוזר אישי משלכם, תוך דקות
            </h2>
          </header>
        </div>

        <div className="hidden lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block lg:self-start motion-on:lg:sticky motion-on:lg:top-0 motion-on:lg:pt-[calc(50vh_-_200px)]">
          <div data-stage aria-hidden className={`pointer-events-none relative mx-auto flex w-[440px] select-none flex-col gap-4 motion-on:h-[400px] motion-on:block`}>
            {panels.map((panel, i) => (
              <div
                key={i}
                data-panel={i}
                className={`${CARD} motion-on:absolute motion-on:inset-0 ${i === 0 ? "" : `motion-on:opacity-0 motion-on:translate-y-8 motion-on:scale-[0.96]`}`}
              >
                {panel}
              </div>
            ))}
          </div>
        </div>

        <ol data-steps className={`flex flex-col lg:col-start-1 lg:row-start-2 stack:max-lg:pt-[var(--how-header,130px)]`}>
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              data-step
              style={{ top: `calc(var(--how-nav, 73px) + var(--how-header, 130px) + ${i * 12}px)`, zIndex: i + 1 }}
              className={`flex flex-col justify-center transition-opacity duration-300 max-lg:mb-6 max-lg:rounded-[24px] max-lg:border max-lg:border-sand-light max-lg:bg-white max-lg:p-5 max-lg:shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] stack:max-lg:sticky ${
                // Taller earlier cards make every card's bottom line up, so the stack releases as one.
                ["stack:max-lg:min-h-[calc(var(--how-card)+24px)]", "stack:max-lg:min-h-[calc(var(--how-card)+12px)]", "stack:max-lg:min-h-[var(--how-card)]"][i]
              } ${i === STEPS.length - 1 ? "motion-on:lg:min-h-[60vh]" : "motion-on:lg:min-h-screen"}`}
            >
              <span className="text-xs uppercase tracking-[0.18em] text-espresso-light">שלב {i + 1}</span>
              <h3 className="font-display text-2xl sm:text-[28px] text-espresso leading-snug mt-2">{step.title}</h3>
              <p className="mt-3 max-w-md text-base leading-relaxed text-espresso-light">{step.body}</p>
              <div data-card={i} aria-hidden className="pointer-events-none mt-5 flex select-none flex-col gap-4 border-t border-sand-light/70 pt-5 lg:hidden">
                {panels[i]}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function SignInPanel() {
  return (
    <>
      <span className={LABEL}>התחלה</span>
      <p className="font-display text-xl sm:text-2xl text-espresso">בואו ניצור לכם סוכן</p>
      <div className="flex items-center justify-center gap-2.5 rounded-xl border border-sand bg-white px-3 py-2.5 sm:py-3 text-[15px] font-medium">
        <GoogleMark />
        כניסה עם Google
      </div>
      <div>
        <p className={`${LABEL} mb-2`}>איך הסוכן שלכם ייקרא?</p>
        <div className="flex min-h-11 sm:min-h-12 items-center rounded-xl border border-sand bg-white px-3.5 text-[15px] text-espresso">
          <span className={`motion-on:hidden`}>{AGENT_NAME}</span>
          <span data-typed className={`hidden motion-on:inline`} />
          <span className={`ms-0.5 hidden h-[18px] w-px bg-espresso motion-on:inline-block`} />
          <span data-hint className={`hidden text-espresso-light/60 motion-on:inline`}>&nbsp;לדוגמה: ג׳ארוויס, שלומי, אלפרד</span>
        </div>
      </div>
      <div className="rounded-xl bg-terra px-4 py-2.5 sm:py-3 text-center text-[15px] font-medium text-white">יצירת סוכן</div>
    </>
  );
}

function ServerPanel() {
  return (
    <>
      <span className={LABEL}>הסוכן שלי</span>
      <div className="flex items-center gap-3.5">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-terra-light to-terra font-display text-2xl text-white">
          {AGENT_NAME.charAt(0)}
        </span>
        <div>
          <p className="font-display text-xl sm:text-2xl text-espresso">{AGENT_NAME}</p>
          <span className="relative inline-flex">
            <span data-pill-busy className={`${PILL} ${PILL_BUSY} opacity-0 motion-on:opacity-100`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              מכין את הסוכן…
            </span>
            <span data-pill-live className={`${PILL} ${PILL_LIVE} absolute inset-y-0 end-0 motion-on:opacity-0`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              פעיל
            </span>
          </span>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-cream-dark">
        <div data-progress className={`h-full w-full rounded-full bg-sage motion-on:w-0`} />
      </div>
      <div className="flex flex-col">
        {["שרת פרטי", "זיכרון ותזכורות", "הגדרות בעברית"].map((row) => (
          <div key={row} className="flex items-center justify-between border-t border-sand-light/70 py-2.5 sm:py-3 text-sm">
            <span>{row}</span>
            <span data-tick className={`text-xs text-sage-dark motion-on:opacity-0`}>✓</span>
          </div>
        ))}
      </div>
    </>
  );
}

function ChannelsPanel() {
  return (
    <>
      <span className={LABEL}>ערוצים</span>
      <p className="font-display text-xl sm:text-2xl text-espresso">איפה נדבר?</p>
      <div className="flex gap-2.5">
        <span className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-[1.5px] border-terra bg-terra/5 px-3 py-3 sm:py-3.5 text-[15px] font-medium">
          <TelegramMark />
          טלגרם
        </span>
        <span className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-[1.5px] border-sand-light px-3 py-3 sm:py-3.5 text-[15px] font-medium">
          <WhatsAppMark />
          וואטסאפ
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <div data-msg="0" className={`self-start rounded-2xl rounded-ss-md bg-[#DCF8C6] px-3 py-2 text-[13px] leading-relaxed motion-on:opacity-0`}>היי {AGENT_NAME}, מה יש לי מחר?</div>
        <div data-msg="1" className={`self-end rounded-2xl rounded-se-md bg-cream-dark px-3 py-2 text-[13px] leading-relaxed motion-on:opacity-0`}>
          היי! מחר יש לך 2 פגישות. הראשונה ב-9:30 עם רו״ח. רוצה שאזכיר לך שעה לפני?
        </div>
      </div>
    </>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4H24v7.6h12.7c-.3 2.2-1.7 5.4-4.9 7.6l7.6 5.9c4.5-4.2 7.1-10.3 7.1-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2 1.4-4.7 2.4-8.3 2.4-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function TelegramMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#229ED9" aria-hidden>
      <path d="M21.9 3.4 2.9 10.7c-1 .4-1 1 .1 1.3l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.5 0 .7-.2 1-.5l2.4-2.3 4.9 3.6c.9.5 1.5.2 1.8-.8L23 4.6c.3-1.3-.5-1.8-1.1-1.2z" />
    </svg>
  );
}

function WhatsAppMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12z" />
    </svg>
  );
}
