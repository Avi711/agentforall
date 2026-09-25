import type { ReactNode } from "react";
import { DIALOG_ACTION } from "../action-buttons";
import { BusyLabel } from "../Marks";
import { OptionRow, PageSection, type OptionRowProps } from "./Section";

export type ManageOption = OptionRowProps;

export function ManageBilling({
  links,
  cancel,
  disabled,
  children,
}: {
  links: readonly ManageOption[];
  cancel: ManageOption | null;
  disabled: boolean;
  children?: ReactNode;
}) {
  if (links.length === 0 && !cancel) return null;
  return (
    <PageSection id="billing" title="ניהול המנוי">
      {links.length > 0 ? (
        <>
          <p className="text-sm text-espresso-light">התשלומים, הכרטיס והקבלות מנוהלים אצל פאדל, ספק התשלומים שלנו.</p>
          <ul className="divide-y divide-sand-light/70">
            {links.map((option) => (
              <li key={option.title}>
                <OptionRow {...option} disabled={disabled} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {cancel ? (
        <div className={links.length > 0 ? "mt-4" : ""}>
          <OptionRow {...cancel} disabled={disabled} />
          {children}
        </div>
      ) : null}
    </PageSection>
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
    <div className="mt-2 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/60 p-4">
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
