import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { SupplierQuoteForm, type QuoteLine } from "@/components/procurement/supplier-quote-form";
import { loadProcurementLookups } from "@/lib/procurement/lookups";

export const metadata: Metadata = { title: "Record supplier quotation" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ requisition?: string }> }) {
  await requirePermission("purchase_order.create");
  const { requisition } = await searchParams;
  const supabase = await createClient();
  const lookups = await loadProcurementLookups();
  let req: { id: string; doc_no: string } | undefined;
  let lines: QuoteLine[] | undefined;
  if (requisition && /^[0-9a-f-]{36}$/i.test(requisition)) {
    const [{ data: r }, { data: open }] = await Promise.all([
      supabase.from("purchase_requisitions").select("id, doc_no").eq("id", requisition).maybeSingle(),
      supabase.from("v_open_requisition_lines").select("id, product_id, sku, product_name, uom_code, qty_open").eq("requisition_id", requisition),
    ]);
    if (r) {
      req = r;
      lines = (open ?? []).map((o: any) => ({ key: o.id, requisition_line_id: o.id, product: { id: o.product_id, sku: o.sku, name: o.product_name, uom: o.uom_code },
        qty: String(Number(o.qty_open)), unit_price: "", lead_time_days: "", notes: "" }));
    }
  }
  return (
    <>
      <PageHeader title="Record supplier quotation" back={req ? { href: `/procurement/requisitions/${req.id}`, label: req.doc_no } : { href: "/procurement?tab=quotes", label: "Procurement" }}
        description="Enter the prices a supplier offered. Record several suppliers against the same requisition to compare them side by side." />
      <SupplierQuoteForm lookups={lookups} requisition={req} initialLines={lines} />
    </>
  );
}
