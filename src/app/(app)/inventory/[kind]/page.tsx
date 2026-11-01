import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DOC_KINDS, isDocKind } from "@/lib/inventory-config";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, humanize } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }): Promise<Metadata> {
  const { kind } = await params;
  return { title: isDocKind(kind) ? DOC_KINDS[kind].title : "Inventory" };
}

const STATUSES: Record<string, string[]> = {
  receipts: ["draft", "posted", "cancelled"], issues: ["draft", "posted", "cancelled"],
  transfers: ["draft", "in_transit", "received", "cancelled"], adjustments: ["draft", "submitted", "posted", "rejected", "cancelled"],
};

export default async function DocListPage({ params, searchParams }: {
  params: Promise<{ kind: string }>; searchParams: Promise<{ status?: string; warehouse?: string }>;
}) {
  const { kind } = await params;
  if (!isDocKind(kind)) notFound();
  const sp = await searchParams;
  const cfg = DOC_KINDS[kind];
  const user = await requirePermission("inventory.view");
  const supabase = await createClient();

  const select = kind === "transfers"
    ? `id, doc_no, status, ${cfg.dateField}, created_at, from:warehouses!stock_transfers_from_warehouse_id_fkey(code), to:warehouses!stock_transfers_to_warehouse_id_fkey(code), lines:${cfg.linesTable}(count)`
    : `*, warehouse:warehouses(code, name), lines:${cfg.linesTable}(count)${kind === "receipts" || kind === "issues" ? ", supplier:suppliers(name)" : ""}`;
  let q = supabase.from(cfg.table).select(select).order(cfg.dateField, { ascending: false }).order("created_at", { ascending: false }).limit(200);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.warehouse && kind !== "transfers") q = q.eq("warehouse_id", sp.warehouse);
  const [{ data: docs }, { data: warehouses }] = await Promise.all([
    q, supabase.from("warehouses").select("id, code, name").order("code"),
  ]);

  return (
    <>
      <PageHeader title={cfg.title} description={cfg.description}
        actions={can(user, cfg.createPermission) && (
          <Link href={`/inventory/${kind}/new`} className={buttonVariants()}><Plus /> New {cfg.singular.toLowerCase()}</Link>
        )} />
      <Card>
        <form className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <Select name="status" defaultValue={sp.status ?? ""} className="w-44">
            <option value="">All statuses</option>
            {STATUSES[kind].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          {kind !== "transfers" && (
            <Select name="warehouse" defaultValue={sp.warehouse ?? ""} className="w-56">
              <option value="">All warehouses</option>
              {(warehouses ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          )}
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
        </form>
        <Table>
          <THead>
            <TR>
              <TH>Number</TH><TH>Date</TH>
              {kind === "transfers" ? <><TH>From</TH><TH>To</TH></> : <TH>Warehouse</TH>}
              {kind === "receipts" && <><TH>Supplier</TH><TH>Supplier ref.</TH></>}
              {kind === "issues" && <><TH>Type</TH><TH>Issued to</TH></>}
              {kind === "adjustments" && <TH>Reason</TH>}
              <TH numeric>Items</TH><TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {(docs ?? []).length === 0 && <EmptyRow colSpan={8}>No documents found.</EmptyRow>}
            {(docs ?? []).map((d: any) => (
              <TR key={d.id}>
                <TD><Link href={`/inventory/${kind}/${d.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{d.doc_no}</Link></TD>
                <TD>{formatDate(d[cfg.dateField])}</TD>
                {kind === "transfers" ? <><TD>{d.from?.code}</TD><TD>{d.to?.code}</TD></> : <TD>{d.warehouse?.name}</TD>}
                {kind === "receipts" && <><TD>{d.supplier?.name ?? "—"}</TD><TD>{d.supplier_reference ?? "—"}</TD></>}
                {kind === "issues" && <><TD>{humanize(d.issue_type)}</TD><TD>{d.supplier?.name ?? d.issued_to ?? "—"}</TD></>}
                {kind === "adjustments" && <TD>{humanize(d.reason)}{d.allow_negative && <span className="ml-2 text-xs text-amber-700">neg. allowed</span>}</TD>}
                <TD numeric>{d.lines?.[0]?.count ?? 0}</TD>
                <TD><StatusBadge status={d.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
