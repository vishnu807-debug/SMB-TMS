"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";
import { str } from "@/lib/utils";

const company = z.object({
  legal_name: z.string().min(2, "Enter the legal name").max(200), trade_name: z.string().max(200),
  trn: z.string().regex(/^$|^\d{15}$/, "The TRN must be 15 digits"), address: z.string().max(400), city: z.string().max(80),
  phone: z.string().max(40), email: z.union([z.literal(""), z.string().email("Invalid email")]), website: z.string().max(200),
  bank_details: z.string().max(1000), quotation_validity_days: z.coerce.number().int().min(1).max(365),
  quotation_terms: z.string().max(8000), purchase_order_terms: z.string().max(8000), invoice_terms: z.string().max(8000), invoice_footer: z.string().max(300),
});

export async function saveCompany(_p: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  const parsed = company.safeParse(Object.fromEntries([...fd.keys()].map((k) => [k, str(fd.get(k))])));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = Object.fromEntries(Object.entries(parsed.data).map(([k, x]) => [k, x === "" && !k.endsWith("_terms") ? null : x]));
  const supabase = await createClient();
  const { error } = await supabase.from("company_settings").update(v).eq("id", true);
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: "Company settings saved." };
}

export async function saveEinvoicing(_p: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  const enabled = fd.get("einvoicing_enabled") === "on";
  const participant = str(fd.get("einvoice_participant_id"));
  if (enabled && !participant) return { ok: false, error: "Enter the Peppol participant ID issued by your service provider before enabling e-invoicing." };
  const supabase = await createClient();
  const { data: s } = await supabase.from("company_settings").select("trn").single();
  if (enabled && !s?.trn) return { ok: false, error: "Enter the company TRN first." };
  const { error } = await supabase.from("company_settings").update({ einvoicing_enabled: enabled, einvoice_provider: str(fd.get("einvoice_provider")) || null, einvoice_participant_id: participant || null }).eq("id", true);
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: enabled ? "E-invoicing is on: new invoices will be sent to the service provider." : "E-invoicing settings saved." };
}

export async function addExchangeRate(_p: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  const parsed = z.object({ currency_code: z.string().length(3), rate_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), rate_to_base: z.coerce.number().positive("Enter a rate above zero") })
    .safeParse({ currency_code: str(fd.get("currency_code")), rate_date: str(fd.get("rate_date")), rate_to_base: str(fd.get("rate_to_base")) });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("exchange_rates").upsert(parsed.data, { onConflict: "currency_code,rate_date" });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: "Rate saved." };
}

export async function saveApprovalRule(_p: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: z.string().uuid(), threshold: z.coerce.number().min(0), is_active: z.boolean() })
    .safeParse({ id: str(fd.get("id")), threshold: str(fd.get("threshold")), is_active: fd.get("is_active") === "on" });
  if (!parsed.success) return { ok: false, error: "Invalid value." };
  const supabase = await createClient();
  const { error } = await supabase.from("approval_rules").update({ threshold: parsed.data.threshold, is_active: parsed.data.is_active }).eq("id", parsed.data.id);
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: "Rule updated." };
}

export async function addBankAccount(_p: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  const parsed = z.object({
    name: z.string().min(2, "Enter a name").max(80), kind: z.enum(["bank", "cash", "card"]), bank_name: z.string().max(80),
    account_no: z.string().max(40), iban: z.string().regex(/^$|^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/, "Invalid IBAN"), currency_code: z.string().length(3),
  }).safeParse({ name: str(fd.get("name")), kind: str(fd.get("kind")) || "bank", bank_name: str(fd.get("bank_name")), account_no: str(fd.get("account_no")),
    iban: str(fd.get("iban")).replace(/\s/g, "").toUpperCase(), currency_code: str(fd.get("currency_code")) });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const v = Object.fromEntries(Object.entries(parsed.data).map(([k, x]) => [k, x === "" ? null : x]));
  const { error } = await supabase.from("bank_accounts").insert(v);
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: "Account added." };
}

export async function setBankAccountActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("bank_accounts").update({ is_active: active }).eq("id", id);
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/settings");
  return { ok: true };
}
