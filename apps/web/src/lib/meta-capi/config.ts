export interface CapiConfig {
  pixelId: string;
  accessToken: string;
  apiVersion: string;
  testEventCode?: string;
}

const DEFAULT_API_VERSION = "v22.0";

// Returns null when CAPI is disabled (missing token). Routes should treat null
// as a noop rather than an error — the Pixel still works client-side.
export function readCapiConfig(): CapiConfig | null {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !accessToken) return null;

  return {
    pixelId,
    accessToken,
    apiVersion: process.env.META_CAPI_API_VERSION?.trim() || DEFAULT_API_VERSION,
    testEventCode: process.env.META_CAPI_TEST_EVENT_CODE?.trim() || undefined,
  };
}
