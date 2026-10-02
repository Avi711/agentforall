"use client";

import { useId, type ReactNode } from "react";
import { TILE_BASE, TILE_CLASS } from "./action-buttons";
import { ChevronEnd } from "./Marks";
import { PendingLink } from "./Pending";

type ChannelOfferTarget = { label: string } & ({ kind: "link"; href: string } | { kind: "button"; onClick: () => void });

const FEATURED_TILE = `${TILE_BASE} border-sand bg-cream shadow-[0_8px_22px_-14px_rgba(44,24,16,0.4)] hover:border-espresso/40 hover:bg-cream-dark`;

export function ChannelOfferTile({
  glyph,
  name,
  offer,
  featured = false,
  target,
}: {
  glyph: ReactNode;
  name: string;
  offer: string;
  featured?: boolean;
  target: ChannelOfferTarget;
}) {
  const offerId = useId();
  const body = (
    <>
      <span
        aria-hidden
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full [&_svg]:h-6 [&_svg]:w-6 ${featured ? "bg-white" : "bg-cream"}`}
      >
        {glyph}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[15px] font-semibold text-espresso">{name}</span>
          {featured ? <span className="rounded-full bg-espresso px-2 py-0.5 text-[11px] font-semibold text-cream">הכי מהיר</span> : null}
        </span>
        <span id={offerId} className="text-[13px] text-espresso-light">{offer}</span>
      </span>
      <span className="text-espresso-light transition group-hover:text-espresso">
        <ChevronEnd />
      </span>
    </>
  );
  const className = featured ? FEATURED_TILE : TILE_CLASS;
  if (target.kind === "button") {
    return (
      <button type="button" onClick={target.onClick} aria-label={target.label} aria-describedby={offerId} className={className}>
        {body}
      </button>
    );
  }
  return (
    <PendingLink href={target.href} aria-label={target.label} aria-describedby={offerId} className={className}>
      {body}
    </PendingLink>
  );
}
