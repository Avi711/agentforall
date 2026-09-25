import { formatCredits } from "@/lib/billing/format";

export function UsageRow({ title, detail, used, of, tone }: { title: string; detail: string | null; used: number; of: number; tone: string }) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-[13rem_1fr_10.5rem] sm:gap-x-6">
      <span className="col-span-2 flex flex-col sm:col-span-1">
        <span className="text-[15px] text-espresso">{title}</span>
        {detail ? <span className="text-[13px] text-espresso-light">{detail}</span> : null}
      </span>
      <span aria-hidden className="h-2 overflow-hidden rounded-full bg-cream-dark">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${of > 0 ? Math.min(100, (used / of) * 100) : 0}%` }} />
      </span>
      <span className="text-end text-sm text-espresso-light tabular-nums">
        נוצלו <span className="font-semibold text-espresso">{formatCredits(used)}</span> מתוך {formatCredits(of)}
      </span>
    </li>
  );
}
