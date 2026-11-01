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
import { QuotationActions } from "@/components/quotations/quotation-actions";
import { cn, formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/utils";

export const metadata: Metadata = { title: "Quotation" };

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("quotation.view");
  const supabase = await createClient();
  const { data: q } = await supabase.from("quotations")
    .select(`*, customer:customers(id, name, code, trn), contact:customer_contacts(name, email, mobile),
      bill:customer_addresses!quotations_billing_address_id_fkey(line1, line2, city, emirate, country),
      ship:customer_addresses!quotations_shipping_address_id_fkey(label, line1, line2, city, emirate, country),
      rep:profiles!quotations_sales_rep_id_fkey(full_name), pterm:payment_terms(name), dterm:delivery_terms(code, name),
      lead:leads(id, doc_no, title)`)
    .eq("id", id).maybeSingle();
  if (!q) notFound();

  const canCost = can(user, "quotation.view_cost");
  const [{ data: lines }, { data: costs }, { data: margin }, { data: approvals }, { data: revisions }, { data: order }, { data: stock }, activities] = await Promise.all([
    supabase.from("quotation_lines").select("*, product:products(id, sku, item_type, uom:units_of_measure(code)), tax:tax_codes(code)").eq("quotation_id", id).order("line_no"),
    canCost ? supabase.from("quotation_line_costs").select("line_id, unit_cost, cost_source").eq("quotation_id", id) : Promise.resolve({ data: [] }),
    canCost ? supabase.rpc("quotation_margin", { p_id: id }).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("approval_requests").select("*, requester:profiles!approval_requests_requested_by_fkey(full_name), decider:profiles!approval_requests_decided_by_fkey(full_name)")
      .eq("doc_type", "quotation").eq("doc_id", id).order("requested_at", { ascending: false }),
    supabase.from("quotations").select("id, doc_no, revision_no, status, quotation_date, total, currency_code").eq("base_doc_no", q.base_doc_no).order("revision_no"),
    supabase.from("sales_orders").select("id, doc_no, status").eq("quotation_id", id).maybeSingle(),
    supabase.from("v_product_stock").select("product_id, qty_available"),
    loadActivities({ quotation_id: id }),
  ]);
  const cost = new Map((costs ?? []).map((c: any) => [c.line_id, c]));
  const avail = new Map((stock ?? []).map((s) => [s.product_id, Number(s.qty_available)]));
  const m: any = margin;
  const pending = (approvals ?? []).find((a) => a.status === "pending");

  // Offer only the actions that make sense now; the database checks every one again.
  const own = q.sales_rep_id === user.id || can(user, "quotation.view_all");
  const edit = can(user, "quotation.edit") && own;
  const actions: Parameters<typeof QuotationActions>[0]["actions"] = ["pdf"];
  switch (q.status) {
    case "draft": if (edit) actions.push("edit", "lost", "submit"); break;
    case "pending_approval":
      if (pending && can(user, pending.approver_permission) && (pending.requested_by !== user.id || can(user, "approval.self_approve"))) actions.push("reject", "approve");
      if (edit) actions.push("reopen");
      break;
    case "rejected": if (edit) actions.push("reopen", "lost"); break;
    case "approved": case "sent":
      if (edit) actions.push("revise", "lost", ...(q.status === "approved" ? ["sent" as const] : []), "accepted");
      if (can(user, "sales_order.create") && own) actions.push("convert");
      break;
    case "accepted":
      if (edit) actions.push("revise");
      if (can(user, "sales_order.create") && own) actions.push("convert");
      break;
    case "expired": if (edit) actions.push("revise", "lost"); break;
  }
  const today = new Date().toISOString().slice(0, 10);
  const addr = (a: any) => a ? [a.line1, a.line2, a.city, a.emirate, a.country].filter(Boolean).join(", ") : null;

  return (
    <>
      <PageHeader
        back={{ href: "/quotations", label: "Quotations" }}
        title={<span className="flex items-center gap-3"><span className="font-mono">{q.doc_no}</span> <StatusBadge status={q.status} /></span>}
        description={<span><Link href={`/customers/${q.customer.id}`} className="text-navy-700 hover:underline">{q.customer.name}</Link>{q.subject && ` · ${q.subject}`}</span>}
        actions={<QuotationActions id={q.id} actions={actions} />}
      />
      {pending && <Alert tone="warning" className="mb-4">Awaiting approval: {pending.reasons.join("; ")}. Requested by {pending.requester?.full_name} on {formatDateTime(pending.requested_at)}.</Alert>}
      {q.status === "rejected" && approvals?.[0]?.status === "rejected" && <Alert tone="error" className="mb-4">Rejected by {approvals[0].decider?.full_name}: {approvals[0].comment}</Alert>}
      {q.status === "lost" && <Alert tone="error" className="mb-4">Lost: {q.lost_reason}</Alert>}
      {q.status === "superseded" && <Alert tone="info" className="mb-4">This revision has been replaced by a newer one.</Alert>}
      {order && <Alert tone="success" className="mb-4">Converted to sales order <Link href={`/sales-orders/${order.id}`} className="font-semibold underline">{order.doc_no}</Link>.</Alert>}
      {["approved", "sent"].includes(q.status) && q.valid_until < today && <Alert tone="warning" className="mb-4">The validity date has passed. Revise the quotation before converting it.</Alert>}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardContent className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              {[
                ["Quotation date", formatDate(q.quotation_date)], ["Valid until", formatDate(q.valid_until)], ["Currency", q.currency_code + (q.currency_code !== "AED" ? ` @ ${q.exchange_rate}` : "")],
                ["Attention", q.contact?.name ?? "—"], ["Customer reference", q.customer_reference ?? "—"], ["Sales rep", q.rep?.full_name],
                ["Payment terms", q.pterm?.name ?? "—"], ["Delivery terms", q.dterm ? `${q.dterm.code} — ${q.dterm.name}` : "—"], ["Delivery time", q.delivery_time ?? "—"],
                ["Billing address", addr(q.bill) ?? "—"], ["Delivery address", addr(q.ship) ?? q.delivery_location ?? "—"],
                ["Enquiry", q.lead ? <Link key="l" href={`/leads/${q.lead.id}`} className="text-navy-700 hover:underline">{q.lead.doc_no}</Link> : "—"],
              ].map(([k, v]) => <div key={k as string}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-slate-900">{v}</dd></div>)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Items</CardTitle></CardHeader>
            <Table>
              <THead><TR><TH>#</TH><TH>Description</TH><TH numeric>Qty</TH><TH numeric>Unit price</TH><TH numeric>Disc.</TH><TH>VAT</TH><TH>Fulfilment</TH>
                {canCost && <><TH numeric>Unit cost</TH><TH numeric>Margin</TH></>}<TH numeric>Amount</TH></TR></THead>
              <TBody>
                {(lines ?? []).map((l: any) => {
                  const c = cost.get(l.id);
                  const lm = c && Number(l.net_amount) > 0 ? ((Number(l.net_amount) - Number(l.qty) * Number(c.unit_cost)) / Number(l.net_amount)) * 100 : null;
                  const a = avail.get(l.product.id);
                  return (
                    <TR key={l.id}>
                      <TD className="text-slate-400">{l.line_no}</TD>
                      <TD><p className="whitespace-pre-line">{l.description}</p><p className="font-mono text-xs text-slate-500">{l.product.sku}{l.lead_time_text && <span className="font-sans"> · {l.lead_time_text}</span>}</p></TD>
                      <TD numeric>{formatQty(l.qty)} <span className="text-xs text-slate-400">{l.product.uom?.code}</span></TD>
                      <TD numeric>{formatMoney(l.unit_price)}</TD>
                      <TD numeric>{Number(l.discount_pct) ? `${Number(l.discount_pct)}%` : "—"}</TD>
                      <TD>{l.tax?.code} {Number(l.tax_rate)}%</TD>
                      <TD>
                        <Badge tone={l.fulfilment_mode === "stock" ? "green" : "blue"}>{l.fulfilment_mode === "stock" ? "Stock" : "Procure"}</Badge>
                        {l.product.item_type === "stock" && ["draft", "pending_approval", "approved", "sent", "accepted"].includes(q.status) && (
                          <p className={cn("mt-0.5 text-xs", (a ?? 0) >= Number(l.qty) ? "text-emerald-700" : "text-amber-700")}>{formatQty(a ?? 0)} available now</p>
                        )}
                      </TD>
                      {canCost && <><TD numeric>{c ? formatMoney(c.unit_cost) : "—"}</TD><TD numeric className={lm !== null && lm < 15 ? "text-red-700" : ""}>{lm === null ? "—" : `${lm.toFixed(1)}%`}</TD></>}
                      <TD numeric>{formatMoney(l.net_amount)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <dl className="ml-auto max-w-xs space-y-1.5 border-t border-slate-200 p-5 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{formatMoney(q.gross_amount)}</dd></div>
              {Number(q.discount_total) > 0 && <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd className="tabular-nums">−{formatMoney(q.discount_total)}</dd></div>}
              <div className="flex justify-between"><dt className="text-slate-500">Net</dt><dd className="tabular-nums">{formatMoney(q.net_total)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">VAT</dt><dd className="tabular-nums">{formatMoney(q.tax_total)}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{q.currency_code} {formatMoney(q.total)}</dd></div>
              {q.currency_code !== "AED" && <div className="flex justify-between text-xs text-slate-500"><dt>In AED</dt><dd>{formatMoney(q.total_base)}</dd></div>}
            </dl>
          </Card>

          <Card>
            <CardHeader><CardTitle>Terms and notes</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Terms and conditions</p><p className="mt-1 whitespace-pre-line text-slate-700">{q.terms_conditions || "—"}</p></div>
              {q.notes && <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes to customer</p><p className="mt-1 whitespace-pre-line text-slate-700">{q.notes}</p></div>}
              {q.internal_notes && <div className="rounded-md bg-amber-50 p-3"><p className="text-xs font-medium uppercase tracking-wide text-amber-800">Internal notes</p><p className="mt-1 whitespace-pre-line text-amber-900">{q.internal_notes}</p></div>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {m && (
            <Card>
              <CardHeader><CardTitle>Profitability (internal)</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-slate-500">Net sales</p><p className="text-lg font-semibold tabular-nums">{formatMoney(q.net_total)}</p></div>
                <div><p className="text-xs text-slate-500">Purchase cost</p><p className="text-lg font-semibold tabular-nums">{formatMoney(m.total_cost)}</p></div>
                <div><p className="text-xs text-slate-500">Gross profit</p><p className={cn("text-lg font-semibold tabular-nums", Number(m.gross_profit) < 0 && "text-red-700")}>{formatMoney(m.gross_profit)}</p></div>
                <div><p className="text-xs text-slate-500">Gross margin</p><p className={cn("text-lg font-semibold tabular-nums", Number(m.gross_margin_pct) < 15 ? "text-red-700" : "text-emerald-700")}>{m.gross_margin_pct === null ? "—" : `${Number(m.gross_margin_pct).toFixed(1)}%`}</p></div>
                {q.currency_code !== "AED" && <p className="col-span-2 text-xs text-slate-500">Gross profit in AED: {formatMoney(m.gross_profit_base)}</p>}
              </CardContent>
            </Card>
          )}
          {(revisions ?? []).length > 1 && (
            <Card>
              <CardHeader><CardTitle>Revisions</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {(revisions ?? []).map((r) => (
                  <div key={r.id} className="flex items-center justify-between">
                    {r.id === q.id ? <span className="font-mono font-semibold">{r.doc_no}</span> : <Link href={`/quotations/${r.id}`} className="font-mono text-navy-700 hover:underline">{r.doc_no}</Link>}
                    <span className="flex items-center gap-2 tabular-nums">{formatMoney(r.total, r.currency_code)} <StatusBadge status={r.status} /></span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {(approvals ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Approval history</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {(approvals ?? []).map((a) => (
                  <div key={a.id}>
                    <p className="flex items-center gap-2"><StatusBadge status={a.status} /> <span className="text-slate-500">{formatDateTime(a.decided_at ?? a.requested_at)}</span></p>
                    <p className="mt-1 text-slate-700">{a.reasons.join("; ")}</p>
                    <p className="text-xs text-slate-500">Requested by {a.requester?.full_name}{a.decider && ` · decided by ${a.decider.full_name}`}{a.comment && ` — “${a.comment}”`}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <ActivityPanel activities={activities} link={{ quotation_id: q.id }} path={`/quotations/${q.id}`} canManage={can(user, "activity.manage")} />
        </div>
      </div>
    </>
  );
}
