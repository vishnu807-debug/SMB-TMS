"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

const optUuid = z.union([z.literal(""), z.null(), z.string().uuid()]).transform((v) => v || undefined).optional();
const contact = z.object({
  id: optUuid, name: z.string().trim().min(1, "Each contact needs a name").max(120),
  designation: z.string().trim().max(80).optional(), email: z.union([z.literal(""), z.string().trim().email("Invalid contact email")]).optional(),
  phone: z.string().trim().max(40).optional(), mobile: z.string().trim().max(40).optional(), is_primary: z.boolean().optional(),
});
const address = z.object({
  id: optUuid, kind: z.enum(["billing", "shipping"]), label: z.string().trim().max(60).optional(),
  line1: z.string().trim().min(1, "Each address needs a first line").max(200), line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "Each address needs a city").max(80), emirate: z.string().trim().max(60).optional(),
  country: z.string().trim().max(80).optional(), po_box: z.string().trim().max(20).optional(), is_default: z.boolean().optional(),
});
const schema = z.object({
  id: optUuid,
  name: z.string().trim().min(2, "Enter the company name").max(200),
  customer_type: z.enum(["company", "government", "individual"]),
  trade_license_no: z.string().trim().max(60).optional(),
  trn: z.string().trim().regex(/^$|^\d{15}$/, "The TRN must be exactly 15 digits").optional(),
  vat_registered: z.boolean(),
  default_tax_code_id: optUuid,
  industry: z.string().trim().max(80).optional(),
  website: z.string().trim().max(200).optional(),
  email: z.union([z.literal(""), z.string().trim().email("Invalid email")]).optional(),
  phone: z.string().trim().max(40).optional(),
  currency_code: z.string().length(3),
  payment_term_id: optUuid,
  delivery_term_id: optUuid,
  credit_limit: z.coerce.number().min(0).optional(),
  account_manager_id: optUuid,
  status: z.enum(["active", "on_hold", "blocked", "inactive"]),
  source: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(4000).optional(),
  contacts: z.array(contact).max(50),
  addresses: z.array(address).max(30),
});

export async function saveCustomer(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (parsed.data.vat_registered && !parsed.data.trn) return { ok: false, error: "Enter the TRN for a VAT-registered customer." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_customer", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/customers");
  revalidatePath(`/customers/${data}`);
  return { ok: true, data: { id: data as string } };
}

export async function checkDuplicates(name: string, trn: string, email: string, excludeId?: string) {
  if (name.trim().length < 3 && !trn && !email) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("find_customer_duplicates", {
    p_name: name, p_trn: trn || null, p_email: email || null, p_exclude: excludeId || null,
  });
  return (data ?? []) as { id: string; code: string; name: string; match_reason: string }[];
}
