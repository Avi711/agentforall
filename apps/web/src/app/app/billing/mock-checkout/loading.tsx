import { SkeletonBar, SkeletonCard } from "@/app/app/Skeleton";

export default function Loading() {
  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-28" aria-busy="true">
      <p className="sr-only" role="status">
        טוען את דף התשלום…
      </p>
      <SkeletonCard radius="rounded-[24px]" className="p-6 sm:p-8 space-y-6">
        <div>
          <SkeletonBar tone="soft" className="h-3 w-40 mb-2" />
          <SkeletonBar className="h-7 w-48 max-w-full rounded-lg" />
          <SkeletonBar tone="soft" className="mt-2 h-4 w-24" />
        </div>
        <SkeletonBar tone="soft" className="h-4 w-full max-w-xs" />
        <div className="flex flex-col gap-3">
          <SkeletonBar tone="soft" className="h-12 w-full rounded-lg" />
          <SkeletonBar tone="soft" className="h-12 w-full rounded-lg" />
        </div>
      </SkeletonCard>
    </div>
  );
}
