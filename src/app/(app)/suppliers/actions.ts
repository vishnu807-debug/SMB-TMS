"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

const optUuid = z.union([z.literal(""), z.null(), z.string().uuid()]).transform((v) => v || undefined).optional();
const contact = z.object({
  id: optUuid, name: z.string().trim().min(1, "Each contact needs a name").max(120),
  designation: z.string().trim().max(80).optional(),
  email: z.union([z.literal(""), z.string().trim().email("Invalid contact email")]).optional(),
  phone: z.string().trim().max(40).optional(), is_primary: z.boolean().optional(),
});
const schema = z.object({
  id: optUuid,
  name: z.string().trim().min(2, "Enter the supplier name").max(200),
  trn: z.string().trim().regex(/^$|^\d{15}$/, "The TRN must be exactly 15 digits").optional(),
  trade_license_no: z.string().trim().max(60).optional(),
  category: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  address: z.string().trim().max(400).optional(),
  email: z.union([z.literal(""), z.string().trim().email("Invalid email")]).optional(),
  phone: z.string().trim().max(40).optional(),
  website: z.string().trim().max(200).optional(),
  currency_code: z.string().length(3),
  payment_term_id: optUuid,
  lead_time_days: z.coerce.number().int().min(0).max(365).optional(),
  bank_details: z.string().trim().max(1000).optional(),
  status: z.enum(["active", "on_hold", "blocked", "inactive"]),
  notes: z.string().trim().max(4000).optional(),
  contacts: z.array(contact).max(30),
});

export async function saveSupplier(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_supplier", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/suppliers");
  return { ok: true, data: { id: data as string } };
}
