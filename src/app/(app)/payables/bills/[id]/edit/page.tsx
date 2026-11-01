import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { BillForm } from "@/components/finance/bill-form";
import { loadBillLookups } from "@/lib/finance/lookups";
import { poLinesForBill } from "../../../actions";

export const metadata: Metadata = { title: "Edit supplier bill" };

export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("payable.manage");
  const supabase = await createClient();
  const [{ data: b }, { data: lines }, lookups] = await Promise.all([
    supabase.from("supplier_bills").select("*").eq("id", id).maybeSingle(),
    supabase.from("supplier_bill_lines").select("*, product:products(sku, uom:units_of_measure(code))").eq("bill_id", id).order("line_no"),
    loadBillLookups(),
  ]);
  if (!b) notFound();
  if (b.status !== "draft") redirect(`/payables/bills/${id}`);
  const po = b.purchase_order_id ? await poLinesForBill(b.purchase_order_id) : null;
  const initial = {
    id, supplier_id: b.supplier_id, purchase_order_id: b.purchase_order_id ?? "", supplier_invoice_no: b.supplier_invoice_no, supplier_trn: b.supplier_trn ?? "",
    bill_date: b.bill_date, due_date: b.due_date ?? "", currency_code: b.currency_code, exchange_rate: String(b.exchange_rate), notes: b.notes ?? "",
    lines: (lines ?? []).map((l: any) => {
      const pl = po?.lines.find((x) => x.id === l.purchase_order_line_id);
      return { key: l.id, purchase_order_line_id: l.purchase_order_line_id ?? undefined, description: l.description, sku: l.product?.sku, uom: l.product?.uom?.code,
        qty: String(Number(l.qty)), unit_cost: String(Number(l.unit_cost)), po_cost: l.po_unit_cost != null ? Number(l.po_unit_cost) : undefined,
        billable: pl ? pl.billable + Number(l.qty) : undefined, tax_code_id: l.tax_code_id };
    }),
  };
  return (
    <>
      <PageHeader title={`Edit ${b.doc_no}`} back={{ href: `/payables/bills/${id}`, label: b.doc_no }} />
      <BillForm {...lookups} initial={initial} />
    </>
  );
}
