import { Agent, fetch as undiciFetch } from "undici";
import type { RelayFetch } from "../../routes/mcp-relay.js";

// undici defaults to a 300s body-inactivity timeout, which would sever idle MCP notification streams.
export function createRelayFetch(): RelayFetch {
  const dispatcher = new Agent({
    bodyTimeout: 0,
    headersTimeout: 30_000,
    connect: { timeout: 10_000 },
  });
  return async (url, init) => {
    const res = await undiciFetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: init.signal,
      redirect: "manual",
      dispatcher,
    });
    return { status: res.status, headers: res.headers, body: res.body };
  };
}
