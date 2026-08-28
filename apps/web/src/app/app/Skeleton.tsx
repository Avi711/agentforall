import type { ReactNode } from "react";

// `tone` instead of a className override: two Tailwind bg utilities on one element is a specificity coin-flip.
export function SkeletonBar({
  className = "",
  tone = "solid",
}: {
  className?: string;
  tone?: "solid" | "soft";
}) {
  const bg = tone === "soft" ? "bg-sand-light/70" : "bg-sand-light";
  return <span aria-hidden className={`block ${bg} rounded animate-pulse ${className}`} />;
}

export function SkeletonCard({
  className = "",
  radius = "rounded-[28px]",
  children,
}: {
  className?: string;
  radius?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`bg-white ${radius} border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] ${className}`}
    >
      {children}
    </div>
  );
}

// Mirrors BotCard: avatar + name + badge, then three rows. Shared by loading.tsx and the streamed home card.
export function BotCardSkeleton() {
  return (
    <SkeletonCard className="p-5 sm:p-10">
      <div className="flex items-start gap-3 sm:gap-5 mb-6 sm:mb-7">
        <SkeletonBar className="shrink-0 w-14 h-14 sm:w-20 sm:h-20 rounded-full" />
        <div className="min-w-0 flex-1">
          <SkeletonBar className="h-3 w-20 mb-2.5" />
          <SkeletonBar className="h-7 w-40 max-w-full rounded-lg" />
          <SkeletonBar tone="soft" className="mt-3 h-6 w-32 rounded-full" />
        </div>
      </div>
      <div className="border-t border-sand-light/70 divide-y divide-sand-light/70">
        {[0, 1, 2].map((i) => (
          <div key={i} className="py-4 sm:py-5 flex items-center gap-3">
            <SkeletonBar className="shrink-0 w-9 h-9 rounded-full" />
            <div className="min-w-0 flex-1">
              <SkeletonBar className="h-4 w-32 max-w-full" />
              <SkeletonBar tone="soft" className="mt-2 h-3 w-48 max-w-full" />
            </div>
            <SkeletonBar tone="soft" className="shrink-0 h-11 w-28 rounded-full" />
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

// Mirrors the header block every /app page opens with, so the shell never jumps.
export function SkeletonPageHeader({ titleWidth = "w-56" }: { titleWidth?: string }) {
  return (
    <div className="mb-10">
      <SkeletonBar className="h-3 w-20 mb-4" />
      <SkeletonBar className={`h-10 sm:h-12 max-w-full rounded-lg ${titleWidth}`} />
      <SkeletonBar tone="soft" className="mt-5 h-4 w-64 max-w-full" />
    </div>
  );
}
