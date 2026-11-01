import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { PurchaseOrderActions, type PoAction } from "@/components/purchase-orders/po-actions";
import { formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/utils";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("purchase_order.view");
  const supabase = await createClient();
  const [{ data: po }, { data: lines }, { data: receipts }, { data: approvals }] = await Promise.all([
    supabase.from("purchase_orders").select(`*, supplier:suppliers(id, code, name, trn, email, phone), contact:supplier_contacts(name, email, phone),
      warehouse:warehouses(code, name), pterm:payment_terms(name), dterm:delivery_terms(code, name), quote:supplier_quotations(id, doc_no),
      creator:profiles!purchase_orders_created_by_fkey(full_name), approver:profiles!purchase_orders_approved_by_fkey(full_name)`).eq("id", id).maybeSingle(),
    supabase.from("purchase_order_lines").select(`*, product:products(id, sku, name, uom:units_of_measure(code)),
      sol:sales_order_lines(id, sales_order:sales_orders(id, doc_no, customer:customers(name))),
      rl:purchase_requisition_lines(id, requisition:purchase_requisitions(id, doc_no))`).eq("purchase_order_id", id).order("line_no"),
    supabase.from("goods_receipts").select("id, doc_no, receipt_date, status, supplier_reference").eq("purchase_order_id", id).order("receipt_date"),
    supabase.from("approval_requests").select("*, requester:profiles!approval_requests_requested_by_fkey(full_name), decider:profiles!approval_requests_decided_by_fkey(full_name)")
      .eq("doc_type", "purchase_order").eq("doc_id", id).order("requested_at", { ascending: false }),
  ]);
  if (!po) notFound();
  const p: any = po;
  const pending = (approvals ?? []).find((a) => a.status === "pending");

  const actions: PoAction[] = ["pdf"];
  const mayCreate = can(user, "purchase_order.create");
  const mayApprove = can(user, "purchase_order.approve");
  if (p.status === "draft" && mayCreate) actions.push("edit", "submit");
  if (p.status === "pending_approval") {
    if (mayCreate) actions.push("reopen");
    if (pending && can(user, pending.approver_permission) && (pending.requested_by !== user.id || can(user, "approval.self_approve"))) actions.push("reject", "approve");
  }
  if (p.status === "approved" && mayCreate) actions.push("send");
  if (["approved", "sent", "partially_received"].includes(p.status) && can(user, "inventory.receive")) actions.push("receive");
  if (["draft", "pending_approval", "approved", "sent"].includes(p.status) && mayApprove) actions.push("cancel");
  if (p.status === "partially_received" && mayApprove) actions.push("close");

  const facts: [string, React.ReactNode][] = [
    ["Supplier", <Link key="s" href={`/suppliers/${p.supplier?.id}`} className="text-navy-800 hover:underline">{p.supplier?.name}</Link>],
    ["Contact", p.contact ? `${p.contact.name}${p.contact.email ? ` · ${p.contact.email}` : ""}` : "—"],
    ["Order date", formatDate(p.order_date)], ["Expected", formatDate(p.expected_date)],
    ["Deliver to", `${p.warehouse?.name} (${p.warehouse?.code})`],
    ["Currency", p.currency_code === "AED" ? "AED" : `${p.currency_code} @ ${Number(p.exchange_rate)}`],
    ["Payment terms", p.pterm?.name ?? "—"], ["Delivery terms", p.dterm ? `${p.dterm.code} — ${p.dterm.name}` : "—"],
    ["Supplier ref.", p.supplier_reference ?? "—"],
    ["Supplier quote", p.quote ? p.quote.doc_no : "—"],
    ["Created by", p.creator?.full_name ?? "—"],
    ["Approved", p.approved_at ? `${p.approver?.full_name ?? ""} · ${formatDateTime(p.approved_at)}` : "—"],
  ];

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3">{p.doc_no} <StatusBadge status={p.status} /></span>}
        description={p.supplier?.name} back={{ href: "/purchase-orders", label: "Purchase orders" }}
        actions={<PurchaseOrderActions id={id} actions={actions} />} />
      {p.status === "pending_approval" && pending && <Alert tone="warning" className="mb-6">Waiting for approval: {pending.reasons.join("; ")}</Alert>}
      {p.status === "cancelled" && <Alert tone="info" className="mb-6">Cancelled: {p.cancel_reason}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Items</CardTitle></CardHeader>
          <Table>
            <THead><TR><TH>#</TH><TH>Item</TH><TH numeric>Ordered</TH><TH numeric>Received</TH><TH numeric>Billed</TH><TH numeric>Unit cost</TH><TH numeric>VAT</TH><TH numeric>Amount</TH></TR></THead>
            <TBody>
              {(lines ?? []).length === 0 && <EmptyRow colSpan={8}>No items.</EmptyRow>}
              {(lines ?? []).map((l: any) => (
                <TR key={l.id}>
                  <TD className="text-slate-400">{l.line_no}</TD>
                  <TD><Link href={`/products/${l.product?.id}`} className="hover:underline"><span className="font-mono text-xs text-slate-500">{l.product?.sku}</span> {l.description}</Link>
                    <div className="text-xs text-slate-500">
                      {l.sol?.sales_order && <>For <Link href={`/sales-orders/${l.sol.sales_order.id}`} className="text-navy-700 hover:underline">{l.sol.sales_order.doc_no}</Link> · {l.sol.sales_order.customer?.name} </>}
                      {l.rl?.requisition && <>· <Link href={`/procurement/requisitions/${l.rl.requisition.id}`} className="hover:underline">{l.rl.requisition.doc_no}</Link></>}
                    </div></TD>
                  <TD numeric>{formatQty(l.qty)} <span className="text-xs text-slate-400">{l.product?.uom?.code}</span></TD>
                  <TD numeric className={Number(l.qty_received) >= Number(l.qty) ? "text-emerald-700" : ""}>{formatQty(l.qty_received)}</TD>
                  <TD numeric>{formatQty(l.qty_billed)}</TD>
                  <TD numeric>{formatMoney(l.unit_cost)}</TD>
                  <TD numeric>{Number(l.tax_rate)}%</TD>
                  <TD numeric>{formatMoney(l.net_amount)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="flex justify-end border-t border-slate-100 px-5 py-4">
            <dl className="w-64 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Net</dt><dd className="tabular-nums">{formatMoney(p.net_total, p.currency_code)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">VAT</dt><dd className="tabular-nums">{formatMoney(p.tax_total, p.currency_code)}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(p.total, p.currency_code)}</dd></div>
              {p.currency_code !== "AED" && <div className="flex justify-between text-xs text-slate-500"><dt>In AED</dt><dd>{formatMoney(p.total_base)}</dd></div>}
            </dl>
          </div>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {facts.map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="text-right">{v}</dd></div>)}
              </dl>
              {p.notes && <p className="mt-4 whitespace-pre-line rounded-md bg-slate-50 p-3 text-sm text-slate-700">{p.notes}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Goods received</CardTitle></CardHeader>
            <Table>
              <TBody>
                {(receipts ?? []).length === 0 && <EmptyRow colSpan={3}>Nothing received yet.</EmptyRow>}
                {(receipts ?? []).map((g) => (
                  <TR key={g.id}><TD><Link href={`/inventory/receipts/${g.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{g.doc_no}</Link>
                    {g.supplier_reference && <p className="text-xs text-slate-500">{g.supplier_reference}</p>}</TD>
                    <TD>{formatDate(g.receipt_date)}</TD><TD><StatusBadge status={g.status} /></TD></TR>
                ))}
              </TBody>
            </Table>
          </Card>
          {(approvals ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Approval history</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {(approvals ?? []).map((a) => (
                  <div key={a.id}>
                    <div className="flex items-center justify-between"><StatusBadge status={a.status} /><span className="text-xs text-slate-500">{formatDateTime(a.decided_at ?? a.requested_at)}</span></div>
                    <p className="mt-1 text-slate-600">{a.reasons.join("; ")}</p>
                    <p className="text-xs text-slate-500">Requested by {a.requester?.full_name}{a.decider && ` · decided by ${a.decider.full_name}`}{a.comment && ` — “${a.comment}”`}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      {p.terms_conditions && (
        <Card className="mt-6"><CardHeader><CardTitle>Terms & conditions</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-line text-sm text-slate-700">{p.terms_conditions}</p></CardContent></Card>
      )}
    </>
  );
}
