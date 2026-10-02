export interface CapiConfig {
  pixelId: string;
  accessToken: string;
  apiVersion: string;
  testEventCode?: string;
}

type Env = Record<string, string | undefined>;

// Conversions API calls follow the Marketing API version schedule, which retires versions far sooner than Graph API.
const DEFAULT_API_VERSION = "v26.0";

function isProductionDeployment(env: Env): boolean {
  return env.VERCEL_ENV === "production";
}

// Numeric only: the id is interpolated into the inline Pixel script.
function pixelIdOf(env: Env): string | null {
  const id = env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
  return id && /^\d+$/.test(id) ? id : null;
}

export function metaPixelId(env: Env = process.env): string | null {
  return isProductionDeployment(env) ? pixelIdOf(env) : null;
}

// Dev machines and previews share the production dataset, so only an explicit test code (for verifying the setup) lets them send.
export function readCapiConfig(env: Env = process.env): CapiConfig | null {
  const pixelId = pixelIdOf(env);
  const accessToken = env.META_CAPI_ACCESS_TOKEN?.trim();
  const testEventCode = env.META_CAPI_TEST_EVENT_CODE?.trim() || undefined;
  if (!pixelId || !accessToken) return null;
  if (!isProductionDeployment(env) && !testEventCode) return null;

  return {
    pixelId,
    accessToken,
    apiVersion: env.META_CAPI_API_VERSION?.trim() || DEFAULT_API_VERSION,
    testEventCode,
  };
}
