"use client";

export type ToastTone = "ok" | "warn";

// The live region stays mounted even when empty, so screen readers announce text inserted later.
export function Toast({
  tone,
  text,
  onDismiss,
}: {
  tone: ToastTone;
  text: string | null;
  onDismiss: () => void;
}) {
  const skin = tone === "ok" ? "bg-sage-dark" : "bg-terra";
  return (
    <div className="fixed top-20 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
      <div
        className={
          text
            ? `pointer-events-auto flex max-w-full items-center gap-1 rounded-xl ps-5 pe-2 py-1.5 text-sm sm:text-base font-medium text-white shadow-lg ${skin}`
            : "sr-only"
        }
      >
        <span role="status" aria-live="polite" className="min-w-0">
          {text ?? ""}
        </span>
        {text ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="סגירת ההודעה"
            className="shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-full hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}
