import { CATALOG_SIZE_LABEL, LANDING_APPS } from "@/lib/integrations/catalog.he";

export function Connections() {
  return (
    <section id="connections" aria-labelledby="connections-title" className="py-16 sm:py-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <header className="text-center mb-10 sm:mb-14">
          <p className="text-xs uppercase tracking-[0.22em] text-espresso-light/80 mb-3">חיבורים</p>
          <h2 id="connections-title" className="font-display text-3xl sm:text-4xl text-espresso leading-tight">
            מתחבר לאפליקציות שאתם כבר משתמשים בהן
          </h2>
          <p className="mt-4 max-w-xl mx-auto text-espresso-light text-sm sm:text-base leading-relaxed">
            מחברים בלחיצה מתוך הסוכן, והוא קורא, כותב ומבצע שם בשבילכם.
          </p>
        </header>

        <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
          {LANDING_APPS.map((app) => (
            <li
              key={app.slug}
              className="flex flex-col items-center gap-2.5 sm:gap-3 rounded-2xl sm:rounded-[20px] border border-sand-light bg-white px-2 py-[18px] sm:px-3 sm:py-6"
            >
              <img src={app.logo} alt="" width={40} height={40} className="h-9 w-9 sm:h-10 sm:w-10 object-contain" />
              <span className="text-[13px] sm:text-sm text-espresso">{app.name}</span>
            </li>
          ))}
        </ul>

        <p className="mt-7 sm:mt-8 flex flex-col sm:flex-row items-center justify-center gap-2.5 text-center text-sm sm:text-base text-espresso-light leading-relaxed">
          <span className="rounded-full bg-cream-dark px-3.5 py-1 text-sm text-espresso">מעל {CATALOG_SIZE_LABEL} אפליקציות נוספות</span>
          <span>מחפשים את האפליקציה בתוך הסוכן ומחברים בלחיצה.</span>
        </p>
      </div>
    </section>
  );
}
