"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useReducedMotion } from "@/components/motion";
import { featuredApp, LANDING_APPS } from "@/lib/integrations/catalog.he";
import { AGENT_NAME, APP_ACTIONS, APPS_MORE } from "./content";
import { usePlayOnce } from "./hooks";
import { ChannelBadges, PlaybackButton, type Playback } from "./marks";
import { BODY, CARD, CONTAINER, EYEBROW, FOCUS, H2, MICRO, SECTION, SMALL } from "./theme";

const PLAY_MS = 2200;
const TOUR_STEP_MS = 2400;
const ORBIT = 40;
const STAGGER = 0.07;
const HIGHLIGHT_AT = 0.8;
const PANEL_ID = "apps-panel";
const KEY_STEP: Partial<Record<string, number>> = { ArrowLeft: 1, ArrowDown: 1, ArrowRight: -1, ArrowUp: -1 };

const HUB_APPS = APP_ACTIONS.flatMap(({ slug, action }) => {
  const logo = LANDING_APPS.find((app) => app.slug === slug)?.logo;
  const name = featuredApp(slug)?.nameHe;
  return logo && name ? [{ slug, logo, name, action }] : [];
});

const round = (value: number) => Math.round(value * 1000) / 1000;

const SPOKES = HUB_APPS.map((_, i) => {
  const angle = (i / HUB_APPS.length) * 2 * Math.PI - Math.PI / 2;
  return { x: round(50 + ORBIT * Math.cos(angle)), y: round(50 + ORBIT * Math.sin(angle)) };
});

const tabId = (slug: string) => `apps-tab-${slug}`;

