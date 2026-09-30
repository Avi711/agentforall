import Link from "next/link";
import { OperatorLine } from "@/components/OperatorLine";
import { DATA_FACTS } from "./content";
import { BODY, CARD, CONTAINER, EYEBROW, H2, SECTION, SMALL, TEXT_LINK } from "./theme";

export function Trust() {
  return (
    <section id="safety" aria-labelledby="safety-title" className={SECTION}>
      <div className={`${CONTAINER} grid gap-8 lg:grid-cols-12 lg:items-center lg:gap-12`}>
        <div className="lg:col-span-5">
          <p className={EYEBROW}>פרטיות ובטיחות</p>
          <h2 id="safety-title" className={`${H2} mt-3`}>
            אתם מחליטים מה הוא רואה.
          </h2>
          <p className={`${BODY} mt-5 max-w-[30rem] text-pretty text-(--ink-2)`}>
            בברירת מחדל הוא רואה רק את ההודעות שאתם כותבים לו. כל חיבור לאפליקציה הוא הפעלה מודעת שלכם, ואפשר לנתק אותו בכל רגע.
          </p>
          <p className={`${SMALL} mt-6 text-(--ink-2)`}>
            <OperatorLine />
            <br />
            <Link href="/privacy" className={TEXT_LINK}>
              למדיניות הפרטיות המלאה
            </Link>
          </p>
        </div>

        <ul className={`${CARD} grid gap-x-8 p-6 sm:grid-cols-2 sm:p-8 lg:col-span-7`}>
          {DATA_FACTS.map((fact, i) => (
            <li key={fact} className={`${BODY} flex items-start gap-3 border-t border-(--line) py-4 text-(--ink) first:border-t-0 sm:[&:nth-child(2)]:border-t-0`}>
              <span aria-hidden="true" className={`${SMALL} tabular-nums pt-0.5 font-bold text-(--accent-ink)`}>
                {String(i + 1).padStart(2, "0")}
              </span>
              {fact}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
