import { NextResponse } from "next/server";
import { authenticatedHandler, errorJson } from "@/lib/auth/api";
import { BotIdParamsSchema } from "@/lib/bots/schemas";
import { WhatsappCloudConnectBodySchema } from "@/lib/whatsapp-cloud/schemas";
import { getWhatsappCloudService, WhatsappCloudUnavailableError } from "@/lib/whatsapp-cloud/service";
import { MetaOAuthError } from "@/lib/whatsapp-cloud/meta-oauth";
import { OrchestratorError } from "@/lib/orchestrator/client";

const PIN_REQUIRED_CODE = "CHANNEL_PIN_REQUIRED";
const BOT_NOT_READY_CODE = "INVALID_STATE";
const NUMBER_MODE_MISMATCH_CODE = "NUMBER_MODE_MISMATCH";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const parsed = BotIdParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return errorJson("invalid_params", 400, parsed.error.flatten());

  return authenticatedHandler(
    { bodySchema: WhatsappCloudConnectBodySchema, requireEntitlement: true },
    async ({ userId, body }) => {
      try {
        const view = await getWhatsappCloudService().connect(userId, parsed.data.id, body);
        return NextResponse.json(view, { status: 201 });
      } catch (err) {
        if (err instanceof WhatsappCloudUnavailableError) return errorJson("feature_unavailable", 503);
        // A Meta outage is not a bad code; a bad code is single-use, so the user runs the popup again.
        if (err instanceof MetaOAuthError && isMetaOutage(err)) return errorJson("meta_unavailable", 502);
        if (err instanceof MetaOAuthError) return errorJson("signup_code_rejected", 409, { metaCode: err.code });
        if (err instanceof OrchestratorError && orchestratorCode(err.body) === PIN_REQUIRED_CODE) return errorJson("pin_required", 409);
        if (err instanceof OrchestratorError && orchestratorCode(err.body) === BOT_NOT_READY_CODE) return errorJson("bot_not_ready", 409);
        if (err instanceof OrchestratorError && orchestratorCode(err.body) === NUMBER_MODE_MISMATCH_CODE) return errorJson("number_mode_mismatch", 409);
        throw err;
      }
    },
  )(req);
}

// Network failure (status 0), a 2xx with an unreadable body, or a 5xx: Meta's side, not the code.
function isMetaOutage(err: MetaOAuthError): boolean {
  return err.status === 0 || err.status < 400 || err.status >= 500;
}

function orchestratorCode(body: unknown): string | null {
  const code = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : null;
}
