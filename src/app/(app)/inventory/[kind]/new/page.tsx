import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { DOC_KINDS, isDocKind } from "@/lib/inventory-config";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { StockDocumentForm, type DocFormInitial } from "@/components/inventory/stock-document-form";
import { loadDocLookups, loadPoForReceipt } from "../../lookups";

export const metadata: Metadata = { title: "New stock document" };

export default async function NewDocPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ po?: string }> }) {
  const { kind } = await params;
  const { po: poId } = await searchParams;
  if (!isDocKind(kind)) notFound();
  const cfg = DOC_KINDS[kind];
  const user = await requirePermission(cfg.createPermission);
  const lookups = await loadDocLookups(user);

  let initial: DocFormInitial | undefined;
  let problem: string | null = null;
  if (kind === "receipts" && poId && /^[0-9a-f-]{36}$/i.test(poId)) {
    const r = await loadPoForReceipt(poId);
    if (!r) problem = "Purchase order not found.";
    else if (!["approved", "sent", "partially_received"].includes(r.po.status)) problem = `${r.po.doc_no} is not open for receiving.`;
    else {
      const due = r.lines.filter((l) => l.remaining > 0);
      if (due.length === 0) problem = `Everything on ${r.po.doc_no} has been received (or is on a draft receipt).`;
      initial = {
        purchaseOrder: { id: r.po.id, doc_no: r.po.doc_no, supplier: r.po.supplier, currency_code: r.po.currency_code },
        header: { warehouse_id: r.po.warehouse_id, receipt_date: new Date().toISOString().slice(0, 10), currency_code: r.po.currency_code },
        lines: due.map((l) => ({ key: l.id, product: l.product, qty: String(l.remaining), unit_cost: l.unit_cost, unit_cost_base: "", mode: "change", qty_change: "",
          counted_qty: "", sales_order_line_id: "", notes: "", purchase_order_line_id: l.id, po_remaining: l.remaining, po_label: l.label })),
      };
    }
  }
  return (
    <>
      <PageHeader title={initial?.purchaseOrder ? `Receive ${initial.purchaseOrder.doc_no}` : `New ${cfg.singular.toLowerCase()}`}
        description="Saved as a draft. Stock only changes when the document is posted."
        back={initial?.purchaseOrder ? { href: `/purchase-orders/${initial.purchaseOrder.id}`, label: initial.purchaseOrder.doc_no } : { href: `/inventory/${kind}`, label: cfg.title }} />
      {problem ? <Alert tone="warning">{problem}</Alert> : <StockDocumentForm kind={kind} lookups={lookups} initial={initial} />}
    </>
  );
}
