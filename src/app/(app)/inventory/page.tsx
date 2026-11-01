import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatMoney, formatQty } from "@/lib/utils";

export const metadata: Metadata = { title: "Stock overview" };

type SP = { q?: string; warehouse?: string; filter?: string };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission(["inventory.view", "product.view"]);
  const sp = await searchParams;
  const supabase = await createClient();
  const byWarehouse = !!sp.warehouse && can(user, "inventory.view");
  const term = (sp.q ?? "").trim().replace(/[%,()]/g, " ");

  const [{ data: warehouses }, { data: valuation }, { data: allSummary }, { count: inTransit }, { count: pendingAdj }] = await Promise.all([
    supabase.from("warehouses").select("id, code, name").eq("is_active", true).order("code"),
    supabase.rpc("inventory_valuation"),
    supabase.from("v_product_inventory").select("below_min, physical_qty, stock_value").eq("item_type", "stock").eq("is_active", true),
    supabase.from("stock_transfers").select("id", { count: "exact", head: true }).eq("status", "in_transit"),
    supabase.from("stock_adjustments").select("id", { count: "exact", head: true }).eq("status", "submitted"),
  ]);
  const lowCount = (allSummary ?? []).filter((r) => r.below_min).length;
  const totalValue = (valuation ?? []).reduce((s: number, r: any) => s + Number(r.stock_value), 0);
  const negative = (allSummary ?? []).filter((r) => Number(r.physical_qty) < 0).length;

  let rows: any[] = [];
  if (byWarehouse) {
    let q = supabase.from("v_inventory_position").select("*").eq("warehouse_id", sp.warehouse!).order("product_name").limit(500);
    if (term) q = q.or(`product_name.ilike.%${term}%,sku.ilike.%${term}%`);
    if (sp.filter === "reserved") q = q.gt("reserved_qty", 0);
    if (sp.filter === "negative") q = q.lt("physical_qty", 0);
    rows = (await q).data ?? [];
  } else {
    let q = supabase.from("v_product_inventory").select("*").eq("item_type", "stock").eq("is_active", true).order("product_name").limit(500);
    if (term) q = q.or(`product_name.ilike.%${term}%,sku.ilike.%${term}%`);
    if (sp.filter === "low") q = q.eq("below_min", true);
    if (sp.filter === "reserved") q = q.gt("reserved_qty", 0);
    if (sp.filter === "negative") q = q.lt("physical_qty", 0);
    rows = (await q).data ?? [];
  }
  const showValue = can(user, "inventory.view_valuation");

  return (
    <>
      <PageHeader title="Stock overview" description="Available = physical − reserved. Incoming = transfers in transit and open purchase orders."
        actions={can(user, "inventory.receive") && <Link href="/inventory/receipts/new" className={buttonVariants()}>Receive goods</Link>} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {showValue && <StatCard label="Stock value" value={formatMoney(totalValue)} hint="AED, weighted average cost" />}
        <StatCard label="Stock items" value={(allSummary ?? []).length} />
        <StatCard label="Below minimum" value={lowCount} tone={lowCount ? "danger" : "success"} hint={<Link className="hover:underline" href="?filter=low">View items</Link>} />
        <StatCard label="Transfers in transit" value={inTransit ?? 0} hint={<Link className="hover:underline" href="/inventory/transfers?status=in_transit">View transfers</Link>} />
        <StatCard label="Adjustments awaiting approval" value={pendingAdj ?? 0} tone={pendingAdj ? "warning" : "default"}
          hint={<Link className="hover:underline" href="/inventory/adjustments?status=submitted">Review</Link>} />
      </div>
      {negative > 0 && <p className="mb-4 text-sm text-red-700">{negative} item(s) have negative stock (authorised by management). <Link className="underline" href="?filter=negative">Show</Link></p>}

      {showValue && (valuation ?? []).length > 1 && (
        <Card className="mb-6">
          <Table>
            <THead><TR><TH>Warehouse</TH><TH numeric>Items in stock</TH><TH numeric>Stock value (AED)</TH></TR></THead>
            <TBody>
              {(valuation ?? []).map((w: any) => (
                <TR key={w.warehouse_id}>
                  <TD><Link href={`?warehouse=${w.warehouse_id}`} className="font-medium text-navy-800 hover:underline">{w.warehouse_name}</Link> <span className="text-xs text-slate-500">{w.warehouse_code}</span></TD>
                  <TD numeric>{w.products}</TD>
                  <TD numeric>{formatMoney(w.stock_value)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <Input name="q" defaultValue={sp.q} placeholder="Search product or SKU" className="pl-9" />
          </div>
          {can(user, "inventory.view") && (
            <Select name="warehouse" defaultValue={sp.warehouse ?? ""} className="w-60">
              <option value="">All warehouses (totals)</option>
              {(warehouses ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          )}
          <Select name="filter" defaultValue={sp.filter ?? ""} className="w-48">
            <option value="">All items</option>
            {!byWarehouse && <option value="low">Below minimum</option>}
            <option value="reserved">With reservations</option>
            <option value="negative">Negative stock</option>
          </Select>
          <button className={buttonVariants({ variant: "outline" })}>Apply</button>
        </form>
        <Table>
          <THead>
            <TR>
              <TH>SKU</TH><TH>Product</TH><TH>UoM</TH>
              <TH numeric>Physical</TH><TH numeric>Reserved</TH><TH numeric>Available</TH><TH numeric>Incoming</TH>
              {!byWarehouse && <TH numeric>Minimum</TH>}
              {showValue && <><TH numeric>Avg cost</TH><TH numeric>Value (AED)</TH></>}
              {!byWarehouse && <TH />}
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={11}>No stock items match.</EmptyRow>}
            {rows.map((r) => (
              <TR key={`${r.product_id}-${r.warehouse_id ?? "all"}`}>
                <TD className="font-mono text-xs">{r.sku}</TD>
                <TD><Link href={`/products/${r.product_id}`} className="font-medium text-navy-800 hover:underline">{r.product_name}</Link></TD>
                <TD>{r.uom_code}</TD>
                <TD numeric className={Number(r.physical_qty) < 0 ? "font-semibold text-red-700" : ""}>{formatQty(r.physical_qty)}</TD>
                <TD numeric>{formatQty(r.reserved_qty)}</TD>
                <TD numeric className="font-medium">{formatQty(r.available_qty)}</TD>
                <TD numeric>{formatQty(r.incoming_qty)}</TD>
                {!byWarehouse && <TD numeric>{formatQty(r.min_stock_level)}</TD>}
                {showValue && <><TD numeric>{formatMoney(r.avg_cost)}</TD><TD numeric>{formatMoney(r.stock_value)}</TD></>}
                {!byWarehouse && <TD>{r.below_min && <Badge tone="red">Below min.</Badge>}</TD>}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
