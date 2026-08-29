export type ActionEmphasis = "primary" | "quiet" | "danger";

export const ROW_ACTION_CLASS: Record<ActionEmphasis, string> = {
  primary:
    "inline-flex min-h-11 items-center justify-center gap-1.5 px-5 py-2.5 rounded-full bg-terra text-white text-sm font-medium hover:bg-terra-dark transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white",
  quiet:
    "inline-flex min-h-11 items-center justify-center gap-1.5 px-5 py-2.5 rounded-full border border-sand bg-white text-espresso text-sm font-medium hover:bg-cream-dark hover:border-espresso-light/40 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white",
  danger:
    "inline-flex min-h-11 items-center justify-center gap-1.5 px-5 py-2.5 rounded-full bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
};

export const DIALOG_ACTION: Record<ActionEmphasis, string> = {
  primary: `${ROW_ACTION_CLASS.primary} disabled:opacity-60 disabled:cursor-wait`,
  quiet: `${ROW_ACTION_CLASS.quiet} disabled:opacity-50`,
  danger: `${ROW_ACTION_CLASS.danger} disabled:opacity-40 disabled:cursor-not-allowed`,
};
