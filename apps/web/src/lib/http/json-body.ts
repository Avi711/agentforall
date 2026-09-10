export type JsonBody = { ok: true; value: unknown } | { ok: false };

// An empty body reads as undefined, so a route whose body is optional can be called without one.
export async function readJsonBody(req: Request): Promise<JsonBody> {
  if (req.method === "GET" || req.method === "HEAD") return { ok: true, value: undefined };
  try {
    const text = await req.text();
    return { ok: true, value: text === "" ? undefined : (JSON.parse(text) as unknown) };
  } catch {
    // Malformed JSON (or a body stream that failed): the caller answers invalid_json.
    return { ok: false };
  }
}
