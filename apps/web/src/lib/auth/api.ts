import "server-only";
import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { getServerSession, type AuthenticatedUser } from "./session";
import { OrchestratorError } from "../orchestrator/client";
import { getConsentStatus } from "../consent/service";
import { getBillingService } from "../billing";
import { BillingError } from "../billing/errors";
import { toBillingUser } from "../billing/user";

export type Handler<Body> = (ctx: {
  userId: string;
  user: AuthenticatedUser;
  body: Body;
}) => Promise<Response> | Response;

export interface HandlerOptions<Body> {
  bodySchema?: z.ZodType<Body, z.ZodTypeDef, unknown>;
  // WhatsApp-only: the consent covers the account-suspension risk of pairing a real number.
  requireWhatsappConsent?: boolean;
  // Paid-only actions (creating a bot). No-op while BILLING_REQUIRED is off.
  requireEntitlement?: boolean;
}

export function authenticatedHandler<Body = undefined>(
  opts: HandlerOptions<Body>,
  handler: Handler<Body>,
) {
  return async function route(req: Request): Promise<Response> {
    const session = await getServerSession();
    if (!session?.user) {
      return errorJson("unauthorized", 401);
    }

    if (opts.requireWhatsappConsent) {
      const consent = await getConsentStatus(session.user.id);
      if (!consent.accepted || consent.stale) {
        return errorJson("consent_required", 403);
      }
    }

    if (opts.requireEntitlement) {
      try {
        const entitled = await getBillingService().isEntitled(toBillingUser(session.user));
        if (!entitled) return errorJson("payment_required", 402);
      } catch (err) {
        return renderError(err);
      }
    }

    let body: Body = undefined as Body;
    if (opts.bodySchema) {
      let raw: unknown = undefined;
      if (req.method !== "GET" && req.method !== "HEAD") {
        try {
          raw = await req.json();
        } catch {
          return errorJson("invalid_json", 400);
        }
      }
      const parsed = opts.bodySchema.safeParse(raw);
      if (!parsed.success) {
        return errorJson("invalid_body", 400, parsed.error.flatten());
      }
      body = parsed.data;
    }

    try {
      return await handler({ userId: session.user.id, user: session.user, body });
    } catch (err) {
      return renderError(err);
    }
  };
}

export function errorJson(
  code: string,
  status: number,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { error: { code, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

export function renderError(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return errorJson("invalid_body", 400, err.flatten());
  }
  if (err instanceof BillingError) {
    if (err.status >= 500) console.error("[billing] request failed", { code: err.code, message: err.message });
    return errorJson(err.code, err.status, err.details);
  }
  if (err instanceof OrchestratorError) {
    const code =
      err.status === 401
        ? "orchestrator_unauthorized"
        : err.status === 404
          ? "not_found"
          : err.status === 409
            ? "conflict"
            : err.status === 425
              ? "too_early"
              : err.status >= 500 || err.status === 0
                ? "orchestrator_unavailable"
                : "bad_request";
    const httpStatus =
      err.status === 0 ? 502 : err.status >= 500 ? 502 : err.status;
    return errorJson(code, httpStatus, err.body);
  }
  console.error("[api] unhandled error", err);
  return errorJson("internal_error", 500);
}
