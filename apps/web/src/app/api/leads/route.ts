import { NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { leads } from "@agent-forall/db";

// Singleton pool to avoid connection exhaustion during dev hot reloads
const globalForDb = globalThis as unknown as { pool: Pool };
const pool = globalForDb.pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;
const db = drizzle(pool);

// Simple in-memory rate limiter (per IP, 5 submissions per minute)
const rateMap = new Map<string, number[]>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const window = 60_000;
  const max = 5;
  const timestamps = (rateMap.get(ip) ?? []).filter((t) => now - t < window);
  if (timestamps.length >= max) return true;
  timestamps.push(now);
  rateMap.set(ip, timestamps);
  return false;
}

const LeadSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Invalid email address").max(255),
  phone: z.string().regex(/^05\d-\d{7}$/, "Phone must be a valid 10-digit number starting with 05"),
  platform: z.enum(["whatsapp", "telegram", "both"]),
  interest: z.string().max(500).optional().default(""),
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "יותר מדי בקשות. נסו שוב בעוד דקה." }, { status: 429 });
  }

  try {
    const body = await request.json();
    const data = LeadSchema.parse(body);

    // Check for duplicate email
    const existing = await db
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.email, data.email))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ success: true });
    }

    await db.insert(leads).values({
      name: data.name,
      email: data.email,
      phone: data.phone || null,
      platform: data.platform,
      interest: data.interest || null,
      source: "landing-page",
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message || "Invalid input" },
        { status: 400 },
      );
    }
    console.error("[lead] error:", err);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 },
    );
  }
}
