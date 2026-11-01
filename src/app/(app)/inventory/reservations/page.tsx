import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTime, formatQty } from "@/lib/utils";
import { ReleaseForm } from "./release-form";

export const metadata: Metadata = { title: "Stock reservations" };

export default async function ReservationsPage({ searchParams }: { searchParams: Promise<{ warehouse?: string }> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("stock_reservations")
    .select("id, qty, created_at, product:products(id, sku, name, uom:units_of_measure(code)), warehouse:warehouses(code), line:sales_order_lines(line_no, fulfilment_mode, sales_order:sales_orders(doc_no, required_date, customer:customers(name)))")
    .eq("status", "active").order("created_at", { ascending: false }).limit(500);
  if (sp.warehouse) q = q.eq("warehouse_id", sp.warehouse);
  const [{ data: rows }, { data: warehouses }] = await Promise.all([q, supabase.from("warehouses").select("id, name").order("code")]);
  const canRelease = can(user, "inventory.reserve");

  return (
    <>
      <PageHeader title="Stock reservations" description="Stock set aside for confirmed customer orders. Reserved stock cannot be issued, transferred or adjusted away." />
      <Card>
        <form className="flex gap-3 border-b border-slate-200 p-4">
          <Select name="warehouse" defaultValue={sp.warehouse ?? ""} className="w-60">
            <option value="">All warehouses</option>
            {(warehouses ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
        </form>
        <Table>
          <THead><TR><TH>Sales order</TH><TH>Customer</TH><TH>Product</TH><TH>Warehouse</TH><TH numeric>Reserved</TH><TH>Since</TH>{canRelease && <TH />}</TR></THead>
          <TBody>
            {(rows ?? []).length === 0 && <EmptyRow colSpan={7}>No active reservations.</EmptyRow>}
            {(rows ?? []).map((r: any) => (
              <TR key={r.id}>
                <TD className="font-mono text-xs">{r.line?.sales_order?.doc_no ?? "—"} <span className="text-slate-400">/ {r.line?.line_no}</span>
                  {r.line?.fulfilment_mode === "procure" && <span className="ml-1 font-sans text-xs text-sky-700">back-to-back</span>}</TD>
                <TD>{r.line?.sales_order?.customer?.name ?? "—"}</TD>
                <TD><Link href={`/products/${r.product.id}`} className="hover:underline">{r.product.name}</Link> <span className="font-mono text-xs text-slate-500">{r.product.sku}</span></TD>
                <TD>{r.warehouse?.code}</TD>
                <TD numeric>{formatQty(r.qty)} <span className="text-xs text-slate-400">{r.product.uom?.code}</span></TD>
                <TD className="whitespace-nowrap">{formatDateTime(r.created_at)}</TD>
                {canRelease && <TD className="text-right"><ReleaseForm reservationId={r.id} max={Number(r.qty)} /></TD>}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
