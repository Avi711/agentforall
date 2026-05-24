import { authenticatedHandler, errorJson } from "@/lib/auth/api";
import { botService } from "@/lib/bots/service";
import { BotIdParamsSchema } from "@/lib/bots/schemas";
import { z } from "zod";

const ExportJobQuerySchema = z.object({
  jobId: z.string().uuid(),
});

export const maxDuration = 15;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = BotIdParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) {
    return errorJson("invalid_params", 400, parsed.error.flatten());
  }
  const url = new URL(req.url);
  const query = ExportJobQuerySchema.safeParse({
    jobId: url.searchParams.get("jobId"),
  });
  if (!query.success) {
    return errorJson("invalid_params", 400, query.error.flatten());
  }

  return authenticatedHandler({}, async ({ userId }) => {
    const job = await botService.getBackupExport(
      userId,
      parsed.data.id,
      query.data.jobId,
    );
    return Response.json(job);
  })(req);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = BotIdParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) {
    return errorJson("invalid_params", 400, parsed.error.flatten());
  }

  return authenticatedHandler({}, async ({ userId }) => {
    const job = await botService.startBackupExport(userId, parsed.data.id);
    return Response.json(job, { status: 202 });
  })(req);
}
