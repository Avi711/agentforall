import type { ReactNode } from "react";
import { DIALOG_ACTION } from "../action-buttons";
import { BusyLabel, ChevronEnd, Spinner, SurfaceCard } from "../Marks";

export interface ManageOption {
  key: string;
  title: string;
  detail: string;
  pending: boolean;
  onSelect: () => void;
}

export function ManageBilling({ options, disabled, children }: { options: readonly ManageOption[]; disabled: boolean; children?: ReactNode }) {
  if (options.length === 0) return null;
  return (
    <SurfaceCard className="px-6 py-2 sm:px-8">
      <ul className="divide-y divide-sand-light/70">
        {options.map((option) => (
          <li key={option.key}>
            <button
              type="button"
              disabled={disabled}
              aria-busy={option.pending}
              onClick={option.onSelect}
              className="flex w-full items-center justify-between gap-4 py-5 text-start transition hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-60"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-espresso">{option.title}</span>
                <span className="text-[13px] text-espresso-light">{option.detail}</span>
              </span>
              <span className="text-espresso-light">{option.pending ? <Spinner /> : <ChevronEnd />}</span>
            </button>
          </li>
        ))}
      </ul>
      {children}
    </SurfaceCard>
  );
}

export function CancelConfirm({
  periodEnd,
  busy,
  pending,
  onConfirm,
  onClose,
}: {
  periodEnd: string | null;
  busy: boolean;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/60 p-4">
      <p className="text-sm leading-relaxed text-espresso">
        המנוי יישאר פעיל עד {periodEnd ?? "סוף תקופת החיוב"}, ואחר כך הסוכן יפסיק לעבוד. לבטל?
      </p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" disabled={busy} onClick={onClose} className={DIALOG_ACTION.quiet}>
          להשאיר את המנוי
        </button>
        <button type="button" disabled={busy} aria-busy={pending} onClick={onConfirm} className={DIALOG_ACTION.danger}>
          <BusyLabel busy={pending} busyText="מבטלים…">כן, לבטל את המנוי</BusyLabel>
        </button>
      </div>
    </div>
  );
}
