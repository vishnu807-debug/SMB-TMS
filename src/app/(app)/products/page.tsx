import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Search } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatMoney, formatQty } from "@/lib/utils";

export const metadata: Metadata = { title: "Products" };
const PAGE_SIZE = 50;

type Search = { q?: string; category?: string; status?: string; stock?: string; page?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("product.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  const { data: categories } = await supabase
    .from("v_product_categories").select("id, full_path, depth").order("sort_path");

  // Category filter includes all subcategories.
  let categoryIds: string[] | null = null;
  if (sp.category) {
    const { data } = await supabase.from("v_product_categories").select("id").contains("path_ids", [sp.category]);
    categoryIds = (data ?? []).map((c) => c.id);
  }
  // "Below minimum" filter comes from the inventory view.
  let lowIds: string[] | null = null;
  if (sp.stock === "low") {
    const { data } = await supabase.from("v_product_inventory").select("product_id").eq("below_min", true);
    lowIds = (data ?? []).map((r) => r.product_id);
  }

  let query = supabase
    .from("products")
    .select("id, sku, name, item_type, is_active, default_sell_price, currency_code, min_stock_level, image_path, category:product_categories(name), brand:brands(name), uom:units_of_measure(code)", { count: "exact" })
    .order("name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const term = (sp.q ?? "").trim().replace(/[%,()]/g, " ");
  if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.eq.${term},model_no.ilike.%${term}%`);
  if (categoryIds) query = query.in("category_id", categoryIds.length ? categoryIds : ["00000000-0000-0000-0000-000000000000"]);
  if (lowIds) query = query.in("id", lowIds.length ? lowIds : ["00000000-0000-0000-0000-000000000000"]);
  if (sp.status !== "all") query = query.eq("is_active", sp.status !== "inactive");
  const { data: products, count } = await query;

  const ids = (products ?? []).map((p) => p.id);
  const { data: stock } = ids.length
    ? await supabase.from("v_product_inventory").select("product_id, physical_qty, reserved_qty, available_qty, incoming_qty, below_min").in("product_id", ids)
    : { data: [] };
  const stockById = new Map((stock ?? []).map((s) => [s.product_id, s]));
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const qs = (patch: Partial<Search>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Products"
        description={`${count ?? 0} product${count === 1 ? "" : "s"}`}
        actions={can(user, "product.edit") && (
          <Link href="/products/new" className={buttonVariants()}><Plus /> New product</Link>
        )}
      />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <Input name="q" defaultValue={sp.q} placeholder="Search name, SKU, model or barcode" className="pl-9" />
          </div>
          <Select name="category" defaultValue={sp.category ?? ""} className="w-56">
            <option value="">All categories</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.full_path.split(" › ").pop()}</option>
            ))}
          </Select>
          <Select name="stock" defaultValue={sp.stock ?? ""} className="w-44">
            <option value="">All stock levels</option>
            <option value="low">Below minimum</option>
          </Select>
          <Select name="status" defaultValue={sp.status ?? "active"} className="w-36">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
        </form>
        <Table>
          <THead>
            <TR>
              <TH>SKU</TH><TH>Product</TH><TH>Category</TH><TH>UoM</TH>
              <TH numeric>Selling price</TH><TH numeric>Physical</TH><TH numeric>Reserved</TH>
              <TH numeric>Available</TH><TH numeric>Incoming</TH><TH numeric>Min.</TH><TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {(products ?? []).length === 0 && <EmptyRow colSpan={11}>No products match these filters.</EmptyRow>}
            {(products ?? []).map((p: any) => {
              const s = stockById.get(p.id);
              const isStock = p.item_type === "stock";
              return (
                <TR key={p.id}>
                  <TD className="font-mono text-xs">{p.sku}</TD>
                  <TD>
                    <Link href={`/products/${p.id}`} className="font-medium text-navy-800 hover:underline">{p.name}</Link>
                    {p.brand?.name && <span className="ml-1.5 text-xs text-slate-500">{p.brand.name}</span>}
                  </TD>
                  <TD className="text-slate-500">{p.category?.name ?? "—"}</TD>
                  <TD>{p.uom?.code}</TD>
                  <TD numeric>{formatMoney(p.default_sell_price, p.currency_code)}</TD>
                  <TD numeric>{isStock ? formatQty(s?.physical_qty) : "—"}</TD>
                  <TD numeric>{isStock ? formatQty(s?.reserved_qty) : "—"}</TD>
                  <TD numeric className={s?.below_min ? "font-semibold text-red-700" : ""}>{isStock ? formatQty(s?.available_qty) : "—"}</TD>
                  <TD numeric>{isStock ? formatQty(s?.incoming_qty) : "—"}</TD>
                  <TD numeric>{isStock ? formatQty(p.min_stock_level) : "—"}</TD>
                  <TD>
                    {!p.is_active ? <Badge>Inactive</Badge>
                      : !isStock ? <Badge tone="blue">{p.item_type === "service" ? "Service" : "Non-stock"}</Badge>
                      : s?.below_min ? <Badge tone="red">Below min.</Badge>
                      : <Badge tone="green">Active</Badge>}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              {page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs({ page: String(page - 1) })}>Previous</Link>}
              {page < totalPages && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs({ page: String(page + 1) })}>Next</Link>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
