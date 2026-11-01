import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function loadSalesLookups() {
  const supabase = await createClient();
  const [pt, dt, cur, tax, reps, settings] = await Promise.all([
    supabase.from("payment_terms").select("id, name, days").eq("is_active", true).order("days"),
    supabase.from("delivery_terms").select("id, code, name").eq("is_active", true).order("code"),
    supabase.from("currencies").select("code, name").eq("is_active", true).order("code"),
    supabase.from("tax_codes").select("id, code, name, rate, is_default").eq("is_active", true).order("rate", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name"),
    supabase.from("company_settings").select("base_currency, quotation_validity_days, quotation_terms").single(),
  ]);
  return {
    paymentTerms: pt.data ?? [],
    deliveryTerms: dt.data ?? [],
    currencies: cur.data ?? [],
    taxCodes: tax.data ?? [],
    reps: reps.data ?? [],
    baseCurrency: settings.data?.base_currency ?? "AED",
    validityDays: settings.data?.quotation_validity_days ?? 30,
    defaultTerms: settings.data?.quotation_terms ?? "",
  };
}
export type SalesLookups = Awaited<ReturnType<typeof loadSalesLookups>>;
