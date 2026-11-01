import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function loadProcurementLookups() {
  const supabase = await createClient();
  const [cur, terms, dterms, wh, sup, tax, settings] = await Promise.all([
    supabase.from("currencies").select("code").eq("is_active", true).order("code"),
    supabase.from("payment_terms").select("id, name").eq("is_active", true).order("name"),
    supabase.from("delivery_terms").select("id, code, name").eq("is_active", true).order("code"),
    supabase.from("warehouses").select("id, code, name").eq("is_active", true).order("code"),
    supabase.from("suppliers").select("id, code, name, currency_code, payment_term_id, status").in("status", ["active", "on_hold"]).order("name"),
    supabase.from("tax_codes").select("id, code, name, rate, is_default").eq("is_active", true).order("code"),
    supabase.from("company_settings").select("base_currency").single(),
  ]);
  return {
    currencies: cur.data ?? [],
    paymentTerms: terms.data ?? [],
    deliveryTerms: dterms.data ?? [],
    warehouses: wh.data ?? [],
    suppliers: sup.data ?? [],
    taxCodes: tax.data ?? [],
    baseCurrency: settings.data?.base_currency ?? "AED",
  };
}
export type ProcurementLookups = Awaited<ReturnType<typeof loadProcurementLookups>>;
