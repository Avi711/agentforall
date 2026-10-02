import type { CheckoutKind } from "../billing/domain";

export type SignUpMethod = "email" | "google" | "unknown";

interface Charge {
  amount_agorot: number;
  currency: string;
}

export type ProductEvent =
  | { name: "signed_up"; method: SignUpMethod }
  | { name: "trial_started" }
  | { name: "bot_created"; source: "new" | "backup" }
  | ({ name: "checkout_started"; kind: CheckoutKind; product: string } & Charge)
  | ({ name: "subscription_paid"; plan: string; new_subscription: boolean } & Charge)
  | ({ name: "credits_purchased"; product: string } & Charge);

export type TrackProductEvent = (userId: string, event: ProductEvent) => void;

export const ignoreProductEvents: TrackProductEvent = () => {};
