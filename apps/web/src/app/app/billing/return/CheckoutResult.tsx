"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CheckIcon } from "@/components/pricing/CheckIcon";
import { PRIMARY_ACTION, SECONDARY_ACTION } from "@/components/pricing/styles";
import { WhatsAppChatLink } from "@/components/WhatsAppChatLink";
import { SETTINGS_PATH } from "@/lib/billing/urls";
import { Spinner, SummaryRows, SurfaceCard, type Tone } from "../../Marks";
import { useCheckoutSettlement } from "./useCheckoutSettlement";

const HOME_PATH = "/app";

export interface PaymentReceipt {
  title: string;
  lead: string;
  rows: readonly { label: string; value: ReactNode }[];
}

export type CheckoutOutcome = { status: "completed"; receipt: PaymentReceipt } | { status: "pending" } | { status: "failed" };

export function CheckoutResult({ sessionId, outcome, retryHref }: { sessionId: string; outcome: CheckoutOutcome; retryHref: string }) {
  const settlement = useCheckoutSettlement(sessionId, outcome.status === "pending");

  if (outcome.status === "completed") return <Receipt receipt={outcome.receipt} />;
  if (outcome.status === "failed" || settlement === "failed") return <NotCompleted retryHref={retryHref} />;
  if (settlement === "slow" || settlement === "stopped") return <StillConfirming stopped={settlement === "stopped"} />;
  return <Confirming />;
}

export function Confirming() {
  return (
    <ResultCard
      badge={<Badge tone="muted"><Spinner className="h-7 w-7" /></Badge>}
      title="מאשרים את התשלום"
      lead="זה לוקח בדרך כלל כמה שניות, והדף יתעדכן לבד."
      live
    />
  );
}

function StillConfirming({ stopped }: { stopped: boolean }) {
  return (
    <ResultCard
      badge={<Badge tone="muted">{stopped ? <AlertIcon /> : <Spinner className="h-7 w-7" />}</Badge>}
      title="התשלום עדיין בבדיקה"
      lead={
        stopped
          ? "זה לוקח יותר מהרגיל. אם חויבתם, התוכנית תיפתח אוטומטית תוך כמה דקות, ואפשר לרענן את הדף מאוחר יותר."
          : "זה לוקח יותר מהרגיל. אם חויבתם, התוכנית תיפתח אוטומטית והדף יתעדכן לבד."
      }
      live
      actions={
        <>
          <WhatsAppChatLink text="היי, שילמתי אבל התשלום עדיין בבדיקה" className={SECONDARY_ACTION}>
            דברו איתנו
          </WhatsAppChatLink>
          <Link href={HOME_PATH} className={PRIMARY_ACTION}>
            למסך הבית
          </Link>
        </>
      }
    />
  );
}

function NotCompleted({ retryHref }: { retryHref: string }) {
  return (
    <ResultCard
      badge={<Badge tone="warn"><AlertIcon /></Badge>}
      title="התשלום לא הושלם"
      lead="לא חויבתם. אפשר לנסות שוב, גם עם אמצעי תשלום אחר."
      actions={
        <>
          <Link href={HOME_PATH} className={SECONDARY_ACTION}>
            למסך הבית
          </Link>
          <Link href={retryHref} className={PRIMARY_ACTION}>
            לנסות שוב
          </Link>
        </>
      }
    />
  );
}

function Receipt({ receipt }: { receipt: PaymentReceipt }) {
  return (
    <ResultCard
      badge={<Badge tone="good"><CheckIcon className="h-8 w-8" /></Badge>}
      title={receipt.title}
      lead={receipt.lead}
      live
      actions={
        <>
          <Link href={SETTINGS_PATH} className={SECONDARY_ACTION}>
            להגדרות ותשלומים
          </Link>
          <Link href={HOME_PATH} className={PRIMARY_ACTION}>
            למסך הבית
          </Link>
        </>
      }
    >
      <SummaryRows rows={receipt.rows} />
    </ResultCard>
  );
}

function ResultCard({
  badge,
  title,
  lead,
  live = false,
  actions,
  children,
}: {
  badge: ReactNode;
  title: string;
  lead: string;
  live?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <SurfaceCard className="flex flex-col items-center gap-6 px-6 py-10 text-center sm:px-10 sm:py-12">
      {badge}
      <div role={live ? "status" : undefined} className="flex flex-col gap-2">
        <h1 className="font-display text-3xl leading-tight text-espresso sm:text-4xl">{title}</h1>
        <p className="text-[15px] leading-relaxed text-espresso-light">{lead}</p>
      </div>
      {children}
      {actions ? <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-center">{actions}</div> : null}
    </SurfaceCard>
  );
}

const BADGE_TONE: Record<Tone, string> = {
  good: "bg-sage-pale text-sage-dark",
  warn: "bg-terra-pale text-terra-dark",
  muted: "bg-cream-dark text-espresso-light",
};

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span aria-hidden className={`flex h-16 w-16 items-center justify-center rounded-full ${BADGE_TONE[tone]}`}>
      {children}
    </span>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" className="h-8 w-8">
      <path d="M12 7v6" />
      <path d="M12 17h.01" />
    </svg>
  );
}
