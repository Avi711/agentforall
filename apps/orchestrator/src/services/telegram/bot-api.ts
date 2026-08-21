import { z } from "zod";

const TelegramUserSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean(),
  first_name: z.string(),
  username: z.string().optional(),
});
export type TelegramUser = z.infer<typeof TelegramUserSchema>;

const ManagedBotUpdatedSchema = z.object({
  user: TelegramUserSchema,
  bot: TelegramUserSchema,
});
export type ManagedBotUpdated = z.infer<typeof ManagedBotUpdatedSchema>;

const UpdateSchema = z
  .object({
    update_id: z.number().int(),
    managed_bot: ManagedBotUpdatedSchema.optional(),
  })
  .passthrough();
export type TelegramUpdate = z.infer<typeof UpdateSchema>;

const ResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error_code: z.number().int(),
    description: z.string().optional(),
  }),
]);

export class TelegramApiError extends Error {
  constructor(
    method: string,
    public readonly errorCode: number | null,
    description: string,
  ) {
    super(`telegram ${method} failed: ${description}`);
    this.name = "TelegramApiError";
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

export class TelegramBotApi {
  constructor(
    private readonly token: string,
    private readonly apiRoot = "https://api.telegram.org",
  ) {}

  async getMe(): Promise<TelegramUser> {
    return TelegramUserSchema.parse(await this.call("getMe", {}));
  }

  // Long poll; requestTimeoutMs must exceed timeoutSeconds so Telegram closes first.
  async getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]> {
    const result = await this.call(
      "getUpdates",
      { offset, timeout: timeoutSeconds, allowed_updates: ["managed_bot"] },
      (timeoutSeconds + 10) * 1000,
    );
    return z.array(UpdateSchema).parse(result);
  }

  async getManagedBotToken(botUserId: number): Promise<string> {
    return z.string().min(1).parse(
      await this.call("getManagedBotToken", { user_id: botUserId }),
    );
  }

  // Revokes the current token; we discard the returned replacement.
  async replaceManagedBotToken(botUserId: number): Promise<void> {
    await this.call("replaceManagedBotToken", { user_id: botUserId });
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.call("sendMessage", { chat_id: chatId, text });
  }

  async setManagedBotAccessSettings(
    botUserId: number,
    isAccessRestricted: boolean,
  ): Promise<void> {
    await this.call("setManagedBotAccessSettings", {
      user_id: botUserId,
      is_access_restricted: isAccessRestricted,
    });
  }

  private async call(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.apiRoot}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new TelegramApiError(
        method,
        null,
        err instanceof Error ? err.message : "network error",
      );
    }

    const parsed = ResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      // errorCode stays null: HTTP status is not a Telegram error_code.
      throw new TelegramApiError(method, null, `unexpected response shape (http ${res.status})`);
    }
    if (!parsed.data.ok) {
      throw new TelegramApiError(
        method,
        parsed.data.error_code,
        parsed.data.description ?? `error ${parsed.data.error_code}`,
      );
    }
    return parsed.data.result;
  }
}
