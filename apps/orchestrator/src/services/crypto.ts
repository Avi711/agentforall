import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { InstanceConfig, ChannelConfig } from "../domain/types.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

export function decrypt(ciphertext: string, key: Buffer): string {
  const data = Buffer.from(ciphertext, "base64");
  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("ciphertext too short");
  }
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(data.length - TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, "utf8") + decipher.final("utf8");
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
  };
}

function encryptChannel(ch: ChannelConfig, key: Buffer): ChannelConfig {
  switch (ch.type) {
    case "telegram":
      return { ...ch, botToken: encrypt(ch.botToken, key) };
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
      return { ...ch, botToken: decrypt(ch.botToken, key) };
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
