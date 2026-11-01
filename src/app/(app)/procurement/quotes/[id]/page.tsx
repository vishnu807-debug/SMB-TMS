import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { SelectQuoteButton } from "@/components/procurement/quote-buttons";
import { formatDate, formatMoney, formatQty } from "@/lib/utils";

export const metadata: Metadata = { title: "Supplier quotation" };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission(["purchase_order.view", "purchase_requisition.manage"]);
  const supabase = await createClient();
  const [{ data: q }, { data: lines }, { data: pos }] = await Promise.all([
    supabase.from("supplier_quotations").select("*, supplier:suppliers(id, name), requisition:purchase_requisitions(id, doc_no), pterm:payment_terms(name)").eq("id", id).maybeSingle(),
    supabase.from("supplier_quotation_lines").select("*, product:products(id, sku, name, uom:units_of_measure(code))").eq("supplier_quotation_id", id).order("line_no"),
    supabase.from("purchase_orders").select("id, doc_no, status").eq("supplier_quotation_id", id),
  ]);
  if (!q) notFound();
  const total = (lines ?? []).reduce((a: number, l: any) => a + Number(l.qty) * Number(l.unit_price), 0);
  const mayPo = can(user, "purchase_order.create");
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3">{q.doc_no} <StatusBadge status={q.status} /></span>}
        description={<>{q.supplier?.name}{q.supplier_reference && ` · ref. ${q.supplier_reference}`}</>}
        back={q.requisition ? { href: `/procurement/requisitions/${q.requisition.id}`, label: q.requisition.doc_no } : { href: "/procurement?tab=quotes", label: "Supplier quotations" }}
        actions={mayPo && <>
          {q.status === "received" && <SelectQuoteButton id={q.id} size="default" />}
          {q.status !== "rejected" && <Link href={`/purchase-orders/new?quote=${q.id}`} className={buttonVariants()}><ShoppingCart /> Create purchase order</Link>}
        </>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Prices</CardTitle></CardHeader>
          <Table>
            <THead><TR><TH>Item</TH><TH numeric>Qty</TH><TH numeric>Unit price</TH><TH numeric>Lead time</TH><TH numeric>Amount</TH></TR></THead>
            <TBody>
              {(lines ?? []).map((l: any) => (
                <TR key={l.id}>
                  <TD><span className="font-mono text-xs text-slate-500">{l.product?.sku}</span> {l.product?.name}{l.notes && <p className="text-xs text-slate-500">{l.notes}</p>}</TD>
                  <TD numeric>{formatQty(l.qty)} <span className="text-xs text-slate-400">{l.product?.uom?.code}</span></TD>
                  <TD numeric>{formatMoney(l.unit_price)}</TD>
                  <TD numeric>{l.lead_time_days != null ? `${l.lead_time_days} d` : "—"}</TD>
                  <TD numeric>{formatMoney(Number(l.qty) * Number(l.unit_price))}</TD>
                </TR>
              ))}
              <TR><TD colSpan={4} className="text-right font-medium">Net total</TD><TD numeric className="font-semibold">{formatMoney(total, q.currency_code)}</TD></TR>
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {([["Supplier", <Link key="s" href={`/suppliers/${q.supplier?.id}`} className="text-navy-800 hover:underline">{q.supplier?.name}</Link>],
                ["Quote date", formatDate(q.quote_date)], ["Valid until", formatDate(q.valid_until)],
                ["Currency", q.currency_code === "AED" ? "AED" : `${q.currency_code} @ ${Number(q.exchange_rate)}`],
                ["Delivery", q.delivery_days != null ? `${q.delivery_days} days` : "—"], ["Payment terms", q.pterm?.name ?? "—"],
                ["Purchase orders", (pos ?? []).length ? (pos ?? []).map((p) => <Link key={p.id} href={`/purchase-orders/${p.id}`} className="ml-2 font-mono text-xs text-navy-800 hover:underline">{p.doc_no}</Link>) : "—"],
              ] as [string, React.ReactNode][]).map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="text-right">{v}</dd></div>)}
            </dl>
            {q.notes && <p className="mt-4 whitespace-pre-line text-sm text-slate-600">{q.notes}</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
