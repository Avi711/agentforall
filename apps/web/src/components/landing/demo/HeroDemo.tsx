"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Spinner } from "@/app/app/Marks";
import { useReducedMotion } from "@/components/motion";
import { FRAME_MS } from "../hooks";
import { AppMark, DoneMark, PlaybackButton, type Playback } from "../marks";
import { FOCUS, MICRO, SMALL } from "../theme";
import { ChatHeader, Composer, DayChip, InBubble, OutBubble, Phone, StatusBar } from "../whatsapp";
import { ResultCard } from "./ResultCard";
import { SCENARIOS, type AgentAction, type Scenario } from "./scenarios";

const T = { typeStart: 500, typeMs: 1300, sent: 2050, work: 2550, step: 850, collapse: 300, reply: 650, result: 450, settle: 2200 } as const;
const MAX_FRAME_GAP_MS = 100;
const SETTLED = Number.POSITIVE_INFINITY;
const START_THRESHOLD = 0.5;

interface Run {
  id: number;
  index: number;
}

function timeline(scenario: Scenario) {
  const workDone = T.work + scenario.actions.length * T.step;
  const replyAt = workDone + T.reply;
  const resultAt = replyAt + T.result;
  return { workDone, collapseAt: workDone + T.collapse, replyAt, resultAt, end: resultAt + T.settle };
}

