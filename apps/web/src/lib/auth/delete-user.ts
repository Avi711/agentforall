import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { PendingCheckoutError } from "../billing/errors";
import { CHECKOUT_PENDING_HE } from "../messages.he";

type DeleteUserOptions = NonNullable<NonNullable<BetterAuthOptions["user"]>["deleteUser"]>;

export interface AccountCleanup {
  cancelBilling(userId: string): Promise<void>;
  deleteBots(userId: string): Promise<void>;
}

// No verification email: Better Auth then deletes only for a session under a day old, else answers SESSION_EXPIRED.
export function deleteUserOptions(cleanup: AccountCleanup): DeleteUserOptions {
  return {
    enabled: true,
    // Any throw aborts the deletion, so an account never outlives its bots or open billing.
    beforeDelete: async (user) => {
      try {
        await cleanup.cancelBilling(user.id);
      } catch (err) {
        if (err instanceof PendingCheckoutError) throw new APIError("CONFLICT", { message: CHECKOUT_PENDING_HE });
        throw err;
      }
      await cleanup.deleteBots(user.id);
    },
  };
}
