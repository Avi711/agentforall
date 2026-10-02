import type { ProductEvent } from "../analytics/events";
import { CHECKOUT_RETURN_PATH, SETTINGS_PATH } from "../billing/urls";

export interface Conversion {
  eventName: "CompleteRegistration" | "StartTrial" | "InitiateCheckout" | "Subscribe" | "Purchase";
  path: string;
  customData?: { value: number; currency: string };
}

// Renewals are left out: they are not ad-driven, and Meta wants them as system_generated rather than website events.
export function conversionsFor(event: ProductEvent): Conversion[] {
  switch (event.name) {
    case "signed_up":
      return [{ eventName: "CompleteRegistration", path: "/login" }];
    case "trial_started":
      return [{ eventName: "StartTrial", path: "/app" }];
    case "bot_created":
      return [];
    case "checkout_started":
      return [{ eventName: "InitiateCheckout", path: SETTINGS_PATH, customData: chargeValue(event) }];
    case "subscription_paid":
      if (!event.new_subscription) return [];
      return [
        { eventName: "Subscribe", path: CHECKOUT_RETURN_PATH, customData: chargeValue(event) },
        { eventName: "Purchase", path: CHECKOUT_RETURN_PATH, customData: chargeValue(event) },
      ];
    case "credits_purchased":
      return [{ eventName: "Purchase", path: CHECKOUT_RETURN_PATH, customData: chargeValue(event) }];
  }
}

function chargeValue(charge: { amount_agorot: number; currency: string }): { value: number; currency: string } {
  return { value: charge.amount_agorot / 100, currency: charge.currency };
}
