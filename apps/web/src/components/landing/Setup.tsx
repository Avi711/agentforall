import { PendingLink } from "@/app/app/Pending";
import { CTA_LABEL, TRIAL_NOTE } from "./content";
import { ArrowForward } from "./marks";
import { SetupSteps } from "./SetupSteps";
import { BODY, CONTAINER, EYEBROW, H2, PRIMARY_BUTTON, SECTION, SMALL } from "./theme";

export function Setup() {
  return (
    <section id="setup" aria-labelledby="setup-title" className={`${SECTION} border-t border-(--line) bg-(--surface-2)`}>
      <div className={CONTAINER}>
        <div className="max-w-[40rem]">
          <p className={EYEBROW}>איך מתחילים</p>
          <h2 id="setup-title" className={`${H2} mt-3`}>
            מאפס לסוכן משלכם, תוך דקות.
          </h2>
          <p className={`${BODY} mt-4 text-pretty text-(--ink-2)`}>שלושה צעדים, ישר מהמסכים האמיתיים.</p>
        </div>

        <SetupSteps />

        <div className="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <PendingLink href="/app" className={PRIMARY_BUTTON}>
            {CTA_LABEL}
            <ArrowForward className="h-5 w-5" />
          </PendingLink>
          <p className={`${SMALL} text-center font-semibold text-(--ink-2)`}>{TRIAL_NOTE}</p>
        </div>
      </div>
    </section>
  );
}
