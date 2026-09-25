import { PLAN_TRUST_POINTS } from "@/content/plans.he";
import { CheckIcon } from "./CheckIcon";

export function TrustPoints() {
  return (
    <ul className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-[13px] text-espresso-light sm:text-sm">
      {PLAN_TRUST_POINTS.map((point) => (
        <li key={point} className="flex items-center gap-2">
          <CheckIcon />
          {point}
        </li>
      ))}
    </ul>
  );
}
