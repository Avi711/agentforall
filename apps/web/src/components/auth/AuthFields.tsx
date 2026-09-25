"use client";

import { useState, type ReactNode } from "react";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";
import { AUTH_INPUT } from "./styles";

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block mb-1.5 text-sm text-espresso-light">{label}</label>
      {children}
      {hint ? <p id={hintId(id)} className="mt-1.5 text-xs text-espresso-light">{hint}</p> : null}
    </div>
  );
}

export function hintId(fieldId: string): string {
  return `${fieldId}-hint`;
}

export function PasswordInput({
  id,
  value,
  onChange,
  disabled,
  isNew,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  isNew: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        name="password"
        required
        dir="ltr"
        minLength={isNew ? MIN_PASSWORD_LENGTH : undefined}
        maxLength={MAX_PASSWORD_LENGTH}
        autoComplete={isNew ? "new-password" : "current-password"}
        aria-describedby={isNew ? hintId(id) : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`${AUTH_INPUT} text-left pr-32`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-controls={id}
        className="absolute inset-y-0 right-2 my-auto h-8 px-2.5 rounded-lg text-xs font-medium text-terra-dark hover:bg-terra-pale transition disabled:opacity-50"
      >
        {visible ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
      </button>
    </div>
  );
}

// Stays empty unless Cloudflare needs the person to act; `slotRef` comes from useTurnstile.
export function CaptchaSlot({ slotRef }: { slotRef: (node: HTMLDivElement | null) => void }) {
  return <div ref={slotRef} className="flex justify-center empty:hidden" />;
}
