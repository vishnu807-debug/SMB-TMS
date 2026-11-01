import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DOC_KINDS, isDocKind } from "@/lib/inventory-config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { DocumentActions, type DocAction } from "@/components/inventory/document-actions";
import { formatDate, formatDateTime, formatMoney, formatQty, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Stock document" };

export default async function DocPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!isDocKind(kind)) notFound();
  const cfg = DOC_KINDS[kind];
  const user = await requirePermission("inventory.view");
  const supabase = await createClient();

  const docSelect = kind === "transfers"
    ? "*, from:warehouses!stock_transfers_from_warehouse_id_fkey(code, name), to:warehouses!stock_transfers_to_warehouse_id_fkey(code, name)"
    : `*, warehouse:warehouses(code, name)${kind === "receipts" || kind === "issues" ? ", supplier:suppliers(name, code)" : ""}`;
  const [{ data: doc }, { data: lines }, { data: moves }, { data: approval }] = await Promise.all([
    supabase.from(cfg.table).select(docSelect).eq("id", id).maybeSingle(),
    supabase.from(cfg.linesTable).select("*, product:products(id, sku, name, uom:units_of_measure(code))").eq(cfg.parentKey, id).order("line_no"),
    supabase.from("v_stock_movements").select("*").eq("source_id", id).order("seq"),
    kind === "adjustments"
      ? supabase.from("approval_requests").select("*, requester:profiles!approval_requests_requested_by_fkey(full_name), decider:profiles!approval_requests_decided_by_fkey(full_name)")
          .eq("doc_type", "stock_adjustment").eq("doc_id", id).order("requested_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!doc) notFound();
  const d: any = doc;

  const people = await supabase.from("profiles").select("id, full_name")
    .in("id", [d.created_by, d.posted_by, d.dispatched_by, d.received_by, d.submitted_by, d.approved_by].filter(Boolean));
  const who = (pid?: string | null) => people.data?.find((p) => p.id === pid)?.full_name ?? "—";

  // Which actions this user may take in the current status (the database re-checks every one).
  const actions: DocAction[] = [];
  const mayCreate = can(user, cfg.createPermission);
  if (kind === "receipts" && d.status === "draft" && mayCreate) actions.push("edit", "post", "cancel");
  if (kind === "issues" && d.status === "draft" && mayCreate) actions.push("edit", "post", "cancel");
  if (kind === "transfers" && mayCreate) {
    if (d.status === "draft") actions.push("edit", "dispatch", "cancel");
    if (d.status === "in_transit") actions.push("receive");
  }
  if (kind === "adjustments") {
    if (["draft", "rejected"].includes(d.status) && mayCreate) actions.push("edit", "submit", "cancel");
    const approverPerm = d.allow_negative ? "inventory.allow_negative" : "inventory.approve_adjustment";
    if (d.status === "submitted" && can(user, approverPerm)) actions.push("approve", "reject");
    if (d.status === "submitted" && mayCreate) actions.push("cancel");
  }
  const showCost = kind === "receipts" || (kind === "adjustments" && can(user, "inventory.view_valuation"));

  const facts: [string, React.ReactNode][] = [
    ["Date", formatDate(d[cfg.dateField])],
    ...(kind === "transfers"
      ? [["From", `${d.from?.name} (${d.from?.code})`], ["To", `${d.to?.name} (${d.to?.code})`]] as [string, string][]
      : [["Warehouse", `${d.warehouse?.name} (${d.warehouse?.code})`]] as [string, string][]),
    ...(kind === "receipts" ? [["Supplier", d.supplier?.name ?? "—"], ["Supplier reference", d.supplier_reference ?? "—"],
      ["Currency", d.currency_code + (d.exchange_rate !== 1 ? ` @ ${d.exchange_rate}` : "")]] as [string, string][] : []),
    ...(kind === "issues" ? [["Type", humanize(d.issue_type)], ["Issued to", d.supplier?.name ?? d.issued_to ?? "—"], ["Reference", d.reference ?? "—"]] as [string, string][] : []),
    ...(kind === "adjustments" ? [["Reason", humanize(d.reason)]] as [string, string][] : []),
    ["Prepared by", `${who(d.created_by)} · ${formatDateTime(d.created_at)}`],
    ...(d.posted_at ? [["Posted by", `${who(d.posted_by)} · ${formatDateTime(d.posted_at)}`]] as [string, string][] : []),
    ...(d.dispatched_at ? [["Dispatched by", `${who(d.dispatched_by)} · ${formatDateTime(d.dispatched_at)}`]] as [string, string][] : []),
    ...(d.received_at ? [["Received by", `${who(d.received_by)} · ${formatDateTime(d.received_at)}`]] as [string, string][] : []),
    ...(d.submitted_at ? [["Submitted by", `${who(d.submitted_by)} · ${formatDateTime(d.submitted_at)}`]] as [string, string][] : []),
    ...(d.approved_at ? [["Approved by", `${who(d.approved_by)} · ${formatDateTime(d.approved_at)}`]] as [string, string][] : []),
  ];

  return (
    <>
      <PageHeader
        back={{ href: `/inventory/${kind}`, label: cfg.title }}
        title={<span className="flex items-center gap-3">{cfg.singular} <span className="font-mono">{d.doc_no}</span> <StatusBadge status={d.status} /></span>}
        actions={<DocumentActions kind={kind} id={id} actions={actions} />}
      />
      {d.allow_negative && (
        <Alert tone="warning" className="mb-4">
          This document is authorised to take stock below zero{d.negative_reason ? `: ${d.negative_reason}` : "."}
        </Alert>
      )}
      {d.status === "rejected" && d.rejection_reason && <Alert tone="error" className="mb-4">Rejected: {d.rejection_reason}</Alert>}
      {approval && d.status === "submitted" && (
        <Alert tone="info" className="mb-4">Waiting for approval — requested by {approval.requester?.full_name ?? "—"} on {formatDateTime(approval.requested_at)}.</Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Items</CardTitle></CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>#</TH><TH>Product</TH>
                {kind === "adjustments" ? <><TH>Method</TH><TH numeric>Entered</TH><TH numeric>System qty</TH><TH numeric>Posted change</TH></> : <TH numeric>Quantity</TH>}
                {showCost && <TH numeric>{kind === "receipts" ? `Unit cost (${d.currency_code})` : "Unit cost (AED)"}</TH>}
                {kind === "receipts" && <TH numeric>Line value</TH>}
                <TH>Notes</TH>
              </TR>
            </THead>
            <TBody>
              {(lines ?? []).length === 0 && <EmptyRow colSpan={8}>No items.</EmptyRow>}
              {(lines ?? []).map((l: any) => (
                <TR key={l.id}>
                  <TD className="text-slate-400">{l.line_no}</TD>
                  <TD>
                    <Link href={`/products/${l.product.id}`} className="font-medium text-navy-800 hover:underline">{l.product.name}</Link>
                    <span className="ml-2 font-mono text-xs text-slate-500">{l.product.sku}</span>
                    {l.sales_order_line_id && <span className="ml-2 text-xs text-sky-700">reserved for customer order</span>}
                  </TD>
                  {kind === "adjustments" ? (
                    <>
                      <TD>{l.mode === "count" ? "Counted" : "Change"}</TD>
                      <TD numeric>{l.mode === "count" ? formatQty(l.counted_qty) : formatQty(l.qty_change)}</TD>
                      <TD numeric>{formatQty(l.system_qty)}</TD>
                      <TD numeric className={Number(l.posted_change) < 0 ? "text-red-700" : Number(l.posted_change) > 0 ? "text-emerald-700" : ""}>{formatQty(l.posted_change)}</TD>
                    </>
                  ) : <TD numeric>{formatQty(l.qty)} <span className="text-xs text-slate-400">{l.product.uom?.code}</span></TD>}
                  {showCost && <TD numeric>{formatMoney(kind === "receipts" ? l.unit_cost : l.unit_cost_base)}</TD>}
                  {kind === "receipts" && <TD numeric>{formatMoney(Number(l.qty) * Number(l.unit_cost))}</TD>}
                  <TD className="text-slate-500">{l.notes ?? ""}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>

        <Card className="h-fit">
          <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              {facts.map(([k, v]) => (
                <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-slate-900">{v}</dd></div>
              ))}
            </dl>
            {d.notes && <p className="mt-4 whitespace-pre-line border-t border-slate-100 pt-3 text-sm text-slate-700">{d.notes}</p>}
          </CardContent>
        </Card>
      </div>

      {(moves ?? []).length > 0 && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Stock movements posted</CardTitle></CardHeader>
          <Table>
            <THead><TR><TH>When</TH><TH>Type</TH><TH>Product</TH><TH>Warehouse</TH><TH numeric>Change</TH><TH numeric>Physical after</TH><TH numeric>Available after</TH>{moves?.[0]?.unit_cost !== null && <TH numeric>Value</TH>}</TR></THead>
            <TBody>
              {(moves ?? []).map((m) => (
                <TR key={m.id}>
                  <TD className="whitespace-nowrap">{formatDateTime(m.moved_at)}</TD>
                  <TD>{humanize(m.movement_type)}</TD>
                  <TD>{m.product_name} <span className="font-mono text-xs text-slate-500">{m.sku}</span></TD>
                  <TD>{m.warehouse_code}</TD>
                  <TD numeric className={Number(m.on_hand_change) < 0 || Number(m.reserved_change) < 0 ? "text-red-700" : "text-emerald-700"}>
                    {Number(m.on_hand_change) !== 0 ? formatQty(m.on_hand_change) : `${formatQty(m.reserved_change)} reserved`}
                  </TD>
                  <TD numeric>{formatQty(m.on_hand_after)}</TD>
                  <TD numeric>{formatQty(m.available_after)}</TD>
                  {m.unit_cost !== null && <TD numeric>{formatMoney(m.value_change)}</TD>}
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
