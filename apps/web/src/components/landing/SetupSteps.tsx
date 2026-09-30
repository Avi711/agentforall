"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { PendingLink } from "@/app/app/Pending";
import { Spinner } from "@/app/app/Marks";
import { CheckIcon } from "@/components/blog/icons";
import { GoogleMark } from "@/components/GoogleMark";
import { WhatsAppIcon } from "@/components/WhatsAppIcon";
import { AGENT_NAME } from "./content";
import { clamp01, usePlayOnce } from "./hooks";
import { TelegramIcon } from "./marks";
import { CARD, H3, MICRO, SMALL, TEXT_LINK } from "./theme";

const PLAY_MS = 5200;
const STAGES = { signUp: [0, 0.36], server: [0.3, 0.7], channel: [0.64, 1] } as const;
const GOOGLE_AT = 0.08;
const TYPE_FROM = 0.25;
const TYPE_SPAN = 0.4;
const LIVE_AT = 0.9;
const SERVER_FILL_MS = (STAGES.server[1] - STAGES.server[0]) * PLAY_MS * LIVE_AT;
const TELEGRAM_PICKED_AT = 0.3;

const STEPS = [
  { title: "נותנים לסוכן שם", body: "נרשמים עם גוגל או במייל. בלי כרטיס אשראי." },
  { title: "תוך דקה הוא רץ", body: "בסביבה פרטית ומבודדת שאנחנו מקימים. אתם לא מתקינים כלום." },
  { title: "בוחרים איפה לדבר איתו", body: "בטלגרם זה שתי לחיצות. בוואטסאפ צריך מספר ייעודי לסוכן.", guide: "/blog/dedicated-whatsapp-number" },
] as const;

export function SetupSteps() {
  const ref = useRef<HTMLOListElement>(null);
  const p = usePlayOnce(ref, PLAY_MS, 0.25);
  const local = ([start, end]: readonly [number, number]) => clamp01((p - start) / (end - start));

  return (
    <ol ref={ref} className="mt-10 grid gap-5 lg:grid-cols-3 lg:gap-6">
      <StepCard index={0}>
        <SignUpStage p={local(STAGES.signUp)} />
      </StepCard>
      <StepCard index={1}>
        <ServerStage p={local(STAGES.server)} />
      </StepCard>
      <StepCard index={2}>
        <ChannelStage p={local(STAGES.channel)} />
      </StepCard>
    </ol>
  );
}

function StepCard({ index, children }: { index: number; children: ReactNode }) {
  const step = STEPS[index];
  return (
    <li className="flex flex-col gap-5 md:flex-row md:items-start md:gap-8 lg:flex-col lg:gap-5">
      <div className="flex items-start gap-3 md:w-2/5 md:shrink-0 lg:w-auto">
        <span aria-hidden="true" className={`${SMALL} tabular-nums flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-terra-strong font-bold text-white`}>
          {index + 1}
        </span>
        <div>
          <h3 className={H3}>{step.title}</h3>
          <p className={`${SMALL} mt-1 text-(--ink-2)`}>
            {step.body}
            {"guide" in step ? (
              <>
                {" "}
                <Link href={step.guide} className={TEXT_LINK}>
                  יש מדריך
                </Link>
                .
              </>
            ) : null}
          </p>
        </div>
      </div>
      <PendingLink href="/app" tabIndex={-1} aria-hidden="true" className={`${CARD} block flex-1 p-4 transition-shadow hover:shadow-md sm:p-5 md:w-full`}>
        {children}
      </PendingLink>
    </li>
  );
}

const INPUT = "flex min-h-12 items-center rounded-[12px] border border-(--line-2) bg-(--surface) px-3.5 text-[15px]";

function SignUpStage({ p }: { p: number }) {
  const typed = AGENT_NAME.slice(0, Math.round(clamp01((p - TYPE_FROM) / TYPE_SPAN) * AGENT_NAME.length));
  const typing = p > TYPE_FROM && typed.length < AGENT_NAME.length;
  return (
    <div className="flex flex-col gap-4">
      <p className={`${MICRO} font-bold text-(--accent-ink)`}>התחלה</p>
      <p className="font-display text-[22px] leading-tight text-(--ink)">בואו ניצור לכם סוכן</p>
      <div className={`flex items-center gap-3 rounded-[12px] bg-(--surface-2) px-3.5 py-2.5 transition-opacity duration-500 ${p >= GOOGLE_AT ? "opacity-100" : "opacity-0"}`}>
        <GoogleMark />
        <span className="flex min-w-0 flex-col">
          <span className={`${MICRO} text-(--ink-2)`}>מחוברים עם Google</span>
          <bdi className={`${SMALL} font-medium`}>dana@example.com</bdi>
        </span>
        <span className="ms-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--good-soft) text-(--good)">
          <CheckIcon className="h-3.5 w-3.5" />
        </span>
      </div>
      <div>
        <p className={`${SMALL} mb-1.5 text-(--ink-2)`}>איך הסוכן שלכם ייקרא?</p>
        <div className={INPUT}>
          {typed ? <span>{typed}</span> : <span className="text-(--ink-2)">לדוגמה: ג׳ארוויס, שלומי, אלפרד</span>}
          {typing ? <span className="ms-0.5 h-[18px] w-px animate-pulse bg-(--ink)" /> : null}
        </div>
      </div>
      <span className={`${SMALL} flex min-h-12 items-center justify-center rounded-[12px] font-medium text-white transition-colors duration-300 ${typed.length === AGENT_NAME.length ? "bg-terra" : "bg-terra/50"}`}>
        יצירת סוכן
      </span>
    </div>
  );
}

