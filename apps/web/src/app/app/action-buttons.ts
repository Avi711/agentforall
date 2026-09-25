export type ActionEmphasis = "primary" | "quiet" | "danger";

const ACTION_BASE =
  "pressable inline-flex min-h-11 items-center justify-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50";

export const ROW_ACTION_CLASS: Record<ActionEmphasis, string> = {
  primary: `${ACTION_BASE} bg-terra text-white hover:bg-terra-dark focus-visible:ring-terra`,
  quiet: `${ACTION_BASE} border border-sand bg-white text-espresso hover:bg-cream-dark hover:border-espresso-light/40 focus-visible:ring-terra`,
  danger: `${ACTION_BASE} bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-700`,
};

// min-w keeps the button still when its label swaps to spinner + busy text.
export const DIALOG_ACTION: Record<ActionEmphasis, string> = {
  primary: `${ROW_ACTION_CLASS.primary} min-w-28`,
  quiet: `${ROW_ACTION_CLASS.quiet} min-w-28`,
  danger: `${ROW_ACTION_CLASS.danger} min-w-28`,
};
