import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadActivities } from "@/lib/activities";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ActivityPanel } from "@/components/sales/activity-panel";
import { OrderActions } from "@/components/sales-orders/order-actions";
import { FulfilmentPlan } from "@/components/sales-orders/fulfilment-plan";
import { cn, formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/utils";

export const metadata: Metadata = { title: "Sales order" };

export default async function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("sales_order.view");
  const supabase = await createClient();
  const { data: so } = await supabase.from("sales_orders")
    .select(`*, customer:customers(id, name, code, credit_limit), contact:customer_contacts(name, email, mobile),
      ship:customer_addresses!sales_orders_shipping_address_id_fkey(label, line1, city, emirate),
      rep:profiles!sales_orders_sales_rep_id_fkey(full_name), pterm:payment_terms(name), dterm:delivery_terms(code, name),
      quotation:quotations(id, doc_no), confirmer:profiles!sales_orders_confirmed_by_fkey(full_name)`)
    .eq("id", id).maybeSingle();
  if (!so) notFound();
  const canCost = can(user, "sales_order.view_cost");
  const [{ data: lines }, { data: reservations }, { data: reqs }, { data: approvals }, { data: margin }, { data: costs }, { data: stock }, { data: warehouses }, activities] = await Promise.all([
    supabase.from("sales_order_lines").select("*, product:products(id, sku, item_type, uom:units_of_measure(code)), warehouse:warehouses(code)").eq("sales_order_id", id).order("line_no"),
    supabase.from("stock_reservations").select("sales_order_line_id, qty, warehouse:warehouses(code)").eq("status", "active"),
    supabase.from("purchase_requisitions").select("id, doc_no, status, created_at, lines:purchase_requisition_lines(sales_order_line_id, qty, qty_ordered, is_cancelled)").eq("sales_order_id", id),
    supabase.from("approval_requests").select("*, requester:profiles!approval_requests_requested_by_fkey(full_name), decider:profiles!approval_requests_decided_by_fkey(full_name)").eq("doc_type", "sales_order").eq("doc_id", id).order("requested_at", { ascending: false }),
    canCost ? supabase.rpc("sales_order_margin", { p_id: id }).maybeSingle() : Promise.resolve({ data: null }),
    canCost ? supabase.from("sales_order_line_costs").select("line_id, unit_cost").eq("sales_order_id", id) : Promise.resolve({ data: [] }),
    supabase.from("v_product_stock").select("product_id, qty_available"),
    supabase.from("warehouses").select("id, code, name").eq("is_active", true).order("code"),
    loadActivities({ sales_order_id: id }),
  ]);
  const lineIds = new Set((lines ?? []).map((l) => l.id));
  const resByLine = new Map<string, string[]>();
  (reservations ?? []).filter((r: any) => lineIds.has(r.sales_order_line_id)).forEach((r: any) => {
    resByLine.set(r.sales_order_line_id, [...(resByLine.get(r.sales_order_line_id) ?? []), `${formatQty(r.qty)} @ ${r.warehouse?.code}`]);
  });
  const avail = new Map((stock ?? []).map((s) => [s.product_id, Number(s.qty_available)]));
  const cost = new Map((costs ?? []).map((c: any) => [c.line_id, Number(c.unit_cost)]));
  const m: any = margin;
  const pending = (approvals ?? []).find((a) => a.status === "pending");
  const active = (lines ?? []).filter((l) => !l.is_cancelled);
  const modes = new Set(active.map((l) => l.fulfilment_mode));

  const own = so.sales_rep_id === user.id || can(user, "sales_order.view_all");
  const actions: Parameters<typeof OrderActions>[0]["actions"] = [];
  if (so.status === "draft" && own && can(user, "sales_order.confirm")) actions.push("confirm");
  if (so.status === "pending_approval" && pending && can(user, pending.approver_permission) && (pending.requested_by !== user.id || can(user, "approval.self_approve"))) actions.push("reject", "approve");
  if (["confirmed", "partially_fulfilled"].includes(so.status) && can(user, "sales_order.approve")) actions.push("hold");
  if (so.status === "on_hold" && can(user, "sales_order.approve")) actions.push("release");
  if (!["cancelled", "invoiced", "closed", "fulfilled"].includes(so.status) && own && can(user, "sales_order.cancel")) actions.push("cancel");

  return (
    <>
      <PageHeader
        back={{ href: "/sales-orders", label: "Sales orders" }}
        title={<span className="flex items-center gap-3"><span className="font-mono">{so.doc_no}</span> <StatusBadge status={so.status} />
          <Badge tone="navy">{modes.size === 2 ? "Mixed fulfilment" : modes.has("procure") ? "Direct procurement" : "From stock"}</Badge></span>}
        description={<span><Link href={`/customers/${so.customer.id}`} className="text-navy-700 hover:underline">{so.customer.name}</Link>
          {so.customer_po_ref && ` · Customer PO ${so.customer_po_ref}`}{so.quotation && <> · from <Link href={`/quotations/${so.quotation.id}`} className="text-navy-700 hover:underline">{so.quotation.doc_no}</Link></>}</span>}
        actions={<OrderActions id={so.id} actions={actions} />}
      />
      {pending && <Alert tone="warning" className="mb-4">Awaiting approval: {pending.reasons.join("; ")}. Nothing has been reserved yet.</Alert>}
      {so.status === "on_hold" && <Alert tone="warning" className="mb-4">On hold: {so.hold_reason}</Alert>}
      {so.status === "cancelled" && <Alert tone="error" className="mb-4">Cancelled: {so.cancel_reason}. Reservations and requisitions were released.</Alert>}
      {approvals?.[0]?.status === "rejected" && so.status === "draft" && <Alert tone="error" className="mb-4">Approval rejected by {approvals[0].decider?.full_name}: {approvals[0].comment}</Alert>}

      {so.status === "draft" && own && can(user, "sales_order.edit") && (
        <div className="mb-6">
          <FulfilmentPlan order={so} warehouses={warehouses ?? []} lines={active.map((l: any) => ({
            id: l.id, line_no: l.line_no, description: l.description, sku: l.product.sku, qty: Number(l.qty), uom: l.product.uom?.code ?? "",
            item_type: l.product.item_type, fulfilment_mode: l.fulfilment_mode, warehouse_id: l.warehouse_id, available: avail.get(l.product.id) ?? 0,
          }))} />
        </div>
      )}

      <Card className="mb-6">
        <CardHeader><CardTitle>Items and fulfilment status</CardTitle></CardHeader>
        <Table>
          <THead>
            <TR><TH>#</TH><TH>Item</TH><TH numeric>Ordered</TH><TH>Fulfilment</TH><TH>Stock</TH><TH>Procurement</TH><TH>Delivery</TH>
              {canCost && <TH numeric>Margin</TH>}<TH numeric>Amount</TH></TR>
          </THead>
          <TBody>
            {(lines ?? []).map((l: any) => {
              const c = cost.get(l.id);
              const lm = c !== undefined && Number(l.net_amount) > 0 ? ((Number(l.net_amount) - Number(l.qty) * c) / Number(l.net_amount)) * 100 : null;
              return (
                <TR key={l.id} className={cn(l.is_cancelled && "opacity-50")}>
                  <TD className="text-slate-400">{l.line_no}{l.split_from_line_id && <span title="Split from a stock line because stock was short" className="ml-1 text-xs text-sky-700">split</span>}</TD>
                  <TD><p>{l.description}</p><p className="font-mono text-xs text-slate-500">{l.product.sku}</p></TD>
                  <TD numeric>{formatQty(l.qty)} <span className="text-xs text-slate-400">{l.product.uom?.code}</span></TD>
                  <TD><Badge tone={l.fulfilment_mode === "stock" ? "green" : "blue"}>{l.fulfilment_mode === "stock" ? "Stock" : "Procure"}</Badge>
                    {l.warehouse && <p className="mt-0.5 text-xs text-slate-500">{l.warehouse.code}</p>}</TD>
                  <TD>
                    <StatusBadge status={so.status === "draft" || so.status === "pending_approval" ? (l.fulfilment_mode === "stock" ? "not_reserved" : "not_required") : l.stock_status} />
                    <p className="mt-0.5 text-xs text-slate-500">
                      {resByLine.get(l.id)?.join(", ") ?? (l.product.item_type === "stock" ? `${formatQty(avail.get(l.product.id) ?? 0)} available` : "")}
                    </p>
                  </TD>
                  <TD>
                    <StatusBadge status={l.procurement_status} />
                    {l.fulfilment_mode === "procure" && <p className="mt-0.5 text-xs text-slate-500">req. {formatQty(l.qty_requisitioned)} · ord. {formatQty(l.qty_ordered)} · rcvd {formatQty(l.qty_received)}</p>}
                  </TD>
                  <TD><StatusBadge status={l.delivery_status} /><p className="mt-0.5 text-xs text-slate-500">{formatQty(l.qty_delivered)} of {formatQty(l.qty)}</p></TD>
                  {canCost && <TD numeric className={lm !== null && lm < 15 ? "text-red-700" : ""}>{lm === null ? "—" : `${lm.toFixed(1)}%`}</TD>}
                  <TD numeric>{formatMoney(l.net_amount)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <dl className="ml-auto max-w-xs space-y-1.5 border-t border-slate-200 p-5 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Net</dt><dd className="tabular-nums">{formatMoney(so.net_total)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">VAT</dt><dd className="tabular-nums">{formatMoney(so.tax_total)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{so.currency_code} {formatMoney(so.total)}</dd></div>
        </dl>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardContent className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              {[
                ["Order date", formatDate(so.order_date)], ["Required by", formatDate(so.required_date)], ["Sales rep", so.rep?.full_name],
                ["Contact", so.contact?.name ?? "—"], ["Payment terms", so.pterm?.name ?? "—"], ["Delivery terms", so.dterm ? `${so.dterm.code} — ${so.dterm.name}` : "—"],
                ["Deliver to", so.ship ? [so.ship.label, so.ship.line1, so.ship.city].filter(Boolean).join(", ") : so.delivery_location ?? "—"],
                ["Confirmed", so.confirmed_at ? `${formatDateTime(so.confirmed_at)} by ${so.confirmer?.full_name ?? "—"}` : "—"],
                ["Currency", so.currency_code],
              ].map(([k, v]) => <div key={k as string}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-slate-900">{v}</dd></div>)}
            </CardContent>
          </Card>
          {(reqs ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Purchase requisitions</CardTitle></CardHeader>
              <Table>
                <THead><TR><TH>Requisition</TH><TH>Raised</TH><TH numeric>Lines</TH><TH>Status</TH></TR></THead>
                <TBody>
                  {(reqs ?? []).map((r: any) => (
                    <TR key={r.id}><TD className="font-mono text-xs">{r.doc_no}</TD><TD>{formatDateTime(r.created_at)}</TD>
                      <TD numeric>{r.lines.filter((x: any) => !x.is_cancelled).length}</TD><TD><StatusBadge status={r.status} /></TD></TR>
                  ))}
                </TBody>
              </Table>
              <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Procurement works these into purchase orders. Received goods are reserved for this order automatically.</p>
            </Card>
          )}
          {(approvals ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Approval history</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {(approvals ?? []).map((a) => (
                  <div key={a.id}>
                    <p className="flex items-center gap-2"><StatusBadge status={a.status} /> <span className="text-slate-500">{formatDateTime(a.decided_at ?? a.requested_at)}</span></p>
                    <p className="mt-1">{a.reasons.join("; ")}</p>
                    <p className="text-xs text-slate-500">Requested by {a.requester?.full_name}{a.decider && ` · decided by ${a.decider.full_name}`}{a.comment && ` — “${a.comment}”`}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {m && (
            <Card>
              <CardHeader><CardTitle>Profitability (internal)</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-slate-500">Cost</p><p className="text-lg font-semibold tabular-nums">{formatMoney(m.total_cost)}</p></div>
                <div><p className="text-xs text-slate-500">Gross profit</p><p className="text-lg font-semibold tabular-nums">{formatMoney(m.gross_profit)}</p></div>
                <div><p className="text-xs text-slate-500">Gross margin</p><p className={cn("text-lg font-semibold tabular-nums", Number(m.gross_margin_pct) < 15 ? "text-red-700" : "text-emerald-700")}>{m.gross_margin_pct === null ? "—" : `${Number(m.gross_margin_pct).toFixed(1)}%`}</p></div>
                <div><p className="text-xs text-slate-500">Profit (AED)</p><p className="text-lg font-semibold tabular-nums">{formatMoney(m.gross_profit_base)}</p></div>
              </CardContent>
            </Card>
          )}
          <ActivityPanel activities={activities} link={{ sales_order_id: so.id }} path={`/sales-orders/${so.id}`} canManage={can(user, "activity.manage")} />
        </div>
      </div>
    </>
  );
}
