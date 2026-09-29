import Link from "next/link";
import type { PostGuide, PostVideo } from "@/lib/blog";
import { GuideVideo } from "./GuideVideo";
import { CheckIcon } from "./icons";

export function GuideHero({
  title,
  dateLabel,
  dateTime,
  readingMinutes,
  guide,
  video,
}: {
  title: string;
  dateLabel: string;
  dateTime: string;
  readingMinutes: number;
  guide: PostGuide;
  video: PostVideo;
}) {
  return (
    <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-x-16 lg:gap-y-0">
      <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
        <nav aria-label="פירורי לחם" className="text-sm text-espresso-light">
          <Link href="/blog" className="font-medium text-terra-dark hover:underline">
            הבלוג
          </Link>
          <span className="mx-2 text-sand">/</span>
          <span>{title}</span>
        </nav>
        <p className="mt-4 inline-flex items-center rounded-full bg-terra-pale px-3.5 py-1.5 text-sm font-bold text-terra-dark sm:mt-6">
          {guide.eyebrow}
        </p>
        <h1 className="font-display mt-3 text-[32px] leading-[1.15] text-espresso sm:mt-4 sm:text-5xl sm:leading-[1.12]">{title}</h1>
        <p className="mt-3 text-[17px] leading-relaxed text-espresso-light sm:mt-5 sm:text-lg">{guide.lede}</p>
      </div>

      <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
        <GuideVideo video={video} />
      </div>

      <div className="lg:col-start-1 lg:row-start-2">
        <div className="rounded-[20px] lg:mt-7 border border-sand-light bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <p className="font-bold text-espresso">מה צריך</p>
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-espresso-light">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 2" />
              </svg>
              {guide.duration}
            </p>
          </div>
          <ul className="mt-3 space-y-2">
            {guide.needs.map((need) => (
              <li key={need} className="flex gap-2.5 text-espresso-light">
                <CheckIcon className="mt-1 h-4 w-4 shrink-0 text-sage-dark" />
                {need}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-espresso-light/80">
          <span>
            <time dateTime={dateTime}>{dateLabel}</time> · {readingMinutes} דקות קריאה
          </span>
          <a href="#guide" className="inline-flex items-center gap-1.5 font-semibold text-espresso hover:text-terra-dark">
            למדריך הכתוב
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
          </a>
        </p>
      </div>
    </div>
  );
}
