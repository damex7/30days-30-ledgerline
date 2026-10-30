import { z } from "zod";
import { ROLES } from "@/lib/permissions";
import { email, uuid } from "@/lib/validation/common";

export const inviteSchema = z.object({ email, role: z.enum(ROLES, { error: "Choose a role." }) });
export const roleChangeSchema = z.object({ userId: uuid, role: z.enum(ROLES) });
export const memberIdSchema = z.object({ userId: uuid });
