import type { GuideStep } from "@/lib/blog";

export function GuideOverview({ steps }: { steps: GuideStep[] }) {
  return (
    <section aria-labelledby="guide-overview">
      <h2 id="guide-overview" className="font-display text-2xl text-espresso sm:text-3xl">
        בקצרה: {steps.length} שלבים
      </h2>
      <ol className="mt-6 grid gap-3 sm:grid-cols-3 sm:gap-4">
        {steps.map((step, i) => (
          <li key={step.id}>
            <a
              href={`#${step.id}`}
              className="grid h-full grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 rounded-[22px] border border-sand-light bg-white p-4 transition hover:border-sand hover:shadow-[0_18px_40px_-30px_rgba(44,24,16,0.45)] sm:flex sm:flex-col sm:gap-3 sm:p-5"
            >
              <span aria-hidden="true" className="row-span-3 flex h-10 w-10 items-center justify-center rounded-full bg-terra text-base font-bold text-white">
                {i + 1}
              </span>
              <span className="text-lg font-bold text-espresso">{step.title}</span>
              <span className="text-[15px] leading-relaxed text-espresso-light">{step.summary}</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-terra-dark sm:mt-auto sm:pt-1">
                לשלב {i + 1}
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M11 6l-6 6 6 6" />
                </svg>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
