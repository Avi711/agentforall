import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticatedHandler } from "@/lib/auth/api";
import { getConsentStatus, recordConsent } from "@/lib/consent/service";
import { CURRENT_CONSENT_VERSION } from "@/lib/consent-version";

const ConsentBody = z.object({
  acceptedVersion: z
    .number()
    .int()
    .refine((v) => v === CURRENT_CONSENT_VERSION, "version mismatch"),
});

export const GET = authenticatedHandler({}, async ({ userId }) => {
  const status = await getConsentStatus(userId);
  return NextResponse.json(status);
});

export const POST = authenticatedHandler(
  { bodySchema: ConsentBody },
  async ({ userId }) => {
    await recordConsent(userId);
    return NextResponse.json(await getConsentStatus(userId));
  },
);
