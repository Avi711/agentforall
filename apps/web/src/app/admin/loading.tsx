import { SkeletonBar } from "@/app/app/Skeleton";

export default function Loading() {
  return (
    <div dir="ltr" lang="en" className="min-h-screen bg-cream text-left" aria-busy="true">
      <p className="sr-only" role="status">
        Loading the admin dashboard…
      </p>
      <header className="border-b border-sand/30 bg-white/80 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-4">
          <SkeletonBar className="h-6 w-40 rounded-lg" />
          <SkeletonBar tone="soft" className="h-9 w-40 rounded-xl" />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <SkeletonBar className="h-6 w-32 rounded-lg mb-4" />
        <div className="rounded-2xl border border-sand-light bg-white p-4">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="flex items-center gap-4 py-3">
              <SkeletonBar className="h-4 w-48" />
              <SkeletonBar tone="soft" className="h-4 w-32" />
              <SkeletonBar tone="soft" className="h-4 w-24" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
