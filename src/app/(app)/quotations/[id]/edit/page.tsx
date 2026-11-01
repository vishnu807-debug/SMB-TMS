import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { QuotationEditor, type QuoteLine } from "@/components/quotations/quotation-editor";
import { loadEditorData } from "../../editor-data";

export const metadata: Metadata = { title: "Edit quotation" };

export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("quotation.edit");
  const supabase = await createClient();
  const [{ data: q }, { data: lines }, { data: costs }, { data: stock }] = await Promise.all([
    supabase.from("quotations").select("*").eq("id", id).maybeSingle(),
    supabase.from("quotation_lines").select("*, product:products(id, sku, name, item_type, uom:units_of_measure(code))").eq("quotation_id", id).order("line_no"),
    supabase.from("quotation_line_costs").select("line_id, unit_cost").eq("quotation_id", id),
    supabase.from("v_product_stock").select("product_id, qty_available"),
  ]);
  if (!q) notFound();
  if (q.status !== "draft") redirect(`/quotations/${id}`);
  const cost = new Map((costs ?? []).map((c) => [c.line_id, c.unit_cost]));
  const avail = new Map((stock ?? []).map((s) => [s.product_id, Number(s.qty_available)]));
  const header: Record<string, any> = Object.fromEntries(Object.entries(q).map(([k, v]) => [k, typeof v === "number" ? String(v) : v]));
  const initLines: QuoteLine[] = (lines ?? []).map((l: any) => ({
    key: l.id, product: { id: l.product.id, sku: l.product.sku, name: l.product.name, uom: l.product.uom?.code ?? "" },
    description: l.description, qty: String(l.qty), unit_price: String(l.unit_price), discount_pct: String(l.discount_pct),
    tax_code_id: l.tax_code_id, fulfilment_mode: l.fulfilment_mode, mode_locked: true, lead_time_text: l.lead_time_text ?? "",
    unit_cost: cost.has(l.id) ? String(cost.get(l.id)) : "", available: l.product.item_type === "stock" ? avail.get(l.product.id) ?? 0 : null,
    item_type: l.product.item_type,
  }));
  return (
    <>
      <PageHeader title={`Edit ${q.doc_no}`} back={{ href: `/quotations/${id}`, label: q.doc_no }} />
      <QuotationEditor {...await loadEditorData(user)} initial={{ header, lines: initLines }} />
    </>
  );
}