function useTour(ready: boolean) {
  const reduced = useReducedMotion();
  const [selected, setSelected] = useState(0);
  const [playback, setPlayback] = useState<Playback>("playing");
  const touring = ready && !reduced && playback === "playing";

  useEffect(() => {
    if (!touring) return;
    const timer = window.setTimeout(() => {
      const next = (selected + 1) % HUB_APPS.length;
      setSelected(next);
      if (next === 0) setPlayback("done");
    }, TOUR_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [touring, selected]);

  const choose = (index: number) => {
    setPlayback("done");
    setSelected(index);
  };

  const toggle = () => {
    if (playback === "done") setSelected(0);
    setPlayback(playback === "playing" ? "paused" : "playing");
  };

  return { selected, playback, showControl: !reduced, choose, toggle };
}

export function Connectors() {
  const hub = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const p = usePlayOnce(hub, PLAY_MS, 0.35);
  const highlighted = p >= HIGHLIGHT_AT;
  const { selected, playback, showControl, choose, toggle } = useTour(p >= 1);
  const target = SPOKES[selected];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = KEY_STEP[event.key];
    const next = event.key === "Home" ? 0 : event.key === "End" ? HUB_APPS.length - 1 : step === undefined ? null : (selected + step + HUB_APPS.length) % HUB_APPS.length;
    if (next === null) return;
    event.preventDefault();
    choose(next);
    tabs.current[next]?.focus();
  };

  return (
    <section id="apps" aria-labelledby="apps-title" className={`${SECTION} border-t border-(--line) bg-(--surface)`}>
      <div className={`${CONTAINER} grid gap-10 lg:grid-cols-12 lg:items-center lg:gap-12`}>
        <div className="lg:col-span-5">
          <p className={EYEBROW}>חיבורים</p>
          <h2 id="apps-title" className={`${H2} mt-3`}>
            עובד בתוך האפליקציות שכבר יש לכם.
          </h2>
          <p className={`${BODY} mt-5 max-w-[30rem] text-pretty text-(--ink-2)`}>
            מחברים אפליקציה בכמה לחיצות מתוך האזור האישי, והסוכן קורא, כותב ופועל שם בשבילכם. רק במה שחיברתם, ואפשר לנתק בכל רגע.
          </p>
          <p className={`${SMALL} mt-6 inline-flex rounded-full bg-(--surface-2) px-4 py-1.5 font-semibold text-(--ink)`}>{APPS_MORE}</p>
        </div>

        <div className="lg:col-span-7">
          <div ref={hub} role="tablist" aria-label="אפליקציות שהסוכן עובד בהן" onKeyDown={onKeyDown} className="relative mx-auto aspect-square w-full max-w-[420px]">
            <svg aria-hidden="true" viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible">
              <circle cx="50" cy="50" r={ORBIT} fill="none" stroke="var(--line-2)" strokeWidth="0.3" strokeDasharray="0.8 1.6" />
              {SPOKES.map((spoke, i) => {
                const active = highlighted && i === selected;
                return (
                  <line
                    key={HUB_APPS[i].slug}
                    x1="50"
                    y1="50"
                    x2={spoke.x}
                    y2={spoke.y}
                    pathLength={1}
                    strokeDasharray="1"
                    strokeDashoffset={p > i * STAGGER ? 0 : 1}
                    stroke={active ? "var(--color-terra-strong)" : "var(--line-2)"}
                    strokeWidth={active ? "0.7" : "0.45"}
                    className="transition-[stroke-dashoffset,stroke,stroke-width] duration-700 ease-(--ease-out)"
                  />
                );
              })}
              {highlighted ? (
                <line key={`pulse-${selected}`} x1="50" y1="50" x2={target.x} y2={target.y} pathLength={1} stroke="var(--color-terra-strong)" strokeWidth="1.4" strokeLinecap="round" className="hub-pulse" />
              ) : null}
            </svg>

            <div aria-hidden="true" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <span className="hub-core relative flex h-20 w-20 items-center justify-center rounded-[26px] bg-terra-strong font-display text-[22px] font-extrabold text-white sm:h-24 sm:w-24 sm:text-2xl">
                {AGENT_NAME}
                <span className="absolute -bottom-3">
                  <ChannelBadges />
                </span>
              </span>
              <span className={`${MICRO} absolute left-1/2 top-full mt-5 -translate-x-1/2 whitespace-nowrap rounded-full bg-(--surface) px-2 font-bold text-(--ink)`}>הסוכן שלכם</span>
            </div>

            {HUB_APPS.map((hubApp, i) => {
              const spoke = SPOKES[i];
              const shown = p > i * STAGGER;
              const current = i === selected;
              const active = highlighted && current;
              return (
                <button
                  key={hubApp.slug}
                  ref={(el) => {
                    tabs.current[i] = el;
                  }}
                  id={tabId(hubApp.slug)}
                  type="button"
                  role="tab"
                  aria-selected={current}
                  aria-controls={PANEL_ID}
                  aria-label={hubApp.name}
                  tabIndex={current ? 0 : -1}
                  onClick={() => choose(i)}
                  style={{ left: `${spoke.x}%`, top: `${spoke.y}%` }}
                  className={`absolute flex h-13 w-13 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border bg-white transition-[opacity,scale,border-color,box-shadow] duration-500 ease-(--ease-out) sm:h-15 sm:w-15 ${FOCUS} ${
                    shown ? (active ? "scale-110 opacity-100" : "scale-100 opacity-100") : "scale-75 opacity-0"
                  } ${
                    active ? "border-terra-strong shadow-(--tile-active-shadow)" : "border-(--line) shadow-(--tile-shadow) hover:border-(--line-2)"
                  }`}
                >
                  <img src={hubApp.logo} alt="" width={28} height={28} className="h-7 w-7 object-contain sm:h-8 sm:w-8" />
                </button>
              );
            })}
          </div>

          <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(HUB_APPS[selected].slug)} className={`${CARD} mx-auto mt-6 grid max-w-[420px] p-4 sm:p-5`}>
            {HUB_APPS.map((hubApp, i) => (
              <div key={hubApp.slug} className={`col-start-1 row-start-1 flex items-center gap-4 ${i === selected ? "appear" : "invisible"}`}>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-(--line) bg-white">
                  <img src={hubApp.logo} alt="" width={28} height={28} className="h-7 w-7 object-contain" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[17px] font-bold text-(--ink)">{hubApp.name}</span>
                  <span className={`${SMALL} block text-(--ink-2)`}>{hubApp.action}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="mx-auto mt-3 flex max-w-[420px] items-center justify-center gap-3">
            <p className={`${MICRO} text-(--ink-2)`}>לחצו על אפליקציה כדי לראות מה הסוכן עושה בה</p>
            {showControl ? <PlaybackButton playback={playback} onClick={toggle} /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
