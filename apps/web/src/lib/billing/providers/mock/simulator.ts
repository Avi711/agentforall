import { randomUUID } from "node:crypto";
import type { BillingUser } from "../../domain";
import { CheckoutAlreadySettledError, CheckoutSessionNotFoundError, UnknownProviderError } from "../../errors";
import type { MockCheckoutOutcome } from "../../schemas";
import type { BillingService, WebhookOutcome } from "../../service";
import { MockPaymentProvider } from "./adapter";

// Plays the gateway's part after the user clicks on the mock checkout page.
export class MockCheckoutSimulator {
  constructor(
    private readonly billing: BillingService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async complete(user: BillingUser, checkoutSessionId: string, outcome: MockCheckoutOutcome): Promise<WebhookOutcome> {
    const provider = this.billing.activeProvider;
    if (!(provider instanceof MockPaymentProvider)) throw new UnknownProviderError("mock");
    const session = await this.billing.findCheckoutSession(user, checkoutSessionId);
    if (!session) throw new CheckoutSessionNotFoundError();
    if (session.status !== "pending") throw new CheckoutAlreadySettledError();

    const occurredAt = this.now().toISOString();
    const webhook =
      outcome === "success"
        ? provider.signedWebhook({
            type: "checkout.completed",
            id: `mock_evt_${randomUUID()}`,
            occurredAt,
            checkoutSessionId: session.id,
            mode: session.kind === "subscription" ? "subscription" : "one_time",
            subscriptionId: session.kind === "subscription" ? `mock_sub_${session.id}` : null,
            customerId: `mock_cus_${user.id}`,
            productCode: session.productCode,
            payment: { id: `mock_pay_${randomUUID()}`, amountAgorot: session.amountAgorot, currency: "ILS" },
          })
        : provider.signedWebhook({
            type: "checkout.failed",
            id: `mock_evt_${randomUUID()}`,
            occurredAt,
            checkoutSessionId: session.id,
            reason: "card_declined",
          });
    return this.billing.handleWebhook(provider.name, webhook);
  }
}
