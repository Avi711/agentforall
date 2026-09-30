import { PRICE_FROM } from "./content";
import { CONTAINER, SMALL } from "./theme";

const FACTS = [PRICE_FROM, "סביבה פרטית ומבודדת לכל סוכן, המידע מוצפן"];

export function Proof() {
  return (
    <section aria-label="עובדות בקצרה" className="border-y border-(--line) bg-(--surface)">
      <ul className={`${CONTAINER} ${SMALL} flex flex-col gap-2 py-5 font-semibold text-(--ink) sm:flex-row sm:flex-wrap sm:gap-x-6`}>
        {FACTS.map((fact) => (
          <li key={fact} className="flex items-center gap-2">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-terra-strong" />
            {fact}
          </li>
        ))}
      </ul>
    </section>
  );
}
