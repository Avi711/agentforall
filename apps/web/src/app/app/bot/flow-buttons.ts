const BASE =
  "pressable inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-5 py-2.5 text-[15px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-50 disabled:cursor-not-allowed";

// The connect flows' two actions, same height and shape so neither outweighs the other.
export const FLOW_BUTTON = {
  primary: `${BASE} bg-terra text-white hover:bg-terra-dark`,
  secondary: `${BASE} border border-sand bg-white text-espresso hover:border-espresso-light/40 hover:bg-cream-dark`,
};
