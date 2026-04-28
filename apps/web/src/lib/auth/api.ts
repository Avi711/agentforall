import "server-only";
import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { getServerSession } from "./session";
import { OrchestratorError } from "../orchestrator/client";
import { getConsentStatus } from "../consent/service";

type Handler<Body> = (ctx: {
  userId: string;
  body: Body;
}) => Promise<NextResponse> | NextResponse;

export interface HandlerOptions<Body> {
  bodySchema?: z.ZodType<Body>;
  /** Reject with 403 consent_required if user hasn't accepted current version. */
  requireConsent?: boolean;
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

    if (opts.requireConsent) {
      const consent = await getConsentStatus(session.user.id);
      if (!consent.accepted || consent.stale) {
        return errorJson("consent_required", 403);
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
      return await handler({ userId: session.user.id, body });
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

function renderError(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return errorJson("invalid_body", 400, err.flatten());
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
