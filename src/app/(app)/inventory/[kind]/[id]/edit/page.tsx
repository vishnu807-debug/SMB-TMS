import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DOC_KINDS, isDocKind } from "@/lib/inventory-config";
import { PageHeader } from "@/components/layout/page-header";
import { StockDocumentForm, type DocLine } from "@/components/inventory/stock-document-form";
import { loadDocLookups, loadPoForReceipt } from "../../../lookups";

export const metadata: Metadata = { title: "Edit stock document" };

export default async function EditDocPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!isDocKind(kind)) notFound();
  const cfg = DOC_KINDS[kind];
  const user = await requirePermission(cfg.createPermission);
  const supabase = await createClient();
  const [{ data: doc }, { data: lines }] = await Promise.all([
    supabase.from(cfg.table).select("*").eq("id", id).maybeSingle(),
    supabase.from(cfg.linesTable).select("*, product:products(id, sku, name, uom:units_of_measure(code))").eq(cfg.parentKey, id).order("line_no"),
  ]);
  if (!doc) notFound();
  if (!["draft", "rejected"].includes(doc.status)) redirect(`/inventory/${kind}/${id}`);

  const header: Record<string, string | boolean | null> = {};
  Object.entries(doc).forEach(([k, v]) => { header[k] = typeof v === "number" ? String(v) : (v as string | boolean | null); });
  const initialLines: DocLine[] = (lines ?? []).map((l: any) => ({
    key: l.id,
    product: { id: l.product.id, sku: l.product.sku, name: l.product.name, uom: l.product.uom?.code ?? "" },
    qty: l.qty?.toString() ?? "", unit_cost: l.unit_cost?.toString() ?? "", unit_cost_base: l.unit_cost_base?.toString() ?? "",
    mode: l.mode ?? "change", qty_change: l.qty_change?.toString() ?? "", counted_qty: l.counted_qty?.toString() ?? "",
    sales_order_line_id: l.sales_order_line_id ?? "", notes: l.notes ?? "",
    purchase_order_line_id: l.purchase_order_line_id ?? undefined,
  }));
  let purchaseOrder;
  if (kind === "receipts" && doc.purchase_order_id) {
    const r = await loadPoForReceipt(doc.purchase_order_id, id);
    if (r) {
      purchaseOrder = { id: r.po.id, doc_no: r.po.doc_no, supplier: r.po.supplier, currency_code: r.po.currency_code };
      initialLines.forEach((l) => { const pl = r.lines.find((x) => x.id === l.purchase_order_line_id); if (pl) { l.po_remaining = pl.remaining; l.po_label = pl.label; } });
    }
  }
  return (
    <>
      <PageHeader title={`Edit ${doc.doc_no}`} back={{ href: `/inventory/${kind}/${id}`, label: doc.doc_no }} />
      <StockDocumentForm kind={kind} lookups={await loadDocLookups(user)} initial={{ header, lines: initialLines, purchaseOrder }} />
    </>
  );
}
