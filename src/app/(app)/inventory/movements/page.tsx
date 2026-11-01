import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTime, formatMoney, formatQty, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Stock movement history" };
const TYPES = ["opening", "receipt", "return_in", "transfer_in", "adjust_in", "issue", "transfer_out", "adjust_out", "return_out", "reserve", "release"];
const SOURCE_LINK: Record<string, string> = { goods_receipt: "receipts", goods_issue: "issues", stock_transfer: "transfers", stock_adjustment: "adjustments" };
const PAGE = 100;

type SP = { product?: string; q?: string; warehouse?: string; type?: string; from?: string; to?: string; page?: string };

export default async function MovementsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("inventory.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  let q = supabase.from("v_stock_movements").select("*", { count: "exact" }).order("seq", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.product) q = q.eq("product_id", sp.product);
  const term = (sp.q ?? "").trim().replace(/[%,()]/g, " ");
  if (term) q = q.or(`product_name.ilike.%${term}%,sku.ilike.%${term}%,source_doc_no.ilike.%${term}%`);
  if (sp.warehouse) q = q.eq("warehouse_id", sp.warehouse);
  if (sp.type) q = q.eq("movement_type", sp.type);
  if (sp.from) q = q.gte("moved_at", `${sp.from}T00:00:00+04:00`);
  if (sp.to) q = q.lte("moved_at", `${sp.to}T23:59:59+04:00`);
  const [{ data: rows, count }, { data: warehouses }] = await Promise.all([q, supabase.from("warehouses").select("id, name").order("code")]);
  const showCost = (rows ?? []).some((r) => r.unit_cost !== null);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const qs = (p: number) => `?${new URLSearchParams({ ...(sp as Record<string, string>), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Stock movement history" description="Every change to stock, in posting order. Movements are permanent; corrections are new movements." />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
          {sp.product && <input type="hidden" name="product" value={sp.product} />}
          <Input name="q" defaultValue={sp.q} placeholder="Product, SKU or document no." className="w-64" />
          <Select name="warehouse" defaultValue={sp.warehouse ?? ""} className="w-48">
            <option value="">All warehouses</option>
            {(warehouses ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Select name="type" defaultValue={sp.type ?? ""} className="w-44">
            <option value="">All movement types</option>
            {TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
          </Select>
          <Input type="date" name="from" defaultValue={sp.from} className="w-40" aria-label="From date" />
          <Input type="date" name="to" defaultValue={sp.to} className="w-40" aria-label="To date" />
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
          {sp.product && <Link href="/inventory/movements" className="text-sm text-navy-700 hover:underline">Clear product filter</Link>}
        </form>
        <Table>
          <THead>
            <TR>
              <TH>When</TH><TH>Type</TH><TH>Document</TH><TH>Product</TH><TH>Warehouse</TH>
              <TH numeric>Physical ±</TH><TH numeric>Reserved ±</TH><TH numeric>Physical after</TH><TH numeric>Available after</TH>
              {showCost && <><TH numeric>Unit cost</TH><TH numeric>Value ±</TH></>}
              <TH>By</TH>
            </TR>
          </THead>
          <TBody>
            {(rows ?? []).length === 0 && <EmptyRow colSpan={12}>No movements found.</EmptyRow>}
            {(rows ?? []).map((m) => (
              <TR key={m.id}>
                <TD className="whitespace-nowrap">{formatDateTime(m.moved_at)}</TD>
                <TD>{humanize(m.movement_type)}{m.negative_authorised_by && <span className="ml-1 text-xs text-amber-700">(neg. authorised)</span>}</TD>
                <TD className="font-mono text-xs">
                  {SOURCE_LINK[m.source_type] && m.source_id
                    ? <Link className="text-navy-800 hover:underline" href={`/inventory/${SOURCE_LINK[m.source_type]}/${m.source_id}`}>{m.source_doc_no}</Link>
                    : m.source_doc_no ?? "—"}
                </TD>
                <TD><Link href={`/products/${m.product_id}`} className="hover:underline">{m.product_name}</Link> <span className="font-mono text-xs text-slate-500">{m.sku}</span></TD>
                <TD>{m.warehouse_code}</TD>
                <TD numeric className={Number(m.on_hand_change) < 0 ? "text-red-700" : Number(m.on_hand_change) > 0 ? "text-emerald-700" : "text-slate-400"}>{Number(m.on_hand_change) ? formatQty(m.on_hand_change) : "—"}</TD>
                <TD numeric className="text-slate-600">{Number(m.reserved_change) ? formatQty(m.reserved_change) : "—"}</TD>
                <TD numeric>{formatQty(m.on_hand_after)}</TD>
                <TD numeric>{formatQty(m.available_after)}</TD>
                {showCost && <><TD numeric>{formatMoney(m.unit_cost)}</TD><TD numeric>{formatMoney(m.value_change)}</TD></>}
                <TD className="whitespace-nowrap text-slate-500">{m.created_by_name ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
            <span className="text-slate-600">Page {page} of {pages} · {count} movements</span>
            <div className="flex gap-2">
              {page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs(page - 1)}>Previous</Link>}
              {page < pages && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs(page + 1)}>Next</Link>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
