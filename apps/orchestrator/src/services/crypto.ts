import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { InstanceConfig, ChannelConfig } from "../domain/types.js";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// String envelope: `vN:` + base64(iv || ct || tag). Legacy un-prefixed accepted
// on decrypt. Binary envelope: [version | iv | ct | tag]. AEAD AES-256-GCM, 96-bit random IV.
const VERSION_PREFIX = "v1:";
const BINARY_VERSION = 0x01;

export class CryptoError extends Error {
  constructor(reason: string) {
    super(`envelope error: ${reason}`);
    this.name = "CryptoError";
  }
}

// Call at startup so a bad key fails loudly, not on first encrypt.
export function assertValidEncryptionKey(key: Buffer): void {
  if (key.length !== KEY_LENGTH) {
    throw new CryptoError(
      `encryption key must be ${KEY_LENGTH} bytes (got ${key.length}); ENCRYPTION_KEY should be 64 hex chars`,
    );
  }
}

export function encrypt(plaintext: string, key: Buffer): string {
  assertValidEncryptionKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([iv, ciphertext, tag]).toString("base64");
  return `${VERSION_PREFIX}${envelope}`;
}

export function decrypt(ciphertext: string, key: Buffer): string {
  assertValidEncryptionKey(key);
  const envelope = stripVersionPrefix(ciphertext);
  const data = Buffer.from(envelope, "base64");
  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new CryptoError("ciphertext shorter than iv+tag");
  }
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(data.length - TAG_LENGTH);
  const body = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(body, undefined, "utf8") + decipher.final("utf8");
}

// Binary form for bytea blobs — skips the base64 round-trip the string form does.
export function encryptBytes(plaintext: Buffer, key: Buffer): Buffer {
  assertValidEncryptionKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([BINARY_VERSION]), iv, ciphertext, tag]);
}

export function decryptBytes(envelope: Buffer, key: Buffer): Buffer {
  assertValidEncryptionKey(key);
  if (envelope.length < 1 + IV_LENGTH + TAG_LENGTH) {
    throw new CryptoError("envelope shorter than header+iv+tag");
  }
  const version = envelope[0];
  if (version !== BINARY_VERSION) {
    throw new CryptoError(`unsupported binary envelope version ${version}`);
  }
  const iv = envelope.subarray(1, 1 + IV_LENGTH);
  const tag = envelope.subarray(envelope.length - TAG_LENGTH);
  const body = envelope.subarray(1 + IV_LENGTH, envelope.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function encryptConfig(
  config: InstanceConfig,
  key: Buffer,
): InstanceConfig {
  return {
    ...config,
    provider: {
      ...config.provider,
      apiKey: encrypt(config.provider.apiKey, key),
    },
    channels: config.channels.map((ch) => encryptChannel(ch, key)),
    ...(config.integrations
      ? { integrations: { ...config.integrations, relayToken: encrypt(config.integrations.relayToken, key) } }
      : {}),
  };
}

export function decryptConfig(
  config: InstanceConfig,
  key: Buffer,
): InstanceConfig {
  return {
    ...config,
    provider: {
      ...config.provider,
      apiKey: decrypt(config.provider.apiKey, key),
    },
    channels: config.channels.map((ch) => decryptChannel(ch, key)),
    ...(config.integrations
      ? { integrations: { ...config.integrations, relayToken: decrypt(config.integrations.relayToken, key) } }
      : {}),
  };
}

function stripVersionPrefix(value: string): string {
  return value.startsWith(VERSION_PREFIX)
    ? value.slice(VERSION_PREFIX.length)
    : value;
}

function encryptChannel(ch: ChannelConfig, key: Buffer): ChannelConfig {
  switch (ch.type) {
    case "telegram":
      return ch.botToken ? { ...ch, botToken: encrypt(ch.botToken, key) } : ch;
    case "discord":
      return { ...ch, token: encrypt(ch.token, key) };
    case "slack":
      return {
        ...ch,
        botToken: encrypt(ch.botToken, key),
        appToken: encrypt(ch.appToken, key),
      };
    case "whatsapp":
      return ch;
  }
}

function decryptChannel(ch: ChannelConfig, key: Buffer): ChannelConfig {
  switch (ch.type) {
    case "telegram":
      return ch.botToken ? { ...ch, botToken: decrypt(ch.botToken, key) } : ch;
    case "discord":
      return { ...ch, token: decrypt(ch.token, key) };
    case "slack":
      return {
        ...ch,
        botToken: decrypt(ch.botToken, key),
        appToken: decrypt(ch.appToken, key),
      };
    case "whatsapp":
      return ch;
  }
}
