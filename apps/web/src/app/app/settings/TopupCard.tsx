"use client";

import { useState } from "react";
import { ErrorAlert } from "@/components/ErrorAlert";
import { PRIMARY_ACTION } from "@/components/pricing/styles";
import { formatCredits, formatIls } from "@/lib/billing/format";
import { DEFAULT_TOPUP_PRESET_ILS, creditsForTopupIls, type TopupTerms } from "@/lib/billing/pricing";
import { SETTINGS_SECTION } from "@/lib/billing/urls";
import { startTopup } from "../billing/client";
import { BusyLabel, SurfaceCard } from "../Marks";
import { useActionRunner } from "../useActionRunner";

type Choice = number | "custom";

const OPTION =
  "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl border px-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-50";
const SELECTED = "border-terra bg-terra-pale ring-1 ring-terra";

function parseWholeIls(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value) : null;
}

export function TopupCard({ terms }: { terms: TopupTerms }) {
  const [choice, setChoice] = useState<Choice>(DEFAULT_TOPUP_PRESET_ILS);
  const [customText, setCustomText] = useState("");
  const topup = useActionRunner<"topup">();
  const busy = topup.pending !== null;

  const amount = choice === "custom" ? parseWholeIls(customText) : choice;
  const validAmount = amount !== null && amount >= terms.minIls && amount <= terms.maxIls ? amount : null;

  function buy() {
    if (validAmount !== null) void topup.redirect("topup", () => startTopup(validAmount));
  }

  return (
    <SurfaceCard id={SETTINGS_SECTION.topup} className="flex scroll-mt-24 flex-col gap-5 p-6 sm:p-8">
      <header className="flex flex-col gap-1.5">
        <h2 className="font-display text-2xl text-espresso">טעינת קרדיטים</h2>
        <p className="text-sm text-espresso-light">
          לחודש עמוס במיוחד: ₪1 = {terms.creditsPerIls} קרדיטים. קרדיטים שטוענים לא פגים ונשמרים גם אחרי החידוש.
        </p>
      </header>

      <div role="group" aria-label="סכום טעינה" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {terms.presetsIls.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={choice === preset}
            disabled={busy}
            onClick={() => setChoice(preset)}
            className={`${OPTION} ${choice === preset ? SELECTED : "border-sand-light bg-white hover:bg-cream-dark"}`}
          >
            <span className="text-lg font-bold text-espresso tabular-nums">{formatIls(preset)}</span>
            <span className="text-xs text-espresso-light">{formatCredits(creditsForTopupIls(preset))} קרדיטים</span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={choice === "custom"}
          disabled={busy}
          onClick={() => setChoice("custom")}
          className={`${OPTION} text-[15px] font-semibold text-espresso ${choice === "custom" ? SELECTED : "border-dashed border-sand bg-cream"}`}
        >
          סכום אחר
        </button>
      </div>

      {choice === "custom" ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-espresso-light">
            סכום בשקלים, בין {formatIls(terms.minIls)} ל־{formatIls(terms.maxIls)}
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={terms.minIls}
            max={terms.maxIls}
            step={1}
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
            disabled={busy}
            dir="ltr"
            aria-invalid={customText !== "" && validAmount === null}
            className="w-full rounded-xl border border-sand bg-white px-4 py-3 text-espresso focus:border-terra focus:outline-none focus:ring-2 focus:ring-terra/20 disabled:opacity-50"
          />
        </label>
      ) : null}

      <div className="flex flex-col gap-4 rounded-2xl bg-cream p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex flex-col gap-0.5">
          <p className="text-base font-semibold text-espresso">
            {validAmount !== null ? `${formatCredits(creditsForTopupIls(validAmount))} קרדיטים שלא פגים` : "בחרו סכום"}
          </p>
          <p className="text-[13px] text-espresso-light">חיוב חד־פעמי, כולל מע״מ</p>
        </div>
        <button type="button" onClick={buy} disabled={busy || validAmount === null} aria-busy={busy} className={`${PRIMARY_ACTION} sm:px-6`}>
          <BusyLabel busy={busy} busyText="מעבירים לתשלום…">
            {validAmount !== null ? `טעינה ב־${formatIls(validAmount)}` : "טעינה"}
          </BusyLabel>
        </button>
      </div>

      <ErrorAlert>{topup.error}</ErrorAlert>
    </SurfaceCard>
  );
}
