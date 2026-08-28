import { BotCardSkeleton, SkeletonPageHeader } from "./Skeleton";

export default function Loading() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-28" aria-busy="true">
      <p className="sr-only" role="status">
        טוען את הבית שלי…
      </p>
      <SkeletonPageHeader />
      <BotCardSkeleton />
    </div>
  );
}
