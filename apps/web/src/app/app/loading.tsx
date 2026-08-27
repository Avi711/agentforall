export default function Loading() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-28" aria-busy="true">
      <p className="sr-only" role="status">
        טוען את הבית שלי…
      </p>
      <div className="mb-10">
        <div className="h-3 w-20 bg-sand-light rounded animate-pulse mb-4" />
        <div className="h-10 sm:h-12 w-56 max-w-full bg-sand-light rounded-lg animate-pulse" />
        <div className="mt-5 h-4 w-64 max-w-full bg-sand-light/70 rounded animate-pulse" />
      </div>

      {/* Mirrors BotCard: avatar + name + badge, then three rows. */}
      <div className="bg-white rounded-[28px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] p-5 sm:p-10">
        <div className="flex items-start gap-3 sm:gap-5 mb-6 sm:mb-7">
          <div className="shrink-0 w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-sand-light animate-pulse" />
          <div className="min-w-0 flex-1">
            <div className="h-3 w-20 bg-sand-light rounded animate-pulse mb-2.5" />
            <div className="h-7 w-40 max-w-full bg-sand-light rounded-lg animate-pulse" />
            <div className="mt-3 h-6 w-32 bg-sand-light/70 rounded-full animate-pulse" />
          </div>
        </div>
        <div className="border-t border-sand-light/70 divide-y divide-sand-light/70">
          {[0, 1, 2].map((i) => (
            <div key={i} className="py-4 sm:py-5 flex items-center gap-3">
              <div className="shrink-0 w-9 h-9 rounded-full bg-sand-light animate-pulse" />
              <div className="min-w-0 flex-1">
                <div className="h-4 w-32 max-w-full bg-sand-light rounded animate-pulse" />
                <div className="mt-2 h-3 w-48 max-w-full bg-sand-light/60 rounded animate-pulse" />
              </div>
              <div className="shrink-0 h-11 w-28 rounded-full bg-sand-light/70 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
