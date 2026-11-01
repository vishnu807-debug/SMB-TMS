import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BillFormProps } from "@/components/finance/bill-form";

export async function loadBillLookups(): Promise<Omit<BillFormProps, "initial">> {
  const supabase = await createClient();
  const [{ data: sup }, { data: pos }, { data: tax }, { data: cur }, { data: settings }] = await Promise.all([
    supabase.from("suppliers").select("id, name, currency_code, trn").order("name"),
    supabase.from("purchase_orders").select("id, doc_no, supplier_id").in("status", ["approved", "sent", "partially_received", "received", "closed"]).order("doc_no", { ascending: false }).limit(500),
    supabase.from("tax_codes").select("id, code, rate").eq("is_active", true).order("code"),
    supabase.from("currencies").select("code").eq("is_active", true).order("code"),
    supabase.from("company_settings").select("base_currency").single(),
  ]);
  return { suppliers: sup ?? [], openPos: pos ?? [], taxCodes: (tax ?? []).map((t) => ({ ...t, rate: Number(t.rate) })), currencies: cur ?? [], baseCurrency: settings?.base_currency ?? "AED" };
}
