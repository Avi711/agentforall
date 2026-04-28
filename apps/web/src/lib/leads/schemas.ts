import { z } from "zod";

export const LeadSubmissionSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Invalid email address").max(255),
  phone: z
    .string()
    .regex(
      /^05\d-\d{7}$/,
      "Phone must be a valid 10-digit number starting with 05",
    ),
  platform: z.enum(["whatsapp", "telegram", "both"]),
  interest: z.string().max(500).optional(),
  eventId: z.string().uuid().optional(),
});

export type LeadSubmission = z.infer<typeof LeadSubmissionSchema>;

export const AdminLeadIdSchema = z.object({
  id: z.string().uuid(),
});
