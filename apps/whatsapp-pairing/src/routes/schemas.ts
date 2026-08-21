import { z } from "zod";

export const PhoneBodySchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(
      /^\+?[1-9]\d{9,14}$/,
      "phone must be E.164 (country code + number, 10-15 digits)",
    ),
});
