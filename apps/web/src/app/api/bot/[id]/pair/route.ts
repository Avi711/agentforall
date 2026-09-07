import { NextResponse } from "next/server";
import { authenticatedHandler, errorJson } from "@/lib/auth/api";
import { botService } from "@/lib/bots/service";
import { BotIdParamsSchema, StartPairingBodySchema } from "@/lib/bots/schemas";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = BotIdParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return errorJson("invalid_params", 400, parsed.error.flatten());

  return authenticatedHandler({ requireWhatsappConsent: true }, async ({ userId }) => {
    // Older callers send no body; the pairing then keeps whatever owner number is on record.
    const raw = await req.text();
    let ownerNumber: string | null = null;
    if (raw.trim()) {
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return errorJson("invalid_body", 400);
      }
      const body = StartPairingBodySchema.safeParse(json);
      if (!body.success) return errorJson("invalid_body", 400, body.error.flatten());
      ownerNumber = body.data.ownerNumber;
    }
    const result = await botService.startPairing(userId, parsed.data.id, ownerNumber);
    return NextResponse.json(result);
  })(req);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = BotIdParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return errorJson("invalid_params", 400, parsed.error.flatten());

  return authenticatedHandler({}, async ({ userId }) => {
    await botService.cancelPairing(userId, parsed.data.id);
    return new NextResponse(null, { status: 204 });
  })(req);
}
