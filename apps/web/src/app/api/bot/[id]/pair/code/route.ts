import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticatedHandler } from "@/lib/auth/api";
import { getOrchestratorClient } from "@/lib/orchestrator/client";

const PhoneBody = z.object({
  phone: z
    .string()
    .trim()
    .regex(
      /^\+?\d{10,15}$/,
      "phone must be E.164 (country code + number, 10–15 digits)",
    ),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return authenticatedHandler(
    { bodySchema: PhoneBody, requireConsent: true },
    async ({ userId, body }) => {
      const client = getOrchestratorClient();
      const result = await client.requestPairCode(userId, id, body.phone);
      return NextResponse.json(result);
    },
  )(req);
}
