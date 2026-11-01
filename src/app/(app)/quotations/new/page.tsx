import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { QuotationEditor, type QuoteLine } from "@/components/quotations/quotation-editor";
import { loadEditorData } from "../editor-data";

export const metadata: Metadata = { title: "New quotation" };

export default async function NewQuotationPage({ searchParams }: { searchParams: Promise<{ customer?: string; lead?: string }> }) {
  const user = await requirePermission("quotation.create");
  const sp = await searchParams;
  const data = await loadEditorData(user);
  const supabase = await createClient();
  let initial: { header: Record<string, any>; lines: QuoteLine[] } | undefined;
  const today = new Date().toISOString().slice(0, 10);
  const valid = new Date(Date.now() + data.lookups.validityDays * 864e5).toISOString().slice(0, 10);
  const base = { quotation_date: today, valid_until: valid, currency_code: data.lookups.baseCurrency, exchange_rate: "1",
    terms_conditions: data.lookups.defaultTerms, sales_rep_id: user.id };

  if (sp.lead) {
    // Start from an enquiry: customer, subject and requirement lines carried over.
    const { data: lead } = await supabase.from("leads")
      .select("id, title, customer_id, currency_code, items:lead_items(description, qty, target_price, product:products(id, sku, name, item_type, uom:units_of_measure(code)))")
      .eq("id", sp.lead).maybeSingle();
    if (lead) {
      initial = {
        header: { ...base, customer_id: lead.customer_id, lead_id: lead.id, subject: lead.title },
        lines: (lead.items ?? []).filter((i: any) => i.product).map((i: any) => ({
          key: crypto.randomUUID(), product: { id: i.product.id, sku: i.product.sku, name: i.product.name, uom: i.product.uom?.code ?? "" },
          description: i.description, qty: String(i.qty), unit_price: i.target_price?.toString() ?? "", discount_pct: "0", tax_code_id: "",
          fulfilment_mode: i.product.item_type === "stock" ? "stock" : "procure", mode_locked: false, lead_time_text: "",
          unit_cost: "", available: null, item_type: i.product.item_type,
        })),
      };
    }
  } else if (sp.customer) {
    initial = { header: { ...base, customer_id: sp.customer }, lines: [] };
  }
  return (
    <>
      <PageHeader title="New quotation" description="The quotation number is assigned when you save." back={{ href: "/quotations", label: "Quotations" }} />
      <QuotationEditor {...data} initial={initial} />
    </>
  );
}
