"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "agent"; text: string; time: string };

const SCRIPT: { prompt: string; reply: string; time: string }[] = [
  {
    prompt: "מה יש לי היום?",
    reply:
      "בוקר טוב 🌤️\n3 פגישות: רופא שיניים ב-10:00, צוות ב-14:00, אמא לארוחת ערב ב-19:00.\nאל תשכח — יום הולדת לשרה. הכנתי טיוטה.",
    time: "09:41",
  },
  {
    prompt: "תשלח לשרה. וכמה הוצאתי השבוע?",
    reply:
      "נשלח לשרה ✅\nהוצאת השבוע: 1,280 ש״ח — 15% מתחת לתקציב. עיקר ההוצאה: סופר ודלק.",
    time: "09:42",
  },
  {
    prompt: "מתי יוסי חוזר ממילואים?",
    reply:
      "יוסי חוזר ב-28/4 אחרי 21 יום. על הימים האלה הוא זכאי לתגמול מהביטוח הלאומי — רוצה שאפתח את הבקשה ב-MyBL?",
    time: "09:43",
  },
];

const INTRO_DELAY = 500;
const RESTART_DELAY = 300;
const PER_CHAR_MS = 35;
const PRE_SEND_MS = 250;
const AGENT_TYPING_MS = 900;
const BETWEEN_TURNS_MS = 1400;

export function InteractiveChat() {
  const [history, setHistory] = useState<Msg[]>([]);
  const [step, setStep] = useState(0);
  const [typing, setTyping] = useState(false);
  const [userTyping, setUserTyping] = useState("");
  const [done, setDone] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const intervals = useRef<Set<ReturnType<typeof setInterval>>>(new Set());

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
    return id;
  }, []);

  const every = useCallback((fn: () => void, ms: number) => {
    const id = setInterval(fn, ms);
    intervals.current.add(id);
    return id;
  }, []);

  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    intervals.current.forEach(clearInterval);
    intervals.current.clear();
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, typing, userTyping]);

  const runStep = useCallback(
    (index: number) => {
      if (index >= SCRIPT.length) {
        setDone(true);
        return;
      }
      const current = SCRIPT[index];

      let i = 0;
      setUserTyping("");
      const typeId = every(() => {
        i++;
        setUserTyping(current.prompt.slice(0, i));
        if (i >= current.prompt.length) {
          clearInterval(typeId);
          intervals.current.delete(typeId);
          later(() => {
            setUserTyping("");
            setHistory((h) => [...h, { role: "user", text: current.prompt, time: current.time }]);
            setTyping(true);
            later(() => {
              setTyping(false);
              setHistory((h) => [...h, { role: "agent", text: current.reply, time: current.time }]);
              setStep(index + 1);
              later(() => runStep(index + 1), BETWEEN_TURNS_MS);
            }, AGENT_TYPING_MS);
          }, PRE_SEND_MS);
        }
      }, PER_CHAR_MS);
    },
    [every, later],
  );

  useEffect(() => {
    const id = later(() => runStep(0), INTRO_DELAY);
    return () => {
      clearAll();
      clearTimeout(id);
    };
  }, [later, runStep, clearAll]);

  const restart = useCallback(() => {
    clearAll();
    setHistory([]);
    setStep(0);
    setTyping(false);
    setUserTyping("");
    setDone(false);
    later(() => runStep(0), RESTART_DELAY);
  }, [clearAll, later, runStep]);

  return (
    <div className="animate-float mx-auto w-full max-w-[340px]" dir="ltr">
      <div className="overflow-hidden rounded-[2.5rem] border-[3px] border-espresso/10 bg-white shadow-2xl shadow-espresso/10">
        {/* Status bar */}
        <div className="flex items-center justify-between bg-wa-dark px-5 pt-3 pb-1 text-[11px] text-white/80">
          <span className="font-medium">9:41</span>
          <div className="flex items-center gap-1.5">
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3a4.237 4.237 0 00-6 0zm-4-4l2 2a7.074 7.074 0 0110 0l2-2C15.14 9.14 8.87 9.14 5 13z"/></svg>
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z"/></svg>
          </div>
        </div>

        {/* WhatsApp header */}
        <div className="flex items-center gap-3 bg-wa-dark px-4 pb-3">
          <svg className="h-5 w-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-wa-green to-wa-dark text-sm font-bold text-white ring-2 ring-white/20">
            ס
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold text-white">הסוכן שלי</p>
            <p className="text-[12px] text-wa-green">{typing ? "מקליד..." : "מחובר"}</p>
          </div>
        </div>

        {/* Chat */}
        <div
          ref={scrollRef}
          className="bg-wa-wallpaper h-[420px] overflow-y-auto scroll-smooth px-3 py-4"
          dir="rtl"
        >
          <div className="space-y-2">
            {history.map((m, i) =>
              m.role === "user" ? <Out key={i} text={m.text} time={m.time} /> : <In key={i} text={m.text} time={m.time} />,
            )}
            {typing && <TypingBubble />}
          </div>
        </div>

        {/* Input bar */}
        <div className="flex items-center gap-2 bg-[#F0F0F0] px-3 py-2">
          <button
            type="button"
            onClick={done ? restart : undefined}
            disabled={!done}
            aria-label={done ? "הפעל מחדש" : "מקליד"}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition ${
              done ? "cursor-pointer bg-wa-green hover:bg-wa-dark" : "bg-wa-green/80 cursor-default"
            }`}
          >
            {done ? (
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 9a8 8 0 0114.5-4M19 15a8 8 0 01-14.5 4" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 15c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v7c0 1.66 1.34 3 3 3z" />
                <path d="M17.3 12c0 3-2.54 5.1-5.3 5.1S6.7 15 6.7 12H5c0 3.41 2.72 6.23 6 6.72V22h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
              </svg>
            )}
          </button>
          <div
            className="flex-1 rounded-full bg-white px-4 py-2.5 text-end text-[14px] text-espresso"
            dir="rtl"
          >
            {userTyping ? (
              <span>
                {userTyping}
                <span className="animate-pulse">|</span>
              </span>
            ) : (
              <span className="text-gray-400">{done ? "הקש להפעלה מחדש" : "הקלידו הודעה"}</span>
            )}
          </div>
        </div>
      </div>

      {/* Progress dots */}
      <div className="mt-4 flex justify-center gap-1.5" dir="rtl">
        {SCRIPT.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i < step ? "w-6 bg-terra" : "w-1.5 bg-sand"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function Out({ text, time }: { text: string; time: string }) {
  return (
    <div className="flex justify-end">
      <div className="relative max-w-[80%] rounded-lg rounded-tl-none bg-wa-light px-3 pt-2 pb-4 text-[14px] leading-relaxed whitespace-pre-line text-espresso shadow-sm">
        {text}
        <span className="absolute bottom-1 left-2 text-[10px] text-gray-500">{time}</span>
      </div>
    </div>
  );
}

function In({ text, time }: { text: string; time: string }) {
  return (
    <div className="flex justify-start">
      <div className="relative max-w-[80%] rounded-lg rounded-tr-none bg-white px-3 pt-2 pb-4 text-[14px] leading-relaxed whitespace-pre-line text-espresso shadow-sm">
        {text}
        <span className="absolute bottom-1 left-2 text-[10px] text-gray-500">{time}</span>
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-lg rounded-tr-none bg-white px-3 py-3 shadow-sm" aria-label="הסוכן מקליד">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400" style={{ animationDelay: "150ms" }} />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}
