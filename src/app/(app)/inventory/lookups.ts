import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/auth/session";
import type { DocFormLookups } from "@/components/inventory/stock-document-form";

export async function loadDocLookups(user: CurrentUser): Promise<DocFormLookups> {
  const supabase = await createClient();
  const [wh, sup, cur, settings] = await Promise.all([
    supabase.from("warehouses").select("id, code, name").eq("is_active", true).order("code"),
    user.permissions.has("supplier.view")
      ? supabase.from("suppliers").select("id, name, code").in("status", ["active", "on_hold"]).order("name")
      : Promise.resolve({ data: [] }),
    supabase.from("currencies").select("code").eq("is_active", true).order("code"),
    supabase.from("company_settings").select("base_currency").single(),
  ]);
  return {
    warehouses: wh.data ?? [],
    suppliers: (sup.data ?? []) as DocFormLookups["suppliers"],
    currencies: cur.data ?? [],
    baseCurrency: settings.data?.base_currency ?? "AED",
    canAuthoriseNegative: user.permissions.has("inventory.allow_negative"),
    canViewValuation: user.permissions.has("inventory.view_valuation"),
  };
}

/** Receiving against a purchase order: the PO header and the lines still due (less other draft receipts). */
export async function loadPoForReceipt(poId: string, excludeReceiptId?: string) {
  const supabase = await createClient();
  const [{ data: po }, { data: lines }] = await Promise.all([
    supabase.from("purchase_orders").select("id, doc_no, status, warehouse_id, currency_code, supplier:suppliers(name)").eq("id", poId).maybeSingle(),
    supabase.from("purchase_order_lines").select("id, line_no, qty, qty_received, unit_cost, is_cancelled, product:products(id, sku, name, item_type, uom:units_of_measure(code)), sol:sales_order_lines(sales_order:sales_orders(doc_no, customer:customers(name)))")
      .eq("purchase_order_id", poId).order("line_no"),
  ]);
  if (!po) return null;
  const ids = (lines ?? []).map((l: any) => l.id);
  const { data: pending } = ids.length
    ? await supabase.from("goods_receipt_lines").select("purchase_order_line_id, qty, receipt:goods_receipts!inner(id, status)").eq("receipt.status", "draft").in("purchase_order_line_id", ids)
    : { data: [] as any[] };
  const pendingBy: Record<string, number> = {};
  (pending ?? []).forEach((p: any) => { if (p.receipt?.id !== excludeReceiptId) pendingBy[p.purchase_order_line_id] = (pendingBy[p.purchase_order_line_id] ?? 0) + Number(p.qty); });
  return {
    po: { id: po.id, doc_no: po.doc_no, status: po.status, warehouse_id: po.warehouse_id, currency_code: po.currency_code, supplier: (po.supplier as any)?.name ?? "" },
    lines: (lines ?? []).filter((l: any) => !l.is_cancelled && l.product?.item_type === "stock").map((l: any) => ({
      id: l.id as string,
      product: { id: l.product.id, sku: l.product.sku, name: l.product.name, uom: l.product.uom?.code ?? "" },
      remaining: Math.max(Number(l.qty) - Number(l.qty_received) - (pendingBy[l.id] ?? 0), 0),
      unit_cost: String(Number(l.unit_cost)),
      label: l.sol?.sales_order ? `For ${l.sol.sales_order.doc_no} · ${l.sol.sales_order.customer?.name ?? ""}` : "For stock",
    })),
  };
}
