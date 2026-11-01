import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTime, formatMoney, formatQty, humanize } from "@/lib/utils";
import { ActiveToggle } from "./active-toggle";
import { ProductAttachments, ProductImage } from "./product-media";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("product.view");
  const supabase = await createClient();
  const { data: p } = await supabase
    .from("products")
    .select("*, category:product_categories(id), brand:brands(name), uom:units_of_measure(code, name), tax:tax_codes(name), supplier:suppliers(name, code)")
    .eq("id", id)
    .maybeSingle();
  if (!p) notFound();

  const canInv = can(user, "inventory.view");
  const [{ data: catPath }, { data: summary }, { data: byWh }, { data: moves }, { data: atts }] = await Promise.all([
    p.category_id ? supabase.from("v_product_categories").select("full_path").eq("id", p.category_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("v_product_inventory").select("*").eq("product_id", id).maybeSingle(),
    canInv ? supabase.from("v_inventory_position").select("*").eq("product_id", id).order("warehouse_code") : Promise.resolve({ data: [] }),
    canInv ? supabase.from("v_stock_movements").select("*").eq("product_id", id).order("seq", { ascending: false }).limit(15) : Promise.resolve({ data: [] }),
    supabase.from("product_attachments").select("id, file_name, kind, size_bytes, storage_path").eq("product_id", id).order("created_at"),
  ]);

  // Private bucket → short-lived signed URLs.
  const paths = [p.image_path, ...(atts ?? []).map((a) => a.storage_path)].filter(Boolean) as string[];
  const { data: signed } = paths.length
    ? await supabase.storage.from("product-media").createSignedUrls(paths, 60 * 10)
    : { data: [] };
  const urlFor = (path: string | null) => (path ? signed?.find((s) => s.path === path)?.signedUrl ?? null : null);
  const isStock = p.item_type === "stock";
  const canEdit = can(user, "product.edit");
  const specs = (p.technical_specs ?? []) as { name: string; value: string }[];

  return (
    <>
      <PageHeader
        back={{ href: "/products", label: "Products" }}
        title={<span className="flex items-center gap-3">{p.name}{!p.is_active && <Badge>Inactive</Badge>}</span>}
        description={<span className="font-mono">{p.sku}</span>}
        actions={canEdit && (
          <>
            <ActiveToggle id={p.id} active={p.is_active} />
            <Link href={`/products/${p.id}/edit`} className={buttonVariants()}><Pencil /> Edit</Link>
          </>
        )}
      />

      {isStock && summary && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Physical" value={formatQty(summary.physical_qty)} hint={p.uom?.code} />
          <StatCard label="Reserved" value={formatQty(summary.reserved_qty)} hint="For customer orders" />
          <StatCard label="Available" value={formatQty(summary.available_qty)} tone={summary.below_min ? "danger" : "success"} hint="Physical − reserved" />
          <StatCard label="Incoming" value={formatQty(summary.incoming_qty)} hint="In transit / on order" />
          <StatCard label="Minimum level" value={formatQty(p.min_stock_level)} tone={summary.below_min ? "warning" : "default"} hint={summary.below_min ? "Below minimum" : undefined} />
          {summary.stock_value !== null && <StatCard label="Stock value" value={formatMoney(summary.stock_value)} hint={`AED · avg ${formatMoney(summary.avg_cost)}`} />}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["Type", humanize(p.item_type)],
                  ["Category", catPath?.full_path ?? "—"],
                  ["Brand", p.brand?.name ?? "—"],
                  ["Unit", p.uom ? `${p.uom.code} — ${p.uom.name}` : "—"],
                  ["Model number", p.model_no ?? "—"],
                  ["Barcode", p.barcode ?? "—"],
                  ["HS code", p.hs_code ?? "—"],
                  ["VAT category", p.tax?.name ?? "—"],
                  ["Default supplier", p.supplier ? `${p.supplier.name} (${p.supplier.code})` : "—"],
                  ["Selling price", formatMoney(p.default_sell_price, p.currency_code)],
                  ...(can(user, "product.view_cost") ? [["Purchase price", formatMoney(p.purchase_price, p.currency_code)]] : []),
                  ["Reorder quantity", isStock ? formatQty(p.reorder_qty) : "—"],
                ].map(([k, v]) => (
                  <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-slate-900">{v}</dd></div>
                ))}
              </dl>
              {p.description && <p className="mt-5 whitespace-pre-line border-t border-slate-100 pt-4 text-sm text-slate-700">{p.description}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Technical specifications</CardTitle></CardHeader>
            {specs.length ? (
              <Table><TBody>{specs.map((s, i) => (
                <TR key={i}><TD className="w-1/3 font-medium text-slate-600">{s.name}</TD><TD>{s.value}</TD></TR>
              ))}</TBody></Table>
            ) : <CardContent className="text-sm text-slate-500">No specifications recorded.</CardContent>}
          </Card>

          {isStock && canInv && (
            <Card>
              <CardHeader><CardTitle>Stock by warehouse</CardTitle></CardHeader>
              <Table>
                <THead><TR><TH>Warehouse</TH><TH numeric>Physical</TH><TH numeric>Reserved</TH><TH numeric>Available</TH><TH numeric>Incoming</TH>
                  {summary?.stock_value !== null && <><TH numeric>Avg cost</TH><TH numeric>Value</TH></>}</TR></THead>
                <TBody>
                  {(byWh ?? []).length === 0 && <EmptyRow colSpan={7}>No stock recorded in any warehouse.</EmptyRow>}
                  {(byWh ?? []).map((w) => (
                    <TR key={w.warehouse_id}>
                      <TD>{w.warehouse_name} <span className="text-xs text-slate-500">{w.warehouse_code}</span></TD>
                      <TD numeric className={Number(w.physical_qty) < 0 ? "font-semibold text-red-700" : ""}>{formatQty(w.physical_qty)}</TD>
                      <TD numeric>{formatQty(w.reserved_qty)}</TD>
                      <TD numeric>{formatQty(w.available_qty)}</TD>
                      <TD numeric>{formatQty(w.incoming_qty)}</TD>
                      {summary?.stock_value !== null && <><TD numeric>{formatMoney(w.avg_cost)}</TD><TD numeric>{formatMoney(w.stock_value)}</TD></>}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}

          {isStock && canInv && (
            <Card>
              <CardHeader>
                <CardTitle>Recent stock movements</CardTitle>
                <Link href={`/inventory/movements?product=${p.id}`} className="text-sm font-medium text-navy-700 hover:underline">Full history</Link>
              </CardHeader>
              <Table>
                <THead><TR><TH>Date</TH><TH>Type</TH><TH>Document</TH><TH>Warehouse</TH><TH numeric>Qty</TH><TH numeric>Physical after</TH><TH numeric>Reserved after</TH></TR></THead>
                <TBody>
                  {(moves ?? []).length === 0 && <EmptyRow colSpan={7}>No movements yet.</EmptyRow>}
                  {(moves ?? []).map((m) => (
                    <TR key={m.id}>
                      <TD className="whitespace-nowrap">{formatDateTime(m.moved_at)}</TD>
                      <TD>{humanize(m.movement_type)}</TD>
                      <TD className="font-mono text-xs">{m.source_doc_no ?? "—"}</TD>
                      <TD>{m.warehouse_code}</TD>
                      <TD numeric className={Number(m.on_hand_change) < 0 || Number(m.reserved_change) < 0 ? "text-red-700" : "text-emerald-700"}>
                        {Number(m.on_hand_change) !== 0 ? formatQty(m.on_hand_change) : `${formatQty(m.reserved_change)} res.`}
                      </TD>
                      <TD numeric>{formatQty(m.on_hand_after)}</TD>
                      <TD numeric>{formatQty(m.reserved_after)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Image</CardTitle></CardHeader>
            <CardContent><ProductImage productId={p.id} imageUrl={urlFor(p.image_path)} canEdit={canEdit} name={p.name} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Attachments</CardTitle></CardHeader>
            <CardContent>
              <ProductAttachments productId={p.id} canEdit={canEdit}
                attachments={(atts ?? []).map((a) => ({ ...a, url: urlFor(a.storage_path) }))} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
