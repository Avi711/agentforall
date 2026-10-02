import { randomUUID } from "node:crypto";
import type { ProductEvent } from "../analytics/events";
import { errorMessage } from "../error-message";
import { SITE_URL } from "../site";
import { browserIdsFrom, type BrowserIds } from "./browser";
import { postServerEvents, type CapiSendResult, type ServerEvent } from "./client";
import type { CapiConfig } from "./config";
import { conversionsFor, type Conversion } from "./conversions";
import type { MetaIdentity } from "./repository";
import { buildUserData } from "./user-data";

export interface MetaAttributionStore {
  remember(userId: string, ids: BrowserIds): Promise<void>;
  findIdentity(userId: string): Promise<MetaIdentity | null>;
}

type SendEvents = (config: CapiConfig, events: ServerEvent[]) => Promise<CapiSendResult>;

export interface MetaConversionsDeps {
  config: CapiConfig | null;
  store: MetaAttributionStore;
  send?: SendEvents;
  now?: () => number;
  newEventId?: () => string;
}

const LOG_PREFIX = "[meta-capi]";

export class MetaConversions {
  private readonly config: CapiConfig | null;
  private readonly store: MetaAttributionStore;
  private readonly send: SendEvents;
  private readonly now: () => number;
  private readonly newEventId: () => string;

  constructor(deps: MetaConversionsDeps) {
    this.config = deps.config;
    this.store = deps.store;
    this.send = deps.send ?? postServerEvents;
    this.now = deps.now ?? Date.now;
    this.newEventId = deps.newEventId ?? randomUUID;
  }

  // Never throws, like track: a sign-in or purchase must not fail because its ad attribution could not be stored or sent.
  async rememberBrowser(userId: string, headers: Headers | undefined): Promise<void> {
    if (!this.config || !headers) return;
    try {
      await this.store.remember(userId, browserIdsFrom(headers, this.now()));
    } catch (err) {
      console.error(LOG_PREFIX, "storing browser ids failed", { userId, message: errorMessage(err) });
    }
  }

  async track(userId: string, event: ProductEvent): Promise<void> {
    const config = this.config;
    const conversions = conversionsFor(event);
    if (!config || conversions.length === 0) return;
    try {
      const identity = await this.store.findIdentity(userId);
      if (!identity) return;
      // Meta rejects a website event without the browser's user agent.
      if (!identity.browser.userAgent) {
        console.warn(LOG_PREFIX, "no browser on record; conversion skipped", { userId, event: event.name });
        return;
      }
      const events = conversions.map((conversion) => this.serverEvent(userId, identity, conversion));
      const result = await this.send(config, events);
      if (!result.ok) {
        console.error(LOG_PREFIX, "conversion rejected", {
          event: event.name,
          status: result.status,
          errorCode: result.errorCode,
          fbtraceId: result.fbtraceId,
          error: result.error,
        });
      }
    } catch (err) {
      console.error(LOG_PREFIX, "conversion failed", { event: event.name, message: errorMessage(err) });
    }
  }

  private serverEvent(userId: string, identity: MetaIdentity, conversion: Conversion): ServerEvent {
    const { browser } = identity;
    return {
      event_name: conversion.eventName,
      event_time: Math.floor(this.now() / 1000),
      event_id: this.newEventId(),
      event_source_url: new URL(conversion.path, SITE_URL).toString(),
      action_source: "website",
      user_data: buildUserData({
        email: identity.email,
        name: identity.name ?? undefined,
        externalId: userId,
        clientIp: browser.clientIp ?? undefined,
        userAgent: browser.userAgent ?? undefined,
        fbp: browser.fbp ?? undefined,
        fbc: browser.fbc ?? undefined,
        countryCode: browser.country ?? undefined,
      }),
      ...(conversion.customData ? { custom_data: conversion.customData } : {}),
    };
  }
}
