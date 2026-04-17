"use client";

import { useEffect, useRef, useState } from "react";

type Prefs = {
  fontSize: "sm" | "base" | "lg" | "xl";
  highContrast: boolean;
  reducedMotion: boolean;
};

const DEFAULTS: Prefs = { fontSize: "base", highContrast: false, reducedMotion: false };
const STORAGE_KEY = "a11y-prefs";

export function AccessibilityWidget() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setPrefs({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    root.setAttribute("data-font-size", prefs.fontSize);
    prefs.highContrast
      ? root.setAttribute("data-high-contrast", "")
      : root.removeAttribute("data-high-contrast");
    prefs.reducedMotion
      ? root.setAttribute("data-reduced-motion", "")
      : root.removeAttribute("data-reduced-motion");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs, loaded]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="הגדרות נגישות"
        aria-expanded={open}
        aria-controls="a11y-panel"
        className="fixed bottom-5 left-5 z-50 flex h-9 w-9 items-center justify-center rounded-full bg-espresso/90 text-cream shadow-md shadow-black/15 transition hover:scale-105 hover:bg-terra focus:outline-none focus-visible:ring-2 focus-visible:ring-terra/60 sm:bottom-6 sm:left-6 sm:h-10 sm:w-10"
      >
        <svg className="h-4 w-4 sm:h-[18px] sm:w-[18px]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2a2 2 0 110 4 2 2 0 010-4zM21 9l-1 2-5-1v3l3 7-2 1-3-6h-2l-3 6-2-1 3-7V10L4 11 3 9l7-1h4l7 1z" />
        </svg>
      </button>

      {open && (
        <div
          id="a11y-panel"
          role="dialog"
          aria-label="הגדרות נגישות"
          dir="rtl"
          className="fixed bottom-20 left-5 z-50 w-[300px] rounded-2xl border border-sand/40 bg-white p-5 shadow-2xl shadow-black/15 sm:bottom-24 sm:left-6"
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg font-black text-espresso">נגישות</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="סגור"
              className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-espresso-light transition hover:bg-cream"
            >
              ×
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-bold text-espresso">גודל טקסט</label>
              <div className="flex gap-1.5">
                {(
                  [
                    { v: "sm" as const, l: "א-" },
                    { v: "base" as const, l: "א" },
                    { v: "lg" as const, l: "א+" },
                    { v: "xl" as const, l: "א++" },
                  ]
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setPrefs((p) => ({ ...p, fontSize: o.v }))}
                    aria-pressed={prefs.fontSize === o.v}
                    className={`flex-1 rounded-lg py-2 text-sm font-bold transition ${
                      prefs.fontSize === o.v
                        ? "bg-espresso text-cream"
                        : "bg-cream text-espresso-light ring-1 ring-sand/50 hover:ring-sand"
                    }`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>

            <Toggle
              label="ניגודיות גבוהה"
              value={prefs.highContrast}
              onChange={(v) => setPrefs((p) => ({ ...p, highContrast: v }))}
            />

            <Toggle
              label="הפחתת תנועה"
              value={prefs.reducedMotion}
              onChange={(v) => setPrefs((p) => ({ ...p, reducedMotion: v }))}
            />

            <div className="flex items-center justify-between border-t border-sand/40 pt-3">
              <button
                type="button"
                onClick={() => setPrefs(DEFAULTS)}
                className="text-sm font-semibold text-terra hover:underline"
              >
                איפוס
              </button>
              <a
                href="/accessibility"
                className="text-sm font-semibold text-terra hover:underline"
              >
                הצהרת נגישות
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-bold text-espresso">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 rounded-full transition ${value ? "bg-terra" : "bg-sand"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            value ? "end-0.5" : "start-0.5"
          }`}
        />
      </button>
    </div>
  );
}