const SERVER_ROWS = ["סביבה פרטית ומבודדת", "זיכרון ותזכורות", "הגדרות בעברית"];
const ROW_READY_FROM = 0.3;
const ROW_READY_STEP = 0.2;

function ServerStage({ p }: { p: number }) {
  const live = p >= LIVE_AT;
  return (
    <div className="flex flex-col gap-4">
      <p className={`${MICRO} font-bold text-(--accent-ink)`}>{live ? "הסוכן מוכן" : "מקימים את הסוכן"}</p>
      <div className="flex items-center gap-3.5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-(--line) bg-(--surface-2) font-display text-2xl text-(--ink)">
          {AGENT_NAME.charAt(0)}
        </span>
        <div className="flex flex-col items-start gap-1">
          <p className="font-display text-[22px] leading-tight text-(--ink)">{live ? `${AGENT_NAME} כבר רץ` : AGENT_NAME}</p>
          <span className={`${MICRO} inline-flex items-center gap-2 whitespace-nowrap rounded-full px-2.5 py-1 font-bold ${live ? "bg-(--good-soft) text-(--good)" : "bg-(--surface-2) text-(--ink-2)"}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {live ? "פעיל" : "בדרך כלל כחצי דקה"}
          </span>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-(--surface-2)">
        <div
          className={`h-full origin-right rounded-full bg-sage transition-transform ease-linear ${p > 0 ? "scale-x-100" : "scale-x-0"}`}
          style={{ transitionDuration: `${SERVER_FILL_MS}ms` }}
        />
      </div>
      <ul className="flex flex-col">
        {SERVER_ROWS.map((row, i) => (
          <li key={row} className={`${SMALL} flex items-center justify-between border-t border-(--line) py-2.5`}>
            {row}
            {p >= ROW_READY_FROM + i * ROW_READY_STEP ? <CheckIcon className="h-4 w-4 text-(--good)" /> : <Spinner className="h-4 w-4 text-(--ink-2)" />}
          </li>
        ))}
      </ul>
      <p className={`${MICRO} text-(--ink-2)`}>אפשר לסגור את הדף, ההקמה ממשיכה בשרת.</p>
    </div>
  );
}

function ChannelStage({ p }: { p: number }) {
  return (
    <div className="flex flex-col gap-4">
      <p className={`${MICRO} font-bold text-(--accent-ink)`}>הסוכן מוכן</p>
      <p className="font-display text-[22px] leading-tight text-(--ink)">איפה תרצו לדבר איתו?</p>
      <p className={`${MICRO} -mt-2 text-(--ink-2)`}>אפשר לחבר את שניהם, עכשיו או אחר כך.</p>
      <ChannelOption selected={p >= TELEGRAM_PICKED_AT} title="טלגרם" badge="מומלץ" description="חיבור מיידי בשתי לחיצות, בלי מספר טלפון" icon={<TelegramIcon className="h-5 w-5 text-telegram" />} />
      <ChannelOption selected={false} title="וואטסאפ" description="דורש מספר ייעודי לסוכן, לא המספר האישי שלכם" icon={<WhatsAppIcon className="h-5 w-5 text-wa-teal" />} />
    </div>
  );
}

function ChannelOption({ selected, title, badge, description, icon }: { selected: boolean; title: string; badge?: string; description: string; icon: ReactNode }) {
  return (
    <span className={`flex flex-col gap-1 rounded-[12px] border px-4 py-3 transition-colors duration-300 ${selected ? "border-terra bg-(--accent-soft)" : "border-(--line-2) bg-(--surface)"}`}>
      <span className="flex items-center gap-2">
        {icon}
        <span className={`${SMALL} font-medium text-(--ink)`}>{title}</span>
        {badge ? <span className="rounded-full bg-terra px-2 py-0.5 text-[10px] font-medium text-white">{badge}</span> : null}
      </span>
      <span className={`${MICRO} text-(--ink-2)`}>{description}</span>
    </span>
  );
}
