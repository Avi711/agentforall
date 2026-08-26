import { SITE_WHATSAPP_URL } from "@/lib/site";
import { WhatsAppIcon } from "./WhatsAppIcon";

export function TalkToUs() {
  return (
    <section aria-labelledby="talk-title" className="px-5 pb-16 sm:px-8 sm:pb-24">
      <div className="mx-auto max-w-3xl rounded-[24px] border border-sand-light bg-white px-6 py-8 text-center shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] sm:px-10 sm:py-10">
        <h2 id="talk-title" className="font-display text-2xl text-espresso sm:text-3xl">
          מבולבלים?
        </h2>
        <p className="mt-3 text-espresso-light leading-relaxed">
          רוצים לדבר עם הבוט שלנו ולהתייעץ לפני שמתחילים? הוא זמין בוואטסאפ, 24/7.
        </p>
        <a
          href={SITE_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-sand bg-cream px-6 py-3 text-sm font-bold text-espresso transition hover:bg-cream-dark"
        >
          <WhatsAppIcon className="h-5 w-5 text-sage" />
          לחצו פה לשיחה בוואטסאפ
        </a>
      </div>
    </section>
  );
}
