import { SkeletonBar, SkeletonCard } from "../Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-6 sm:px-6 sm:pt-10" aria-busy="true">
      <p className="sr-only" role="status">
        טוען את ההגדרות…
      </p>
      <SkeletonBar className="mb-5 h-8 w-32 rounded-lg sm:mb-6 sm:h-9" />

      <div className="flex flex-col gap-10 sm:gap-12">
        <SkeletonCard>
          <div className="flex flex-col gap-6 p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-2.5">
                <SkeletonBar className="h-7 w-32 rounded-lg" />
                <SkeletonBar tone="soft" className="h-4 w-56 max-w-full" />
              </div>
              <SkeletonBar tone="soft" className="hidden h-11 w-32 rounded-full sm:block" />
            </div>
            <SkeletonBar className="h-12 w-48 rounded-lg" />
            <SkeletonBar tone="soft" className="h-2 w-full rounded-full" />
            <SkeletonBar tone="soft" className="h-4 w-72 max-w-full" />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-sand-light/70 px-6 py-6 sm:px-8">
            <SkeletonBar className="h-5 w-36" />
            <SkeletonBar tone="soft" className="h-11 w-24 rounded-full" />
          </div>
        </SkeletonCard>

        <Section rows={3} />
        <Section rows={2} />
      </div>
    </div>
  );
}

function Section({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3">
      <SkeletonBar className="h-7 w-32 rounded-lg" />
      <div className="divide-y divide-sand-light/70">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5 py-3.5">
            <SkeletonBar className="h-4 w-40 max-w-full" />
            <SkeletonBar tone="soft" className="h-3 w-56 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
