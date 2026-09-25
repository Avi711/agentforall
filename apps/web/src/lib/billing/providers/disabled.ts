import type { PaymentProviderName } from "../domain";
import { BillingUnavailableError } from "../errors";
import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProvider,
  ProviderCapabilities,
  ProviderEvent,
  ProviderPlanChangePreview,
  ProviderSubscription,
  WebhookRequest,
} from "../provider/types";

export class DisabledPaymentProvider implements PaymentProvider {
  readonly available = false;
  readonly capabilities: ProviderCapabilities = {
    cancel: false,
    resume: false,
    customerPortal: false,
    updatePaymentMethod: false,
    cancelWhilePastDue: true,
    changePlan: false,
  };

  constructor(
    readonly name: PaymentProviderName,
    readonly reason: string,
  ) {}

  createCheckout(_input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    return this.reject();
  }

  checkoutUrl(_checkoutSessionId: string): Promise<string> {
    return this.reject();
  }

  parseWebhook(_request: WebhookRequest): Promise<ProviderEvent> {
    return this.reject();
  }

  cancelSubscription(_id: string): Promise<ProviderSubscription | null> {
    return this.reject();
  }

  resumeSubscription(_id: string): Promise<ProviderSubscription | null> {
    return this.reject();
  }

  previewPlanChange(): Promise<ProviderPlanChangePreview> {
    return this.reject();
  }

  changePlan(): Promise<ProviderSubscription> {
    return this.reject();
  }

  getCustomerPortalUrl(_id: string): Promise<string | null> {
    return this.reject();
  }

  getUpdatePaymentMethodUrl(_id: string, _returnUrl: string): Promise<string | null> {
    return this.reject();
  }

  private reject<T>(): Promise<T> {
    return Promise.reject(new BillingUnavailableError(this.reason));
  }
}
