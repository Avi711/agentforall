import { SkeletonBar } from "@/app/app/Skeleton";

export default function Loading() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-28" aria-busy="true">
      <p className="sr-only" role="status">
        טוען את חיבור ה-WhatsApp…
      </p>
      {/* Matches PairingFlow, not ConsentGate: the consent screen is shown once, the flow every time after. */}
      <div className="bg-white rounded-[24px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] p-5 sm:p-8">
        <SkeletonBar tone="soft" className="h-3 w-24 mb-3" />
        <SkeletonBar className="h-7 sm:h-8 w-64 max-w-full rounded-lg mb-4" />
        <SkeletonBar tone="soft" className="h-4 w-full max-w-md mb-2" />
        <SkeletonBar tone="soft" className="h-4 w-2/3 max-w-sm mb-8" />
        <SkeletonBar className="h-56 w-56 max-w-full rounded-2xl mb-8" />
        <SkeletonBar tone="soft" className="h-11 w-48 max-w-full rounded-xl" />
      </div>
    </div>
  );
}
