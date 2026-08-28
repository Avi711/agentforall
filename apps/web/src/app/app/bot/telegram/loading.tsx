import { SkeletonBar } from "@/app/app/Skeleton";

export default function Loading() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-28" aria-busy="true">
      <p className="sr-only" role="status">
        טוען את חיבור הטלגרם…
      </p>
      <div className="bg-white rounded-2xl shadow-sm border border-sand-light p-5 sm:p-8 max-w-2xl">
        <SkeletonBar tone="soft" className="h-3 w-24 mb-3" />
        <SkeletonBar className="h-7 sm:h-8 w-72 max-w-full rounded-lg mb-8" />
        <ol className="space-y-4 mb-8">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-start gap-4">
              <SkeletonBar className="h-8 w-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 pt-0.5">
                <SkeletonBar className="h-4 w-40 max-w-full" />
                <SkeletonBar tone="soft" className="mt-2 h-3 w-full max-w-sm" />
              </div>
            </li>
          ))}
        </ol>
        <SkeletonBar tone="soft" className="h-12 w-full sm:w-56 rounded-xl" />
      </div>
    </div>
  );
}
