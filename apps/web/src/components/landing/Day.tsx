import { DAY_MOMENTS, MORE_CAPABILITIES } from "./content";
import { BODY, CONTAINER, EYEBROW, H2, H3, SECTION, SMALL } from "./theme";
import { ChatHeader, DayChip, InBubble, OutBubble } from "./whatsapp";

export function Day() {
  return (
    <section id="day" aria-labelledby="day-title" className={`${SECTION} lg:py-28`}>
      <div className={`${CONTAINER} grid gap-8 lg:grid-cols-12 lg:gap-x-12`}>
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-24">
            <p className={EYEBROW}>יום רגיל עם הסוכן</p>
            <h2 id="day-title" className={`${H2} mt-3`}>
              <span className="block">אתם כותבים שורה אחת.</span>
              <span className="block">הוא עושה את השאר.</span>
            </h2>
            <p className={`${BODY} mt-5 max-w-[30rem] text-pretty text-(--ink-2)`}>
              ככה נראית שיחה של יום רגיל. חלק מההודעות אתם שולחים, וחלק הוא שולח לכם בעצמו.
            </p>
            <h3 className={`${H3} mt-10`}>ועוד דברים שהוא יודע לעשות</h3>
            <ul className={`${SMALL} mt-3 grid gap-y-2 text-(--ink)`}>
              {MORE_CAPABILITIES.map((capability) => (
                <li key={capability} className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-terra-strong" />
                  {capability}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="overflow-hidden rounded-[28px] border border-(--line) shadow-(--thread-shadow)">
            <ChatHeader status="מחובר" />
            <ol className="wa-wallpaper flex flex-col gap-1.5 px-3 py-4 sm:px-6 sm:py-6">
              {DAY_MOMENTS.map((moment) => (
                <li key={moment.time} className="rise flex flex-col gap-1.5 pt-4 first:pt-0">
                  <DayChip>
                    <span className="tabular-nums">{moment.time}</span> · {moment.label}
                  </DayChip>
                  {moment.user ? <OutBubble time={moment.time}>{moment.user}</OutBubble> : null}
                  <InBubble time={moment.user ? undefined : moment.time} className={moment.user ? "" : "ring-2 ring-terra-strong/60"}>
                    {moment.agent}
                  </InBubble>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
