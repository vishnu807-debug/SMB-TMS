import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileText, ShoppingCart } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CancelLineButton, SelectQuoteButton } from "@/components/procurement/quote-buttons";
import { cn, formatDate, formatMoney, formatQty, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Requisition" };

export default async function RequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("purchase_requisition.manage");
  const supabase = await createClient();
  const [{ data: r }, { data: lines }, { data: open }, { data: quotes }] = await Promise.all([
    supabase.from("purchase_requisitions").select("*, sales_order:sales_orders(id, doc_no, customer:customers(name))").eq("id", id).maybeSingle(),
    supabase.from("purchase_requisition_lines").select("*, product:products(id, sku, name, uom:units_of_measure(code)), supplier:suppliers(name)").eq("requisition_id", id).order("created_at"),
    supabase.from("v_open_requisition_lines").select("id, qty_open").eq("requisition_id", id),
    supabase.from("supplier_quotations").select("id, doc_no, status, quote_date, valid_until, currency_code, exchange_rate, delivery_days, supplier:suppliers(name), lines:supplier_quotation_lines(requisition_line_id, product_id, qty, unit_price, lead_time_days)")
      .eq("requisition_id", id).order("quote_date"),
  ]);
  if (!r) notFound();
  const lineIds = (lines ?? []).map((l: any) => l.id);
  const { data: pos } = lineIds.length
    ? await supabase.from("purchase_order_lines").select("requisition_line_id, qty, purchase_order:purchase_orders(id, doc_no, status)").in("requisition_line_id", lineIds)
    : { data: [] as any[] };
  const openQty: Record<string, number> = Object.fromEntries((open ?? []).map((o: any) => [o.id as string, Number(o.qty_open)]));
  const anyOpen = Object.values(openQty).some((q) => q > 0);
  const mayPo = can(user, "purchase_order.create");
  const today = new Date().toISOString().slice(0, 10);

  // Cheapest quoted price per line (in AED) for highlighting.
  const best: Record<string, number> = {};
  (quotes ?? []).forEach((q: any) => q.lines.forEach((ql: any) => {
    const k = ql.requisition_line_id ?? ql.product_id;
    const base = Number(ql.unit_price) * Number(q.exchange_rate);
    if (best[k] === undefined || base < best[k]) best[k] = base;
  }));

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3">{r.doc_no} <StatusBadge status={r.status} /></span>}
        description={<>{humanize(r.source)}{r.sales_order && <> · for <Link href={`/sales-orders/${r.sales_order.id}`} className="text-navy-700 hover:underline">{r.sales_order.doc_no}</Link> ({r.sales_order.customer?.name})</>}
          {r.required_date && <> · required by {formatDate(r.required_date)}</>}</>}
        back={{ href: "/procurement?tab=requisitions", label: "Requisitions" }}
        actions={mayPo && anyOpen && <>
          <Link href={`/procurement/quotes/new?requisition=${id}`} className={buttonVariants({ variant: "outline" })}><FileText /> Record supplier quote</Link>
          <Link href={`/purchase-orders/new?lines=${Object.entries(openQty).filter(([, q]) => q > 0).map(([k]) => k).join(",")}`} className={buttonVariants()}><ShoppingCart /> Create purchase order</Link>
        </>} />
      {r.notes && <p className="mb-6 whitespace-pre-line text-sm text-slate-600">{r.notes}</p>}

      <Card className="mb-6">
        <CardHeader><CardTitle>Items</CardTitle></CardHeader>
        <Table>
          <THead><TR><TH>Item</TH><TH numeric>Requested</TH><TH numeric>On POs</TH><TH numeric>Still to order</TH><TH>Purchase orders</TH><TH>Suggested supplier</TH><TH /></TR></THead>
          <TBody>
            {(lines ?? []).length === 0 && <EmptyRow colSpan={7}>No items.</EmptyRow>}
            {(lines ?? []).map((l: any) => {
              const left = openQty[l.id] ?? 0;
              const linked = (pos ?? []).filter((p: any) => p.requisition_line_id === l.id && p.purchase_order?.status !== "cancelled");
              return (
                <TR key={l.id} className={l.is_cancelled ? "opacity-50" : ""}>
                  <TD><span className="font-mono text-xs text-slate-500">{l.product?.sku}</span> {l.description}{l.is_cancelled && <span className="ml-2 text-xs">(cancelled)</span>}</TD>
                  <TD numeric>{formatQty(l.qty)} <span className="text-xs text-slate-400">{l.product?.uom?.code}</span></TD>
                  <TD numeric>{formatQty(l.qty_ordered)}</TD>
                  <TD numeric className={left > 0 ? "font-medium text-amber-700" : "text-emerald-700"}>{l.is_cancelled ? "—" : formatQty(left)}</TD>
                  <TD>{linked.length === 0 ? "—" : linked.map((p: any) => (
                    <Link key={p.purchase_order.id} href={`/purchase-orders/${p.purchase_order.id}`} className="mr-2 font-mono text-xs text-navy-800 hover:underline">{p.purchase_order.doc_no}</Link>))}</TD>
                  <TD>{l.supplier?.name ?? "—"}</TD>
                  <TD className="text-right">{!l.is_cancelled && !l.sales_order_line_id && left === Number(l.qty) && <CancelLineButton id={l.id} />}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader><CardTitle>Supplier quotation comparison</CardTitle></CardHeader>
        {(quotes ?? []).length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">No quotations recorded yet. Ask two or three suppliers for prices and record them here to compare.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left uppercase tracking-wide">Item</th>
                  {(quotes ?? []).map((q: any) => (
                    <th key={q.id} className="min-w-[180px] px-4 py-2.5 text-right align-top">
                      <Link href={`/procurement/quotes/${q.id}`} className="font-semibold text-navy-800 hover:underline">{q.supplier?.name}</Link>
                      <div className="font-normal">{q.doc_no} · {q.currency_code}</div>
                      <div className="mt-1"><StatusBadge status={q.status} /></div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(lines ?? []).filter((l: any) => !l.is_cancelled).map((l: any) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5"><span className="font-mono text-xs text-slate-500">{l.product?.sku}</span> {l.description}</td>
                    {(quotes ?? []).map((q: any) => {
                      const ql = q.lines.find((x: any) => x.requisition_line_id === l.id) ?? q.lines.find((x: any) => !x.requisition_line_id && x.product_id === l.product_id);
                      const isBest = ql && Math.abs(Number(ql.unit_price) * Number(q.exchange_rate) - best[ql.requisition_line_id ?? ql.product_id]) < 0.00005;
                      return (
                        <td key={q.id} className={cn("px-4 py-2.5 text-right tabular-nums", isBest && "bg-emerald-50 font-semibold text-emerald-800")}>
                          {ql ? <>{formatMoney(ql.unit_price)}<p className="text-xs font-normal text-slate-500">qty {formatQty(ql.qty)}{ql.lead_time_days != null ? ` · ${ql.lead_time_days} d` : ""}</p></> : <span className="text-slate-400">not quoted</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="bg-slate-50 font-medium">
                  <td className="px-4 py-2.5">Total (net) · valid until</td>
                  {(quotes ?? []).map((q: any) => (
                    <td key={q.id} className="px-4 py-2.5 text-right">
                      {formatMoney(q.lines.reduce((a: number, x: any) => a + Number(x.qty) * Number(x.unit_price), 0), q.currency_code)}
                      <p className={cn("text-xs font-normal", q.valid_until && q.valid_until < today ? "text-red-600" : "text-slate-500")}>{formatDate(q.valid_until)}</p>
                      {mayPo && anyOpen && (
                        <div className="mt-2 flex justify-end gap-2">
                          {q.status === "received" && <SelectQuoteButton id={q.id} />}
                          {q.status === "selected" && <Link href={`/purchase-orders/new?quote=${q.id}`} className={buttonVariants({ size: "sm" })}><ShoppingCart /> Order</Link>}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Green = lowest price per item after converting to AED.</p>
          </div>
        )}
      </Card>
    </>
  );
}
