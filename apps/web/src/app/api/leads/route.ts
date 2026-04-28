import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { leadService } from "@/lib/leads/service";
import { LeadSubmissionSchema } from "@/lib/leads/schemas";
import { extractClientIp } from "@/lib/http/client-ip";
import { createRateLimit } from "@/lib/rate-limit";

const rateLimit = createRateLimit({ windowMs: 60_000, max: 5 });

export async function POST(request: Request) {
  const requestHeaders = await headers();
  const requestCookies = await cookies();

  const clientIp =
    extractClientIp(requestHeaders.get("x-forwarded-for")) ??
    requestHeaders.get("x-real-ip") ??
    null;

  if (rateLimit.hit(clientIp ?? "unknown")) {
    return NextResponse.json(
      { error: "יותר מדי בקשות. נסו שוב בעוד דקה." },
      { status: 429 },
    );
  }

  let input: z.infer<typeof LeadSubmissionSchema>;
  try {
    input = LeadSubmissionSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const { duplicate } = await leadService.submit(input, {
      clientIp,
      userAgent: requestHeaders.get("user-agent") ?? undefined,
      referer: requestHeaders.get("referer") ?? undefined,
      fbp: requestCookies.get("_fbp")?.value,
      fbc: requestCookies.get("_fbc")?.value,
    });
    return NextResponse.json({
      success: true,
      ...(duplicate ? { duplicate: true } : {}),
    });
  } catch (err) {
    // Log only safe metadata. Raw pg errors include bound parameter values (PII).
    const e = err as { code?: string; constraint?: string };
    console.error("[lead] submit failed", {
      code: e.code,
      constraint: e.constraint,
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 },
    );
  }
}
