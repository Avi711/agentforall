import { z } from "zod";
import { ADMIN_GRANT_MAX_CREDITS } from "../billing/pricing";

export const GrantCreditsBodySchema = z
  .object({
    userId: z.string().min(1).max(64),
    credits: z.number().int().min(1).max(ADMIN_GRANT_MAX_CREDITS),
    ref: z.string().uuid(),
  })
  .strict();
