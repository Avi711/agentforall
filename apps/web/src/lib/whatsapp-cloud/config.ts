export interface WhatsappCloudConfig {
  appId: string;
  appSecret: string;
  webhookVerifyToken: string;
  embeddedSignupConfigId: string;
  graphApiVersion: string;
}

const DEFAULT_GRAPH_API_VERSION = "v24.0";

// The webhook and the Meta app can be live (for registration and rehearsal) before tenants may connect; preview accounts first.
export function isWhatsappCloudEnabledFor(userId: string): boolean {
  if (readWhatsappCloudConfig() === null) return false;
  if (process.env.WHATSAPP_CLOUD_ENABLED?.trim() === "true") return true;
  return previewUserIds().has(userId);
}

function previewUserIds(): Set<string> {
  const ids = (process.env.WHATSAPP_CLOUD_PREVIEW_USER_IDS ?? "").split(",").map((id) => id.trim());
  return new Set(ids.filter((id) => id.length > 0));
}

// Null = the Meta app is not configured; the webhook answers 404 and the dashboard hides the channel.
export function readWhatsappCloudConfig(): WhatsappCloudConfig | null {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  const webhookVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  const embeddedSignupConfigId = process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID?.trim();
  if (!appId || !appSecret || !webhookVerifyToken || !embeddedSignupConfigId) return null;
  return {
    appId,
    appSecret,
    webhookVerifyToken,
    embeddedSignupConfigId,
    graphApiVersion: process.env.META_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION,
  };
}
