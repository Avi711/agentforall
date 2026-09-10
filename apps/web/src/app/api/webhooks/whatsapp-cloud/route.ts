import { NextResponse } from "next/server";
import { errorJson } from "@/lib/auth/api";
import { readWhatsappCloudConfig } from "@/lib/whatsapp-cloud/config";
import { IngressError, WhatsappCloudIngress } from "@/lib/whatsapp-cloud/ingress";
import { WhatsappCloudRepository } from "@/lib/whatsapp-cloud/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Meta batches up to 1000 updates per POST.
const MAX_BODY_BYTES = 1024 * 1024;

function ingress(): WhatsappCloudIngress | null {
  const config = readWhatsappCloudConfig();
  if (!config) return null;
  return new WhatsappCloudIngress(new WhatsappCloudRepository(), config.appSecret, config.webhookVerifyToken);
}

// Meta's one-time subscription handshake.
export async function GET(req: Request) {
  const service = ingress();
  if (!service) return errorJson("not_found", 404);
  try {
    const challenge = service.verifyChallenge(new URL(req.url).searchParams);
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  } catch (err) {
    if (err instanceof IngressError) {
      console.warn("whatsapp cloud webhook handshake rejected", { code: err.code });
      return errorJson(err.code, err.status);
    }
    throw err;
  }
}

// Meta signs the raw body with the app secret; 5xx means "redeliver", 200 means "done", even for ignored input.
export async function POST(req: Request) {
  const service = ingress();
  if (!service) return errorJson("not_found", 404);

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return errorJson("payload_too_large", 413);
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return errorJson("payload_too_large", 413);

  try {
    const outcome = await service.handle({ rawBody, signature: req.headers.get("x-hub-signature-256") });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    if (err instanceof IngressError) {
      // A bad signature is a secret rotation slip or a spoof attempt; either way someone should see it.
      console.warn("whatsapp cloud webhook rejected", { code: err.code, bytes: rawBody.length });
      return errorJson(err.code, err.status);
    }
    console.error("whatsapp cloud webhook failed", err instanceof Error ? err.message : err);
    return errorJson("ingress_failed", 500);
  }
}
