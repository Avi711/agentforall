import { SkeletonBar, SkeletonCard, SkeletonPageHeader } from "../Skeleton";

export default function Loading() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-28 space-y-8 sm:space-y-10" aria-busy="true">
      <p className="sr-only" role="status">
        טוען את ההגדרות…
      </p>
      <SkeletonPageHeader titleWidth="w-40" />

      <Card rows={2} />
      <Card rows={3} action />
      <Card rows={2} action />
      <SkeletonCard radius="rounded-2xl" className="p-5 sm:p-8">
        <SkeletonBar className="h-6 w-32 rounded-lg mb-3" />
        <SkeletonBar tone="soft" className="h-4 w-full max-w-md mb-2" />
        <SkeletonBar tone="soft" className="h-4 w-2/3 max-w-sm mb-6" />
        <SkeletonBar tone="soft" className="h-11 w-40 rounded-lg" />
      </SkeletonCard>
    </div>
  );
}

function Card({ rows, action = false }: { rows: number; action?: boolean }) {
  return (
    <SkeletonCard radius="rounded-[24px]" className="p-5 sm:p-10">
      <SkeletonBar className="h-3 w-24 mb-3" />
      <SkeletonBar className="h-7 w-44 max-w-full rounded-lg mb-6" />
      <div className="divide-y divide-sand-light/70 mb-6">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 py-3.5 first:pt-0 last:pb-0">
            <SkeletonBar tone="soft" className="h-3 w-20 sm:w-28 sm:shrink-0" />
            <SkeletonBar className="h-4 w-48 max-w-full" />
          </div>
        ))}
      </div>
      {action ? <SkeletonBar tone="soft" className="h-11 w-44 max-w-full rounded-lg" /> : null}
    </SkeletonCard>
  );
}
