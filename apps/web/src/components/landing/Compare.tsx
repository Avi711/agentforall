import { COMPARISON, COMPARISON_ROWS } from "@/content/comparison.he";
import { DoneMark } from "./marks";
import { CARD, CONTAINER, EYEBROW, H2, MICRO, SECTION, SMALL } from "./theme";

const ROW = "grid grid-cols-2 lg:grid-cols-[1fr_1.4fr_1.4fr]";
const CELL = "px-4 sm:px-6 lg:py-4";

export function Compare() {
  return (
    <section id="compare" aria-labelledby="compare-title" className={`${SECTION} border-t border-(--line)`}>
      <div className={`${CONTAINER} grid gap-8 lg:grid-cols-12 lg:items-center lg:gap-12`}>
        <div className="lg:col-span-4">
          <p className={EYEBROW}>{COMPARISON.eyebrow}</p>
          <h2 id="compare-title" className={`${H2} mt-3`}>
            <span className="block">{COMPARISON.titleLead}</span>
            <span className="block text-(--accent-ink)">{COMPARISON.titleAccent}</span>
          </h2>
        </div>

        <div className="lg:col-span-8">
          <div className={`${CARD} overflow-hidden`}>
            <div aria-hidden="true" className={`${ROW} ${SMALL} border-b border-(--line) font-bold`}>
              <span className="max-lg:hidden" />
              <span className={`${CELL} border-t-[3px] border-terra-strong py-3 text-(--accent-ink) lg:bg-(--accent-soft)/40`}>{COMPARISON.agentColumn}</span>
              <span className={`${CELL} border-t-[3px] border-transparent py-3 text-(--ink-2)`}>{COMPARISON.chatColumn}</span>
            </div>
            <ul>
              {COMPARISON_ROWS.map((row) => (
                <li key={row.label} className={`${ROW} border-b border-(--line) last:border-b-0`}>
                  <p className={`${CELL} ${MICRO} col-span-2 pt-3 font-bold text-(--ink-2) lg:col-span-1 lg:text-[15px] lg:text-(--ink)`}>{row.label}</p>
                  <p className={`${CELL} ${SMALL} flex items-start gap-2 pb-3 pt-1 font-semibold text-(--ink) lg:bg-(--accent-soft)/40`}>
                    {row.agentWins ? <DoneMark className="mt-0.5 h-4 w-4" /> : <span aria-hidden="true" className="w-4 shrink-0" />}
                    <span>
                      <span className="sr-only">{COMPARISON.agentColumn}: </span>
                      {row.agent}
                      {row.agentNote ? "*" : null}
                    </span>
                  </p>
                  <p className={`${CELL} ${SMALL} pb-3 pt-1 text-(--ink-2)`}>
                    <span className="sr-only">{COMPARISON.chatColumn}: </span>
                    {row.chat}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <p className={`${MICRO} mt-3 text-(--ink-2)`}>{COMPARISON.note}</p>
        </div>
      </div>
    </section>
  );
}
