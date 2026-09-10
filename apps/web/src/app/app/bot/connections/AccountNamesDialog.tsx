"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DIALOG_ACTION } from "@/app/app/action-buttons";
import { ACCOUNT_LABEL_MAX_LENGTH, accountLabelKey, normalizeAccountLabel } from "@/lib/integrations/schemas";

export interface NameField {
  key: string;
  label: string;
  initial: string;
  placeholder: string;
  // Name keys (accountLabelKey) this field may not take.
  taken: ReadonlySet<string>;
}

export interface SubmitFailure {
  field?: string;
  message: string;
}

const SUGGESTIONS_HE = ["עבודה", "אישי", "עסק"] as const;

interface Props {
  open: boolean;
  title: string;
  description: string;
  fields: readonly NameField[];
  takenMessage: string;
  footnote?: string;
  submitLabel: string;
  busyLabel: string;
  onClose: () => void;
  // Resolves null once done: the caller then closes the dialog or navigates away, so it stays busy.
  onSubmit: (values: Record<string, string>) => Promise<SubmitFailure | null>;
}

export function AccountNamesDialog({
  open,
  title,
  description,
  fields,
  takenMessage,
  footnote,
  submitLabel,
  busyLabel,
  onClose,
  onSubmit,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const baseId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // A fresh object each time, so asking for the same field twice still moves focus.
  const [focusRequest, setFocusRequest] = useState<{ key: string } | null>(null);

  const inputId = (key: string) => `${baseId}-${key}`;
  const errorId = (key: string) => `${baseId}-${key}-error`;

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      setValues(Object.fromEntries(fields.map((f) => [f.key, f.initial])));
      setErrors({});
      setFormError(null);
      setActiveKey(fields[0]?.key ?? null);
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open, fields]);

  // Runs after the render that shows the error, so the field is announced together with it.
  useEffect(() => {
    if (focusRequest) document.getElementById(`${baseId}-${focusRequest.key}`)?.focus();
  }, [focusRequest, baseId]);

  // Back from the consent page, a browser may restore this page as it was left: mid-submit.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    const seen = new Set<string>();
    for (const f of fields) {
      const value = normalizeAccountLabel(values[f.key] ?? "");
      const key = accountLabelKey(value);
      if (!value) found[f.key] = "צריך לתת לחשבון שם";
      else if (value.length > ACCOUNT_LABEL_MAX_LENGTH) found[f.key] = `עד ${ACCOUNT_LABEL_MAX_LENGTH} תווים`;
      else if (f.taken.has(key)) found[f.key] = takenMessage;
      else if (seen.has(key)) found[f.key] = "לכל חשבון צריך שם אחר";
      seen.add(key);
    }
    return found;
  }

  async function submit() {
    if (busy) return;
    const found = validate();
    setErrors(found);
    setFormError(null);
    const firstInvalid = fields.find((f) => found[f.key]);
    if (firstInvalid) {
      setFocusRequest({ key: firstInvalid.key });
      return;
    }
    setBusy(true);
    const normalized = Object.fromEntries(fields.map((f) => [f.key, normalizeAccountLabel(values[f.key] ?? "")]));
    const failure = await onSubmit(normalized);
    if (!failure) return;
    setBusy(false);
    if (failure.field) {
      setErrors({ [failure.field]: failure.message });
      setFocusRequest({ key: failure.field });
    } else {
      setFormError(failure.message);
    }
  }

  function fillSuggestion(suggestion: string) {
    const target =
      fields.find((f) => f.key === activeKey && !normalizeAccountLabel(values[f.key] ?? "")) ??
      fields.find((f) => !normalizeAccountLabel(values[f.key] ?? ""));
    if (!target) return;
    setValues((current) => ({ ...current, [target.key]: suggestion }));
    setErrors((current) => ({ ...current, [target.key]: "" }));
    setFocusRequest({ key: target.key });
  }

  const used = new Set([...fields.flatMap((f) => [...f.taken]), ...Object.values(values).map((v) => accountLabelKey(v))]);
  const suggestions = SUGGESTIONS_HE.filter((s) => !used.has(accountLabelKey(s)));
  const anyEmpty = fields.some((f) => !normalizeAccountLabel(values[f.key] ?? ""));

  return (
    <dialog
      ref={dialogRef}
      onClose={() => {
        setBusy(false);
        onClose();
      }}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      // The backdrop is the dialog element itself; a text selection dragged out onto it must not close it.
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === dialogRef.current;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === dialogRef.current && !busy) dialogRef.current?.close();
      }}
      aria-labelledby={`${baseId}-title`}
      aria-describedby={`${baseId}-description`}
      className="fixed inset-0 m-auto backdrop:bg-espresso/40 rounded-2xl p-0 w-[min(92vw,460px)] max-h-[85dvh] overflow-y-auto overscroll-contain border border-sand-light shadow-[0_20px_48px_rgba(44,24,16,0.18)]"
    >
      <form
        method="dialog"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        dir="rtl"
      >
        <div className="p-5 sm:p-7">
          <h2 id={`${baseId}-title`} className="font-display text-xl text-espresso mb-2">
            {title}
          </h2>
          <p id={`${baseId}-description`} className="text-sm text-espresso-light leading-relaxed mb-5">
            {description}
          </p>

          <div className="space-y-4">
            {fields.map((f, i) => {
              const fieldError = errors[f.key];
              return (
                <div key={f.key}>
                  <label htmlFor={inputId(f.key)} className="block text-sm font-medium text-espresso mb-1.5">
                    {f.label}
                  </label>
                  {/* Read-only rather than disabled while busy: a disabled field cannot take focus back. */}
                  <input
                    id={inputId(f.key)}
                    type="text"
                    dir="auto"
                    autoComplete="off"
                    maxLength={ACCOUNT_LABEL_MAX_LENGTH}
                    placeholder={f.placeholder}
                    autoFocus={i === 0}
                    value={values[f.key] ?? ""}
                    readOnly={busy}
                    aria-invalid={fieldError ? true : undefined}
                    aria-describedby={fieldError ? errorId(f.key) : undefined}
                    onFocus={() => setActiveKey(f.key)}
                    onChange={(e) => {
                      const next = e.target.value;
                      setValues((current) => ({ ...current, [f.key]: next }));
                      if (fieldError) setErrors((current) => ({ ...current, [f.key]: "" }));
                    }}
                    className={`w-full rounded-xl border bg-white px-4 py-3 text-sm text-espresso placeholder:text-espresso-light/60 focus:outline-none focus:ring-2 read-only:opacity-50 ${
                      fieldError
                        ? "border-red-400 focus:border-red-500 focus:ring-red-100"
                        : "border-sand focus:border-terra focus:ring-terra-pale"
                    }`}
                  />
                  {fieldError ? (
                    <p id={errorId(f.key)} className="mt-1.5 text-xs text-red-700">
                      {fieldError}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {anyEmpty && suggestions.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-espresso-light">הצעות:</span>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  // Keeps focus in the field the suggestion is meant for.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => fillSuggestion(s)}
                  className="min-h-9 px-3 rounded-full border border-sand-light bg-cream/60 text-xs font-medium text-espresso hover:bg-cream-dark transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          {footnote ? <p className="mt-4 text-xs text-espresso-light leading-relaxed">{footnote}</p> : null}

          {formError ? (
            <p role="alert" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              {formError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 px-5 pb-5 sm:px-7 sm:pb-6">
          <button
            type="button"
            onClick={() => {
              if (!busy) dialogRef.current?.close();
            }}
            disabled={busy}
            className={DIALOG_ACTION.quiet}
          >
            ביטול
          </button>
          <button type="submit" disabled={busy} aria-busy={busy} className={DIALOG_ACTION.primary}>
            {busy ? (
              <>
                <span
                  aria-hidden="true"
                  className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin"
                />
                <span>{busyLabel}</span>
              </>
            ) : (
              submitLabel
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}
