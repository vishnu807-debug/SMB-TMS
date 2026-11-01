"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

const optUuid = z.union([z.literal(""), z.null(), z.string().uuid()]).transform((v) => v || undefined).optional();
const optNum = z.union([z.literal(""), z.null(), z.coerce.number().min(0)]).transform((v) => (v === "" || v === null ? undefined : v)).optional();

const schema = z.object({
  id: optUuid,
  title: z.string().trim().min(3, "Enter a short title for the enquiry").max(200),
  source: z.enum(["phone", "email", "walk_in", "website", "referral", "exhibition", "existing_customer", "tender", "other"]),
  customer_id: optUuid,
  company_name: z.string().trim().max(200).optional(),
  contact_name: z.string().trim().max(120).optional(),
  contact_email: z.union([z.literal(""), z.string().trim().email("Invalid contact email")]).optional(),
  contact_phone: z.string().trim().max(40).optional(),
  requirement: z.string().trim().max(8000).optional(),
  estimated_value: optNum,
  currency_code: z.string().length(3),
  probability: z.coerce.number().int().min(0).max(100),
  expected_close_date: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]),
  owner_id: optUuid,
  items: z.array(z.object({
    product_id: optUuid, description: z.string().trim().min(1, "Each requirement line needs a description").max(500),
    qty: z.coerce.number().positive("Requirement quantities must be greater than zero"), target_price: optNum,
  })).max(100),
});

export async function saveLead(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!parsed.data.customer_id && !parsed.data.company_name) return { ok: false, error: "Choose an existing customer or enter the company name." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_lead", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/leads");
  return { ok: true, data: { id: data as string } };
}

export async function setLeadStage(id: string, stage: string, reason?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_lead_stage", { p_id: id, p_stage: stage, p_lost_reason: reason ?? null });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/leads/${id}`); revalidatePath("/leads");
  return { ok: true };
}

export async function reopenLead(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_lead", { p_id: id });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/leads/${id}`); revalidatePath("/leads");
  return { ok: true };
}

export async function convertLeadToCustomer(id: string): Promise<ActionResult<{ customerId: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("convert_lead_to_customer", { p_lead_id: id });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/leads/${id}`);
  return { ok: true, data: { customerId: data as string } };
}
