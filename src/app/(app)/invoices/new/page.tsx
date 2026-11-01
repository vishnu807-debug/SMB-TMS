import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { InvoiceDraftEditor } from "@/components/finance/invoice-draft-editor";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  await requirePermission("invoice.create");
  const supabase = await createClient();
  const [{ data: customers }, { data: tax }, { data: terms }, { data: cur }, { data: settings }] = await Promise.all([
    supabase.from("customers").select("id, name, currency_code").in("status", ["active", "on_hold"]).order("name"),
    supabase.from("tax_codes").select("id, code, rate").eq("is_active", true).order("code"),
    supabase.from("payment_terms").select("id, name").eq("is_active", true).order("name"),
    supabase.from("currencies").select("code").eq("is_active", true).order("code"),
    supabase.from("company_settings").select("base_currency, invoice_terms").single(),
  ]);
  const base = settings?.base_currency ?? "AED";
  return (
    <>
      <PageHeader title="Invoice without a sales order" back={{ href: "/invoices", label: "Invoices" }}
        description="For services or charges not on an order. Goods should be invoiced from their delivery notes so stock and invoicing stay matched." />
      <InvoiceDraftEditor isNew customers={customers ?? []} currencies={cur ?? []} baseCurrency={base}
        invoice={{ invoice_date: new Date().toISOString().slice(0, 10), currency_code: base, terms: settings?.invoice_terms ?? "" }}
        lines={[{ key: "new", fromDelivery: false, description: "", uom_code: "", qty: "1", unit_price: "", discount_pct: 0, tax_code_id: (tax ?? []).find((t) => t.code === "SR")?.id ?? "" }]}
        taxCodes={(tax ?? []).map((t) => ({ ...t, rate: Number(t.rate) }))} paymentTerms={terms ?? []} />
    </>
  );
}
