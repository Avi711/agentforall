import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse, after } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { leads } from "@agent-forall/db";
import { sendLeadEvent } from "@/lib/meta-capi";

// Singleton pool to avoid connection exhaustion during dev hot reloads
const globalForDb = globalThis as unknown as { pool: Pool };
const pool = globalForDb.pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;
const db = drizzle(pool);

// Per-IP sliding window. State is per-lambda-instance, so this is defense
// against bursts rather than a hard global cap. Pruned when it grows.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 5;
const RATE_MAP_CAP = 10_000;
const rateMap = new Map<string, number[]>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (rateMap.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_MAX_PER_WINDOW) return true;
  timestamps.push(now);
  rateMap.set(ip, timestamps);
  if (rateMap.size > RATE_MAP_CAP) {
    // Drop the oldest entries — Map preserves insertion order.
    const toDrop = rateMap.size - RATE_MAP_CAP;
    const keys = rateMap.keys();
    for (let i = 0; i < toDrop; i++) rateMap.delete(keys.next().value!);
  }
  return false;
}

// Vercel appends the real client IP as the rightmost X-Forwarded-For value.
// The leftmost value is the client-claimed header and is trivially spoofable,
// so we can't use it for rate limiting or as client_ip_address for CAPI.
function extractClientIp(xff: string | null): string | null {
  if (!xff) return null;
  const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.at(-1) ?? null;
}

const LeadSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Invalid email address").max(255),
  phone: z.string().regex(/^05\d-\d{7}$/, "Phone must be a valid 10-digit number starting with 05"),
  platform: z.enum(["whatsapp", "telegram", "both"]),
  interest: z.string().max(500).optional(),
  eventId: z.string().uuid().optional(),
});

// Postgres unique_violation — would fire if a unique index is added on email.
const PG_UNIQUE_VIOLATION = "23505";

export async function POST(request: Request) {
  const requestHeaders = await headers();
  const requestCookies = await cookies();

  const clientIp =
    extractClientIp(requestHeaders.get("x-forwarded-for")) ??
    requestHeaders.get("x-real-ip") ??
    null;
  const rateKey = clientIp ?? "unknown";
  if (isRateLimited(rateKey)) {
    return NextResponse.json({ error: "יותר מדי בקשות. נסו שוב בעוד דקה." }, { status: 429 });
  }

  let data: z.infer<typeof LeadSchema>;
  try {
    data = LeadSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "Invalid input" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let duplicate = false;
  try {
    const existing = await db
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.email, data.email))
      .limit(1);

    if (existing.length > 0) {
      duplicate = true;
    } else {
      await db.insert(leads).values({
        name: data.name,
        email: data.email,
        phone: data.phone,
        platform: data.platform,
        interest: data.interest ?? null,
        source: "landing-page",
      });
    }
  } catch (err) {
    const pgError = err as { code?: string; constraint?: string };
    if (pgError.code === PG_UNIQUE_VIOLATION) {
      duplicate = true;
    } else {
      // Raw pg errors include bound parameter values (PII). Log only metadata.
      console.error("[lead] db error", { code: pgError.code, constraint: pgError.constraint });
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  }

  if (duplicate) {
    // Known lead — skip Pixel + CAPI to avoid double-attribution. A returning
    // submitter is counted once per waitlist, by product choice.
    return NextResponse.json({ success: true, duplicate: true });
  }

  const eventId = data.eventId ?? randomUUID();
  const eventSourceUrl = requestHeaders.get("referer") ?? undefined;
  const userAgent = requestHeaders.get("user-agent") ?? undefined;
  const fbp = requestCookies.get("_fbp")?.value;
  const fbc = requestCookies.get("_fbc")?.value;

  // Runs after the response is sent so the user never waits on Meta.
  // sendLeadEvent guarantees no-throw; we still wrap defensively.
  after(async () => {
    try {
      await sendLeadEvent({
        eventId,
        email: data.email,
        phone: data.phone,
        name: data.name,
        externalId: data.email.trim().toLowerCase(),
        clientIp: clientIp ?? undefined,
        userAgent,
        fbp,
        fbc,
        eventSourceUrl,
      });
    } catch (err) {
      console.error("[lead] capi dispatch error", err instanceof Error ? err.message : err);
    }
  });

  return NextResponse.json({ success: true });
}
