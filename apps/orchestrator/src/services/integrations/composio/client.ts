import { z } from "zod";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1_000;
const PAGE_SIZE = 100;
// ~1,400 managed toolkits today; the cap only guards against a runaway cursor.
const MAX_PAGES = 40;

export class ComposioApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`Composio ${path} failed: ${status} ${body.slice(0, 200)}`);
    this.name = "ComposioApiError";
  }
}

const SessionResponse = z
  .object({
    session_id: z.string().min(1),
    mcp: z.object({ url: z.string().url() }).passthrough(),
  })
  .passthrough();
export type ComposioSession = z.infer<typeof SessionResponse>;

const LinkResponse = z
  .object({
    redirect_url: z.string().url(),
    connected_account_id: z.string().min(1),
  })
  .passthrough();
export type ComposioLink = z.infer<typeof LinkResponse>;

// Field names beyond id/status are tolerated as optional: the wire shape is versioned by Composio.
const ConnectedAccount = z
  .object({
    id: z.string().min(1),
    status: z.string(),
    toolkit: z.object({ slug: z.string() }).passthrough().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();
export type ComposioConnectedAccount = z.infer<typeof ConnectedAccount>;

const ConnectedAccountsPage = z
  .object({
    items: z.array(ConnectedAccount),
    next_cursor: z.string().nullable().optional(),
  })
  .passthrough();

const Toolkit = z
  .object({
    slug: z.string().min(1),
    name: z.string(),
    no_auth: z.boolean().optional(),
    meta: z
      .object({
        logo: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        categories: z
          .array(z.object({ id: z.string().optional(), name: z.string().optional() }).passthrough())
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ComposioToolkit = z.infer<typeof Toolkit>;

const ToolkitsPage = z
  .object({
    items: z.array(Toolkit),
    next_cursor: z.string().nullable().optional(),
  })
  .passthrough();

export interface CreateSessionRequest {
  userId: string;
  callbackUrl: string;
}

export class ComposioClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  authHeaders(): Record<string, string> {
    return { "x-api-key": this.apiKey };
  }

  async createSession(input: CreateSessionRequest): Promise<ComposioSession> {
    const body = {
      user_id: input.userId,
      manage_connections: {
        enable: true,
        callback_url: input.callbackUrl,
        enable_wait_for_connections: true,
        // Removal stays a dashboard action; the agent must not be able to drop a connection.
        enable_connection_removal: false,
      },
    };
    const json = await this.request("POST", "/api/v3.1/tool_router/session", body);
    return SessionResponse.parse(json);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request("DELETE", `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}`, undefined, {
      tolerate404: true,
      retry: true,
    });
  }

  async createLink(sessionId: string, toolkit: string, callbackUrl: string): Promise<ComposioLink> {
    const json = await this.request(
      "POST",
      `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}/link`,
      { toolkit, callback_url: callbackUrl },
    );
    return LinkResponse.parse(json);
  }

  async listConnectedAccounts(userId: string): Promise<ComposioConnectedAccount[]> {
    const items: ComposioConnectedAccount[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ user_ids: userId, limit: String(PAGE_SIZE) });
      if (cursor) params.set("cursor", cursor);
      const json = await this.request("GET", `/api/v3/connected_accounts?${params}`, undefined, {
        retry: true,
      });
      const parsed = ConnectedAccountsPage.parse(json);
      items.push(...parsed.items);
      cursor = parsed.next_cursor;
      if (!cursor) break;
    }
    return items;
  }

  async deleteConnectedAccount(id: string): Promise<void> {
    await this.request(
      "DELETE",
      `/api/v3/connected_accounts/${encodeURIComponent(id)}?revoke_on_delete=true`,
      undefined,
      { tolerate404: true, retry: true },
    );
  }

  async listToolkits(): Promise<ComposioToolkit[]> {
    const items: ComposioToolkit[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        managed_by: "composio",
        sort_by: "usage",
        limit: String(PAGE_SIZE),
      });
      if (cursor) params.set("cursor", cursor);
      const json = await this.request("GET", `/api/v3/toolkits?${params}`, undefined, { retry: true });
      const parsed = ToolkitsPage.parse(json);
      items.push(...parsed.items);
      cursor = parsed.next_cursor;
      if (!cursor) break;
    }
    return items;
  }

  // Retries only where the caller marked the call idempotent; session/link POSTs are not.
  private async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    opts: { tolerate404?: boolean; retry?: boolean } = {},
  ): Promise<unknown> {
    const attempts = opts.retry ? MAX_ATTEMPTS : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      try {
        return await this.requestOnce(method, path, body, opts.tolerate404 ?? false);
      } catch (err) {
        lastError = err;
        if (!isTransient(err)) throw err;
      }
    }
    throw lastError;
  }

  private async requestOnce(
    method: string,
    path: string,
    body: unknown,
    tolerate404: boolean,
  ): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        ...this.authHeaders(),
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (res.status === 404 && tolerate404) return null;
    if (!res.ok) throw new ComposioApiError(res.status, path, text);
    return text ? (JSON.parse(text) as unknown) : null;
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof ComposioApiError) return err.status === 429 || err.status >= 500;
  return !(err instanceof z.ZodError);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