function useDemoPlayer(still: boolean, region: RefObject<HTMLElement | null>) {
  const [runs, setRuns] = useState<readonly Run[]>([{ id: 0, index: 0 }]);
  const [time, setTime] = useState(SETTLED);
  const [paused, setPaused] = useState(false);
  const elapsed = useRef(0);
  const started = useRef(false);
  const current = runs[runs.length - 1];
  const { end } = timeline(SCENARIOS[current.index]);
  const clamped = Math.min(time, end);
  const done = still || clamped >= end;
  const running = !done && !paused;

  const startRun = useCallback((pick: (last: Run) => number) => {
    started.current = true;
    elapsed.current = 0;
    setTime(0);
    setPaused(false);
    setRuns((prev) => {
      const last = prev[prev.length - 1];
      return [last, { id: last.id + 1, index: pick(last) }];
    });
  }, []);

  useEffect(() => {
    const el = region.current;
    if (!el || still) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        if (!started.current) startRun((last) => (last.index + 1) % SCENARIOS.length);
      },
      { threshold: START_THRESHOLD },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [still, region, startRun]);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = 0;
    let shown = -1;
    const tick = (now: number) => {
      if (last) elapsed.current += Math.min(now - last, MAX_FRAME_GAP_MS);
      last = now;
      const next = Math.floor(elapsed.current / FRAME_MS) * FRAME_MS;
      if (next !== shown) {
        shown = next;
        setTime(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  const playback: Playback = done ? "done" : paused ? "paused" : "playing";
  const toggle = () => {
    if (playback === "done") startRun((last) => last.index);
    else setPaused((p) => !p);
  };

  return {
    current,
    previous: runs.length > 1 ? runs[0] : null,
    time: still ? end : clamped,
    progress: done ? 1 : clamped / end,
    playback,
    play: (index: number) => startRun(() => index),
    toggle,
  };
}

export function HeroDemo() {
  const region = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  const { current, previous, time, progress, playback, play, toggle } = useDemoPlayer(still, region);
  const scenario = SCENARIOS[current.index];
  const { workDone } = timeline(scenario);
  const typed = Math.round(Math.min(1, Math.max(0, (time - T.typeStart) / T.typeMs)) * scenario.request.length);
  const sent = time >= T.sent;
  const working = time >= T.work && time < workDone;
  const status = working ? "עובד על זה…" : time >= T.sent && time < T.work ? "מקליד…" : "מחובר";

  return (
    <div ref={region} role="region" aria-label="הדגמה: כך הסוכן עובד" className="mx-auto w-full max-w-[400px]">
      <p className="sr-only">{`דוגמה: ${scenario.request}. הסוכן עונה: ${scenario.reply}`}</p>

      <Phone className="h-[640px]">
        <div aria-hidden="true" className="flex h-full flex-col">
          <StatusBar dark />
          <ChatHeader status={status} />
          <div className="wa-wallpaper flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-2.5 pb-2 [mask-image:linear-gradient(to_bottom,transparent,#000_32px)]">
            <div className="flex flex-col gap-1.5 pt-8">
              <DayChip />
              {previous ? <Exchange key={previous.id} scenario={SCENARIOS[previous.index]} time={SETTLED} animate={false} /> : null}
              <Exchange key={current.id} scenario={scenario} time={time} animate={!still} />
            </div>
          </div>
          <Composer text={sent ? "" : scenario.request.slice(0, typed)} />
        </div>
      </Phone>

      <div className="mt-5">
        <p id="demo-choices" className={`${SMALL} font-semibold text-(--ink)`}>
          נסו בקשה אחרת:
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div role="group" aria-labelledby="demo-choices" className="grid min-w-0 flex-1 grid-cols-3 gap-2">
            {SCENARIOS.map((s, i) => (
              <Chip key={s.id} active={i === current.index} fill={i === current.index ? progress : 0} onClick={() => play(i)}>
                {s.tab}
              </Chip>
            ))}
          </div>
          {still ? null : <PlaybackButton playback={playback} onClick={toggle} />}
        </div>
      </div>
    </div>
  );
}

function Exchange({ scenario, time, animate }: { scenario: Scenario; time: number; animate: boolean }) {
  const { collapseAt, replyAt, resultAt } = timeline(scenario);
  return (
    <>
      {time >= T.sent ? (
        <Item animate={animate}>
          <OutBubble time="09:41">{scenario.request}</OutBubble>
        </Item>
      ) : null}
      {time >= T.work ? (
        <Item animate={animate}>
          <WorkBubble actions={scenario.actions} time={time} collapsed={time >= collapseAt} />
        </Item>
      ) : null}
      {time >= replyAt ? (
        <Item animate={animate}>
          <InBubble time="09:42">{scenario.reply}</InBubble>
        </Item>
      ) : null}
      {time >= resultAt ? (
        <Item animate={animate}>
          <InBubble className="w-[86%] p-1.5">
            <ResultCard result={scenario.result} />
          </InBubble>
        </Item>
      ) : null}
    </>
  );
}

function Item({ animate, children }: { animate: boolean; children: ReactNode }) {
  return <div className={`flex flex-col ${animate ? "appear" : ""}`}>{children}</div>;
}

function WorkBubble({ actions, time, collapsed }: { actions: readonly AgentAction[]; time: number; collapsed: boolean }) {
  return (
    <InBubble className="w-[86%] py-2">
      <p className={`${MICRO} flex items-center gap-1.5 font-semibold text-(--wa-ink-2)`}>
        {collapsed ? <DoneMark className="h-4 w-4" /> : <Spinner className="h-3.5 w-3.5 text-terra-strong" />}
        {collapsed ? `בוצע · ${actions.length} פעולות` : "עובד על זה"}
      </p>
      <div className="disclosure" data-open={collapsed ? undefined : ""}>
        <div>
          <ol className="space-y-1.5 pt-2">
            {actions.map((action, i) => {
              const start = T.work + i * T.step;
              if (time < start) return null;
              const done = time >= start + T.step;
              return (
                <li key={action.label} className={`${MICRO} flex items-center gap-2`}>
                  <AppMark app={action.app} className="h-4 w-4" />
                  <span className={`min-w-0 ${done ? "text-(--wa-ink)" : "text-(--wa-ink-2)"}`}>{action.label}</span>
                  <span className="ms-auto shrink-0">{done ? <DoneMark className="h-4 w-4" /> : <Spinner className="h-3.5 w-3.5 text-(--wa-ink-2)" />}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </InBubble>
  );
}

function Chip({ active, fill, onClick, children }: { active: boolean; fill: number; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${MICRO} relative min-h-11 overflow-hidden rounded-[12px] border px-2 py-2 text-center font-semibold transition-colors sm:text-[14px] ${FOCUS} ${
        active ? "border-terra-strong bg-(--accent-soft) text-(--accent-ink)" : "border-(--line-2) bg-(--surface) text-(--ink) hover:border-(--ink)/50"
      }`}
    >
      {children}
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-terra/15">
        <span className="block h-full origin-right bg-terra-strong" style={{ transform: `scaleX(${fill})` }} />
      </span>
    </button>
  );
}
