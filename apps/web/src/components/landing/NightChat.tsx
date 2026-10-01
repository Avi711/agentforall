"use client";

import { useRef, type ReactNode } from "react";
import { usePlayOnce } from "./hooks";
import { Reveal } from "./marks";
import { MICRO } from "./theme";
import { ChatHeader, DayChip, InBubble, OutBubble, TypingDots } from "./whatsapp";

const PLAY_MS = 6500;
const BUSINESS = "סטודיו רינת";

export function NightChat() {
  const ref = useRef<HTMLDivElement>(null);
  const p = usePlayOnce(ref, PLAY_MS);

  return (
    <div ref={ref} aria-hidden="true" className="night-chat mx-auto w-full max-w-[440px]">
      <div className="overflow-hidden rounded-[28px] shadow-(--night-card-shadow)">
        <ChatHeader name={BUSINESS} status="מחובר" tint />
        <div className="wa-wallpaper grid px-3 py-4 sm:px-4">
          <NightThread p={1} className="invisible" />
          <NightThread p={p} />
        </div>
        <p className={`${MICRO} flex items-center justify-center gap-2 bg-(--wa-bar) px-3 py-2.5 font-semibold text-(--wa-chip-ink)`}>
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sage" />
          הסוכן ענה בשם העסק. רינת ישנה.
        </p>
      </div>
    </div>
  );
}

// The finished thread is laid out invisibly in the same grid cell, so the playing one never changes the page height.
function NightThread({ p, className = "" }: { p: number; className?: string }) {
  const at = (threshold: number) => p >= threshold;
  return (
    <div className={`col-start-1 row-start-1 flex flex-col gap-1.5 ${className}`}>
      <DayChip>הלילה · 23:40</DayChip>
      <Step shown={at(0.04)}>
        <OutBubble time="23:40">היי, עד מתי אתם פתוחים מחר? ואיפה חונים אצלכם?</OutBubble>
      </Step>
      <Step shown={at(0.2)}>
        <InBubble time={at(0.4) ? "23:40" : undefined}>
          {at(0.4) ? "היי! מחר פתוחים 9:00 עד 18:00. חניה חינם בחניון של הבניין, הכניסה מרחוב הרצל 12. רוצה שרינת תחזור אלייך בבוקר?" : <TypingDots />}
        </InBubble>
      </Step>
      <Step shown={at(0.58)}>
        <OutBubble time="23:41">כן, תודה!</OutBubble>
      </Step>
      <Step shown={at(0.7)}>
        <InBubble time={at(0.86) ? "23:41" : undefined}>{at(0.86) ? "רשמתי. רינת תחזור אלייך מחר בבוקר. לילה טוב." : <TypingDots />}</InBubble>
      </Step>
    </div>
  );
}

function Step({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <Reveal shown={shown} className={`flex flex-col ${shown ? "" : "h-0"}`}>
      {children}
    </Reveal>
  );
}
