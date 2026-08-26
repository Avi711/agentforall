import { NextResponse } from "next/server";
import { errorJson, renderError } from "@/lib/auth/api";
import { getBillingService } from "@/lib/billing";
import { WebhookProviderParamsSchema } from "@/lib/billing/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 64 * 1024;

// Unauthenticated by design: the provider signs the raw body and the adapter verifies it.
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const params = WebhookProviderParamsSchema.safeParse(await ctx.params);
  if (!params.success) return errorJson("not_found", 404);

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return errorJson("payload_too_large", 413);
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return errorJson("payload_too_large", 413);

  try {
    const outcome = await getBillingService().handleWebhook(params.data.provider, {
      rawBody,
      header: (name) => req.headers.get(name),
    });
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    // Non-2xx makes the provider redeliver; the event row already carries the failure note.
    return renderError(err);
  }
}
