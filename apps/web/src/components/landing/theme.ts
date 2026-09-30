export const CONTAINER = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";

export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terra-strong";

export const FOCUS_NIGHT = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terra-light";

export const DISPLAY = "font-display3 text-balance text-[clamp(2.1rem,9.6vw,4.25rem)] leading-[1.04] text-(--ink)";

export const PRICE = "tabular-nums text-[44px] font-extrabold leading-none tracking-[-0.02em] text-(--ink)";

export const H2 = "font-h2 text-balance text-[clamp(1.9rem,4.2vw,2.75rem)] leading-[1.1] text-(--ink)";

export const H3 = "text-[20px] font-bold leading-snug text-(--ink)";

export const BODY = "text-[17px] leading-[1.55]";

export const SMALL = "text-[15px] leading-[1.5]";

export const MICRO = "text-[13px] leading-[1.4]";

export const EYEBROW = `${SMALL} font-bold text-(--accent-ink)`;

const BUTTON = "pressable inline-flex items-center justify-center gap-2 rounded-full font-bold transition-colors";

export const PRIMARY_BUTTON = `${BUTTON} min-h-14 px-7 text-[17px] bg-terra-strong text-white hover:bg-terra-dark ${FOCUS}`;

export const QUIET_BUTTON = `${BUTTON} min-h-14 px-6 text-[17px] border border-(--line-2) text-(--ink) hover:border-(--ink)/50 hover:bg-(--surface) ${FOCUS}`;

export const SMALL_PRIMARY_BUTTON = `${BUTTON} h-11 px-5 text-[15px] bg-terra-strong text-white hover:bg-terra-dark ${FOCUS}`;

export const CARD = "rounded-[28px] border border-(--line) bg-(--surface) shadow-(--card-shadow)";

export const SECTION = "scroll-mt-16 py-14 sm:py-24";

export const NAV_LINK = `rounded-md text-(--ink-2) transition-colors hover:text-(--ink) ${FOCUS}`;

export const TEXT_LINK = `rounded font-semibold text-(--accent-ink) underline decoration-(--accent-ink)/40 underline-offset-4 hover:decoration-(--accent-ink) ${FOCUS}`;
