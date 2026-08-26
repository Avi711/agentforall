import type { BillingUser } from "./domain";

interface SessionUserLike {
  id: string;
  email: string;
  name?: string | null;
  betaAccess?: boolean | null;
}

export function toBillingUser(user: SessionUserLike): BillingUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    betaAccess: Boolean(user.betaAccess),
  };
}
