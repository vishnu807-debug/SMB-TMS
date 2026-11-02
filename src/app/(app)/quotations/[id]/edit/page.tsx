import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { QuotationEditor, type QuoteLine } from "@/components/quotations/quotation-editor";
import { specsToText } from "@/lib/quote-lines";
import { loadEditorData } from "../../editor-data";

export const metadata: Metadata = { title: "Edit quotation" };

export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("quotation.edit");
  const supabase = await createClient();
  const [{ data: q }, { data: lines }, { data: costs }, { data: stock }, { data: docs }] = await Promise.all([
    supabase.from("quotations").select("*").eq("id", id).maybeSingle(),
    supabase.from("quotation_lines").select("*, product:products(id, sku, name, item_type, uom:units_of_measure(code)), qp:quote_products(id, name, brand, model_no, description, technical_specs, uom_id)")
      .eq("quotation_id", id).order("line_no"),
    supabase.from("quotation_line_costs").select("line_id, unit_cost").eq("quotation_id", id),
    supabase.from("v_product_stock").select("product_id, qty_available"),
    supabase.from("quotation_documents").select("id, file_name, product_id, quote_product_id, product_attachment_id, kind").eq("quotation_id", id).order("created_at"),
  ]);
  if (!q) notFound();
  if (q.status !== "draft") redirect(`/quotations/${id}`);
  const productIds = [...new Set((lines ?? []).map((l: any) => l.product_id).filter(Boolean))] as string[];
  const { data: catalogueDocs } = productIds.length
    ? await supabase.from("product_attachments").select("id, product_id, file_name, kind").in("product_id", productIds).neq("kind", "image").order("file_name")
    : { data: [] as { id: string; product_id: string; file_name: string; kind: string }[] };

  const cost = new Map((costs ?? []).map((c) => [c.line_id, c.unit_cost]));
  const avail = new Map((stock ?? []).map((s) => [s.product_id, Number(s.qty_available)]));
  const header: Record<string, any> = Object.fromEntries(Object.entries(q).map(([k, v]) => [k, typeof v === "number" ? String(v) : v]));
  const seenProduct = new Set<string>();
  const initLines: QuoteLine[] = (lines ?? []).map((l: any) => {
    const isNew = !l.product;
    // Documents are shown on the first line of a product only.
    const first = l.product_id && !seenProduct.has(l.product_id);
    if (l.product_id) seenProduct.add(l.product_id);
    const reuseDocs = (docs ?? []).filter((d) => d.product_attachment_id);
    return {
      key: l.id, kind: isNew ? "new" : "catalogue",
      product: l.product ? { id: l.product.id, sku: l.product.sku, name: l.product.name, uom: l.product.uom?.code ?? "" } : null,
      quote_product_id: l.quote_product_id ?? undefined,
      np: isNew
        ? { id: l.qp.id, name: l.qp.name, brand: l.qp.brand ?? "", model_no: l.qp.model_no ?? "", description: l.qp.description ?? "", specs: specsToText(l.qp.technical_specs), uom_id: l.qp.uom_id }
        : { name: "", brand: "", model_no: "", description: "", specs: "", uom_id: "" },
      description: l.description, qty: String(l.qty), unit_price: String(l.unit_price), discount_pct: String(l.discount_pct),
      tax_code_id: l.tax_code_id, fulfilment_mode: l.fulfilment_mode, mode_locked: true, lead_time_text: l.lead_time_text ?? "",
      unit_cost: cost.has(l.id) ? String(cost.get(l.id)) : "",
      available: l.product?.item_type === "stock" ? avail.get(l.product.id) ?? 0 : null,
      item_type: l.product?.item_type ?? "non_stock",
      files: [],
      reuse: first ? (catalogueDocs ?? []).filter((a) => a.product_id === l.product_id).map((a) => {
        const doc = reuseDocs.find((d) => d.product_attachment_id === a.id);
        return { attachment_id: a.id, file_name: a.file_name, kind: a.kind, checked: !!doc, doc_id: doc?.id };
      }) : [],
      attached: (docs ?? []).filter((d) => !d.product_attachment_id && (isNew ? d.quote_product_id === l.quote_product_id : first && d.product_id === l.product_id))
        .map((d) => ({ id: d.id, file_name: d.file_name })),
    };
  });
  const general = (docs ?? []).filter((d) => !d.product_id && !d.quote_product_id).map((d) => ({ id: d.id, file_name: d.file_name }));
  return (
    <>
      <PageHeader title={`Edit ${q.doc_no}`} back={{ href: `/quotations/${id}`, label: q.doc_no }} />
      <QuotationEditor {...await loadEditorData(user)} initial={{ header, lines: initLines, documents: general }} />
    </>
  );
}
