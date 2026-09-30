"use client";

import { useAfter } from "../hooks";
import { AppMark, ArrowForward, type AppKey } from "../marks";
import { MICRO } from "../theme";
import type { CalendarSlot, ScenarioResult } from "./scenarios";

const WEEK = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳"];
const FIRST_HOUR = 8;
const HOURS_SHOWN = 10;
const SLOT_HEIGHT = "26%";
const SLOT_GAP_PX = 3;
const MOVE_AFTER_MS = 500;
const ROWS_AFTER_MS = 150;
const ROW_STAGGER_MS = 140;
const CHART_AFTER_MS = 120;
const CHART_W = 300;
const CHART_H = 72;
const CHART_PADDING = 40;
const CARD = "rounded-[12px] bg-(--wa-card) p-3 text-(--wa-ink)";

export function ResultCard({ result }: { result: ScenarioResult }) {
  if (result.kind === "calendar") return <CalendarCard title={result.title} who={result.who} from={result.from} to={result.to} />;
  if (result.kind === "sheet") return <SheetCard file={result.file} count={result.count} rows={result.rows} total={result.total} />;
  return <PriceCard route={result.route} current={result.current} target={result.target} history={result.history} />;
}

function CardHeader({ app, label, status }: { app: AppKey; label: string; status: string }) {
  return (
    <div className="flex items-center gap-2">
      <AppMark app={app} className="h-[18px] w-[18px]" />
      <span className={`${MICRO} min-w-0 flex-1 truncate font-semibold text-(--wa-ink-2)`}>{label}</span>
      <span className={`${MICRO} rounded-full bg-sage-pale px-2 py-0.5 font-bold text-sage-dark`}>{status}</span>
    </div>
  );
}

function slotStyle(slot: CalendarSlot) {
  return {
    insetInlineStart: `calc(${(slot.day / WEEK.length) * 100}% + ${SLOT_GAP_PX}px)`,
    top: `${((slot.hour - FIRST_HOUR) / HOURS_SHOWN) * 100}%`,
    width: `calc(${100 / WEEK.length}% - ${SLOT_GAP_PX * 2}px)`,
    height: SLOT_HEIGHT,
  };
}

function CalendarCard({ title, who, from, to }: { title: string; who: string; from: CalendarSlot; to: CalendarSlot }) {
  const moved = useAfter(MOVE_AFTER_MS);
  return (
    <div className={CARD}>
      <CardHeader app="calendar" label="יומן Google" status="עודכן" />
      <div className={`${MICRO} mt-3 grid grid-cols-5 text-center font-semibold text-(--wa-ink-2)`}>
        {WEEK.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="relative mt-1 h-[76px] overflow-hidden rounded-[12px] bg-(--wa-card-surface) ring-1 ring-(--wa-line)">
        <div className="absolute inset-0 grid grid-cols-5">
          {WEEK.map((day) => (
            <span key={day} className="border-s border-(--wa-line) first:border-s-0" />
          ))}
        </div>
        <span className={`absolute rounded-md border border-dashed border-terra/60 transition-opacity duration-500 ${moved ? "opacity-100" : "opacity-0"}`} style={slotStyle(from)} />
        <span
          className={`${MICRO} absolute flex items-center justify-center rounded-md bg-terra-strong font-bold text-white transition-all duration-700 ease-(--ease-out)`}
          style={slotStyle(moved ? to : from)}
        >
          {who}
        </span>
      </div>
      <p className="mt-2.5 text-[15px] font-bold">{title}</p>
      <p className={`${MICRO} mt-0.5 flex flex-wrap items-center gap-1.5`}>
        <s className="text-(--wa-ink-2)">{from.label}</s>
        <ArrowForward className="h-3.5 w-3.5 text-terra-strong" />
        <span className="font-bold text-terra-strong">{to.label}</span>
      </p>
    </div>
  );
}

function SheetCard({ file, count, rows, total }: { file: string; count: number; rows: ReadonlyArray<readonly [string, string, string]>; total: string }) {
  const shown = useAfter(ROWS_AFTER_MS);
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-(--wa-card-surface) ring-1 ring-(--wa-line)">
          <AppMark app="sheets" className="h-5 w-5" />
        </span>
        <span className="flex min-w-0 flex-col">
          <bdi dir="ltr" className="text-[15px] font-semibold">{file}</bdi>
          <span className={`${MICRO} text-(--wa-ink-2)`}>{count} שורות · XLSX</span>
        </span>
      </div>
      <div className="mt-3 overflow-hidden rounded-[12px] bg-(--wa-card-surface) ring-1 ring-(--wa-line)">
        <table className={`${MICRO} w-full`}>
          <thead className="bg-(--wa-card) text-(--wa-ink-2)">
            <tr>
              <th className="px-2.5 py-1.5 text-start font-semibold">ספק</th>
              <th className="px-2.5 py-1.5 text-start font-semibold">תאריך</th>
              <th className="px-2.5 py-1.5 text-end font-semibold">סכום</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([vendor, date, amount], i) => (
              <tr
                key={vendor}
                style={{ transitionDelay: `${i * ROW_STAGGER_MS}ms` }}
                className={`border-t border-(--wa-line) transition duration-500 ease-(--ease-out) ${shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}
              >
                <td className="px-2.5 py-1.5">{vendor}</td>
                <td className="tabular-nums px-2.5 py-1.5">{date}</td>
                <td className="tabular-nums px-2.5 py-1.5 text-end">{amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={`${MICRO} mt-2 flex items-center justify-between`}>
        <span className="text-(--wa-ink-2)">ועוד {count - rows.length} שורות</span>
        <span className="tabular-nums font-bold">סה״כ {total}</span>
      </div>
    </div>
  );
}

function PriceCard({ route, current, target, history }: { route: string; current: number; target: number; history: readonly number[] }) {
  const drawn = useAfter(CHART_AFTER_MS);
  const min = Math.min(target, ...history) - CHART_PADDING;
  const max = Math.max(...history) + CHART_PADDING;
  const y = (v: number) => CHART_H - ((v - min) / (max - min)) * CHART_H;
  const x = (i: number) => (i / (history.length - 1)) * CHART_W;
  const points = history.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = history.length - 1;
  return (
    <div className={CARD}>
      <CardHeader app="flights" label={route} status="במעקב" />
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className="tabular-nums text-[28px] font-extrabold leading-none">{current.toLocaleString("he-IL")} ₪</span>
        <span className={`${MICRO} text-(--wa-ink-2)`}>יעד {target.toLocaleString("he-IL")} ₪</span>
      </div>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="mt-2 h-[72px] w-full overflow-visible" aria-hidden="true">
        <line x1="0" x2={CHART_W} y1={y(target)} y2={y(target)} stroke="var(--color-sage)" strokeWidth="1.5" strokeDasharray="5 5" />
        <polyline
          points={points}
          pathLength={1}
          fill="none"
          stroke="var(--color-terra-strong)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="1"
          strokeDashoffset={drawn ? 0 : 1}
          className="transition-[stroke-dashoffset] duration-[1400ms] ease-out"
        />
        <circle cx={x(last)} cy={y(history[last])} r="4.5" fill="var(--color-terra-strong)" className={`transition-opacity delay-[1200ms] duration-300 ${drawn ? "opacity-100" : "opacity-0"}`} />
      </svg>
    </div>
  );
}
