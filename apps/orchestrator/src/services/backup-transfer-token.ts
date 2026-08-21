import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { USER_ID_PATTERN } from "../domain/types.js";

const BasePayload = z.object({
  v: z.literal(1),
  userId: z.string().regex(USER_ID_PATTERN),
  exp: z.number().int().positive(),
});

const ImportPayloadSchema = BasePayload.extend({
  action: z.literal("restore-upload"),
  displayName: z.string().min(1).max(255),
  objectName: z.string().min(1).max(1024),
  contentLength: z.number().int().positive(),
  contentType: z.string().min(1).max(128),
});

export interface BackupImportGrant {
  userId: string;
  displayName: string;
  objectName: string;
  contentLength: number;
  contentType: string;
}

export class BackupTransferTokenService {
  constructor(private readonly serviceTokens: readonly string[]) {}

  createRestoreUploadToken(input: {
    userId: string;
    displayName: string;
    objectName: string;
    contentLength: number;
    contentType: string;
    expiresAt: Date;
  }): string {
    return this.signPayload({
      v: 1,
      action: "restore-upload",
      userId: input.userId,
      displayName: input.displayName,
      objectName: input.objectName,
      contentLength: input.contentLength,
      contentType: input.contentType,
      exp: Math.floor(input.expiresAt.getTime() / 1000),
    });
  }

  verifyImport(token: string): BackupImportGrant | null {
    const payload = this.verifyPayload(token, ImportPayloadSchema);
    if (!payload) return null;
    return {
      userId: payload.userId,
      displayName: payload.displayName,
      objectName: payload.objectName,
      contentLength: payload.contentLength,
      contentType: payload.contentType,
    };
  }

  private signPayload(payload: z.infer<typeof ImportPayloadSchema>): string {
    const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    const signature = createHmac("sha256", this.primarySecret())
      .update(payloadPart)
      .digest("base64url");
    return `${payloadPart}.${signature}`;
  }

  private verifyPayload<T>(
    token: string,
    schema: z.ZodType<T>,
  ): T | null {
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [payloadPart, signaturePart] = parts;
    if (!payloadPart || !signaturePart) return null;
    if (!this.hasValidSignature(payloadPart, signaturePart)) return null;

    try {
      const raw = Buffer.from(payloadPart, "base64url").toString("utf8");
      const payload = schema.parse(JSON.parse(raw));
      const exp = BasePayload.parse(payload).exp;
      return exp >= Math.floor(Date.now() / 1000) ? payload : null;
    } catch {
      return null;
    }
  }

  private hasValidSignature(payloadPart: string, signaturePart: string): boolean {
    const provided = Buffer.from(signaturePart, "base64url");
    return this.serviceTokens.some((secret) => {
      const expected = createHmac("sha256", secret)
        .update(payloadPart)
        .digest();
      return provided.length === expected.length && timingSafeEqual(provided, expected);
    });
  }

  private primarySecret(): string {
    const [secret] = this.serviceTokens;
    if (!secret) throw new Error("SERVICE_TOKENS is required for backup tokens");
    return secret;
  }
}
