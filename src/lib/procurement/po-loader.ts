import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PoInitial, PoLine, SupplierContact } from "@/components/purchase-orders/po-editor";

export async function loadContactsAndTerms() {
  const supabase = await createClient();
  const [{ data: contacts }, { data: settings }] = await Promise.all([
    supabase.from("supplier_contacts").select("id, supplier_id, name, is_primary").order("name"),
    supabase.from("company_settings").select("purchase_order_terms").single(),
  ]);
  return { contacts: (contacts ?? []) as SupplierContact[], terms: settings?.purchase_order_terms ?? "" };
}

const picked = (p: any) => ({ id: p.id, sku: p.sku, name: p.name, uom: p.uom?.code ?? "" });

/** Existing draft → editor state. */
export async function loadPoForEdit(id: string): Promise<PoInitial | null> {
  const supabase = await createClient();
  const [{ data: po }, { data: lines }] = await Promise.all([
    supabase.from("purchase_orders").select("*").eq("id", id).maybeSingle(),
    supabase.from("purchase_order_lines").select("*, product:products(id, sku, name, uom:units_of_measure(code))").eq("purchase_order_id", id).order("line_no"),
  ]);
  if (!po) return null;
  const header = Object.fromEntries(Object.entries(po).map(([k, v]) => [k, v ?? ""]));
  return {
    header,
    lines: (lines ?? []).map((l: any): PoLine => ({
      key: l.id, product: picked(l.product), description: l.description, qty: String(Number(l.qty)), unit_cost: String(Number(l.unit_cost)),
      tax_code_id: l.tax_code_id, requisition_line_id: l.requisition_line_id ?? undefined, supplier_quotation_line_id: l.supplier_quotation_line_id ?? undefined,
      source: l.requisition_line_id ? "From requisition" : undefined,
    })),
  };
}

/** New PO prefilled from a supplier quotation or from selected open requisition lines. */
export async function loadPoPrefill(sp: { supplier?: string; quote?: string; lines?: string; warehouse?: string }): Promise<PoInitial | undefined> {
  const supabase = await createClient();
  if (sp.quote) {
    const [{ data: q }, { data: ql }] = await Promise.all([
      supabase.from("supplier_quotations").select("*").eq("id", sp.quote).maybeSingle(),
      supabase.from("supplier_quotation_lines").select("*, product:products(id, sku, name, tax_code_id, uom:units_of_measure(code))").eq("supplier_quotation_id", sp.quote).order("line_no"),
    ]);
    if (!q) return undefined;
    const open = await openQty((ql ?? []).map((l: any) => l.requisition_line_id).filter(Boolean));
    return {
      header: { supplier_id: q.supplier_id, supplier_quotation_id: q.id, supplier_reference: q.supplier_reference ?? q.doc_no, currency_code: q.currency_code,
        exchange_rate: String(q.exchange_rate), payment_term_id: q.payment_term_id ?? "" },
      lines: (ql ?? []).filter((l: any) => !l.requisition_line_id || (open[l.requisition_line_id] ?? 0) > 0).map((l: any): PoLine => {
        const max = l.requisition_line_id ? open[l.requisition_line_id] : undefined;
        return {
          key: l.id, product: picked(l.product), description: l.product.name, qty: String(Math.min(Number(l.qty), max ?? Infinity)),
          unit_cost: String(Number(l.unit_price)), tax_code_id: l.product.tax_code_id ?? "", requisition_line_id: l.requisition_line_id ?? undefined,
          supplier_quotation_line_id: l.id, source: `Quote ${q.doc_no}`, max_qty: max,
        };
      }),
    };
  }
  if (sp.lines) {
    const ids = sp.lines.split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100);
    const { data: rl } = await supabase.from("v_open_requisition_lines").select("*").in("id", ids);
    const productIds = (rl ?? []).map((r: any) => r.product_id);
    const supplier = sp.supplier || (rl ?? [])[0]?.suggested_supplier_id || "";
    const [{ data: prods }, { data: costs }] = await Promise.all([
      supabase.from("products").select("id, sku, name, purchase_price, tax_code_id, uom:units_of_measure(code)").in("id", productIds),
      supplier ? supabase.from("supplier_products").select("product_id, last_cost").eq("supplier_id", supplier).in("product_id", productIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    return {
      header: { supplier_id: supplier, ...(sp.warehouse ? { warehouse_id: sp.warehouse } : {}) },
      lines: (rl ?? []).map((r: any): PoLine => {
        const p: any = prods?.find((x: any) => x.id === r.product_id);
        const cost = costs?.find((c: any) => c.product_id === r.product_id)?.last_cost ?? p?.purchase_price;
        return {
          key: r.id, product: picked(p), description: r.description, qty: String(Number(r.qty_open)), unit_cost: cost != null ? String(Number(cost)) : "",
          tax_code_id: p?.tax_code_id ?? "", requisition_line_id: r.id, max_qty: Number(r.qty_open),
          source: `${r.requisition_no}${r.sales_order_no ? ` · ${r.sales_order_no} ${r.customer_name ?? ""}` : ""}`,
        };
      }),
    };
  }
  if (sp.supplier) return { header: { supplier_id: sp.supplier }, lines: [] };
  return undefined;
}

async function openQty(ids: string[]) {
  if (ids.length === 0) return {} as Record<string, number>;
  const supabase = await createClient();
  const { data } = await supabase.from("v_open_requisition_lines").select("id, qty_open").in("id", ids);
  return Object.fromEntries((data ?? []).map((r: any) => [r.id, Number(r.qty_open)]));
}
