import Image from "next/image";
import Link from "next/link";

const STEPS = [
  { title: "מספר חדש ב-eSIM", text: "חבילת פריפייד זולה, קוד QR מהספק, דקה בהגדרות הטלפון." },
  { title: "חשבון וואטסאפ שני", text: "באותו טלפון, בלי להתנתק מהחשבון שלכם." },
  { title: "סורקים את הקוד שלנו", text: "מכשירים מקושרים ← קישור מכשיר. הסוכן מחובר." },
];

export function WhatsappGuide() {
  return (
    <section id="whatsapp-guide" aria-labelledby="whatsapp-guide-title" className="px-5 py-20 sm:px-8 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div dir="rtl">
          <span className="text-xs font-bold uppercase tracking-wider text-terra">מדריך מצולם</span>
          <h2 id="whatsapp-guide-title" className="font-display mt-3 text-4xl font-black leading-[1.1] tracking-tight text-espresso sm:text-5xl">
            מספר ייעודי לסוכן?
            <br />
            רבע שעה, בלי טלפון נוסף.
          </h2>
          <p className="mt-4 max-w-md text-lg font-light text-espresso-light">
            הסוכן צריך מספר וואטסאפ משלו. המדריך מראה כל לחיצה, בתמונות, לאייפון ולאנדרואיד.
          </p>
          <ol className="mt-8 space-y-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex items-start gap-4">
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-terra text-sm font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <p className="font-bold text-espresso">{step.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-espresso-light">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <Link
            href="/blog/dedicated-whatsapp-number"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-espresso px-7 py-3 text-base font-bold text-cream transition hover:bg-terra"
          >
            למדריך המלא
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10h12M11 5l5 5-5 5" />
            </svg>
          </Link>
        </div>

        <Link href="/blog/dedicated-whatsapp-number" aria-label="למדריך המלא" className="group block">
          <Image
            src="/blog/dedicated-whatsapp-number/cover.webp"
            alt="טלפון על שולחן ולצידו כרטיס סים, על המסך סריקת קוד QR"
            width={1600}
            height={900}
            sizes="(max-width: 1024px) 100vw, 560px"
            className="w-full rounded-[28px] border border-sand-light shadow-[0_24px_60px_-30px_rgba(44,24,16,0.35)] transition group-hover:-translate-y-1"
          />
        </Link>
      </div>
    </section>
  );
}
