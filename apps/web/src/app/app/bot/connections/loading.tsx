import { SkeletonBar, SkeletonCard } from "@/app/app/Skeleton";

export default function Loading() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 sm:pt-8 pb-28" aria-busy="true">
      <p className="sr-only" role="status">
        טוען את החיבורים לאפליקציות…
      </p>
      <div className="min-h-11 flex items-center mb-3">
        <SkeletonBar tone="soft" className="h-4 w-24" />
      </div>

      <SkeletonCard className="p-5 sm:p-10">
        <div className="flex items-start gap-3 sm:gap-5 mb-4">
          <SkeletonBar className="shrink-0 w-10 h-10 rounded-full" />
          <div className="min-w-0 flex-1">
            <SkeletonBar className="h-3 w-28 mb-2" />
            <SkeletonBar className="h-6 sm:h-7 w-52 max-w-full rounded-lg" />
          </div>
        </div>
        <SkeletonBar tone="soft" className="h-4 w-full max-w-lg mb-2" />
        <SkeletonBar tone="soft" className="h-4 w-3/4 max-w-md mb-5" />

        <SkeletonBar tone="soft" className="h-11 w-full rounded-xl mb-6" />

        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Tile key={i} />
          ))}
        </ul>
      </SkeletonCard>
    </div>
  );
}

function Tile() {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-sand-light bg-cream/40 px-4 py-3 min-h-[4.75rem]">
      <SkeletonBar className="shrink-0 w-10 h-10 rounded-full" />
      <div className="min-w-0 flex-1">
        <SkeletonBar className="h-4 w-24 max-w-full" />
        <SkeletonBar tone="soft" className="mt-2 h-3 w-32 max-w-full" />
      </div>
      <SkeletonBar tone="soft" className="shrink-0 h-11 w-20 rounded-full" />
    </li>
  );
}
