import { createHmac, timingSafeEqual } from "node:crypto";

export function signBody(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function verifyBodySignature(secret: string, rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signBody(secret, rawBody), "hex");
  const received = Buffer.from(signature.trim(), "hex");
  if (received.length === 0 || received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}
