import type { CheckoutKind } from "../billing/domain";

export type SignUpMethod = "email" | "google" | "unknown";

export type ProductEvent =
  | { name: "signed_up"; method: SignUpMethod }
  | { name: "bot_created"; source: "new" | "backup" }
  | { name: "checkout_started"; kind: CheckoutKind; product: string }
  | { name: "subscription_paid"; plan: string; new_subscription: boolean }
  | { name: "credits_purchased"; product: string };

export type TrackProductEvent = (userId: string, event: ProductEvent) => void;

export const ignoreProductEvents: TrackProductEvent = () => {};
