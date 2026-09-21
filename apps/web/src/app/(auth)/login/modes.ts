export const FORM_MODES = ["signin", "signup", "forgot"] as const;
export type FormMode = (typeof FORM_MODES)[number];
