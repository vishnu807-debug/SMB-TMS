"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";
import { str } from "@/lib/utils";

const uuid = z.string().uuid();
const optUuid = z.union([z.literal(""), z.string().uuid()]).transform((v) => v || null);
const money = z.union([z.literal(""), z.coerce.number().min(0, "Cannot be negative")]).transform((v) => (v === "" ? null : v));

const productSchema = z.object({
  id: optUuid,
  sku: z.string().trim().toUpperCase().max(40).regex(/^$|^[A-Z0-9][A-Z0-9._/-]{1,39}$/, "Letters, numbers and . _ / - only"),
  name: z.string().trim().min(2, "Enter a product name").max(200),
  item_type: z.enum(["stock", "non_stock", "service"]),
  category_id: optUuid,
  brand_id: optUuid,
  new_brand: z.string().trim().max(80),
  uom_id: uuid.or(z.literal("")).refine((v) => v !== "", "Select a unit"),
  description: z.string().trim().max(4000),
  model_no: z.string().trim().max(80),
  barcode: z.string().trim().max(60),
  hs_code: z.string().trim().max(20),
  default_supplier_id: optUuid,
  currency_code: z.string().length(3),
  purchase_price: money,
  default_sell_price: money,
  tax_code_id: optUuid,
  min_stock_level: money,
  reorder_qty: money,
  technical_specs: z.string().transform((s, ctx) => {
    try {
      const v = JSON.parse(s || "[]");
      if (!Array.isArray(v)) throw new Error();
      return v as { name: string; value: string }[];
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid specifications" });
      return z.NEVER;
    }
  }),
});

export type ProductFormState = ActionResult<{ id: string }> | undefined;

export async function saveProduct(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const raw = Object.fromEntries(["id", "sku", "name", "item_type", "category_id", "brand_id", "new_brand", "uom_id", "description",
    "model_no", "barcode", "hs_code", "default_supplier_id", "currency_code", "purchase_price", "default_sell_price", "tax_code_id",
    "min_stock_level", "reorder_qty", "technical_specs"].map((k) => [k, str(formData.get(k))]));
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    parsed.error.issues.forEach((i) => (fieldErrors[String(i.path[0])] ??= i.message));
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors };
  }
  const d = parsed.data;
  const supabase = await createClient();

  let brandId = d.brand_id;
  if (!brandId && d.new_brand) {
    const { data: existing } = await supabase.from("brands").select("id").ilike("name", d.new_brand).maybeSingle();
    if (existing) brandId = existing.id;
    else {
      const { data: created, error } = await supabase.from("brands").insert({ name: d.new_brand }).select("id").single();
      if (error) return { ok: false, error: userMessage(error) };
      brandId = created.id;
    }
  }

  const { data: id, error } = await supabase.rpc("save_product", {
    p: { ...d, brand_id: brandId, new_brand: undefined },
  });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/products");
  redirect(`/products/${id}`);
}

export async function setProductActive(id: string, active: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid product." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_product_active", { p_id: id, p_active: active });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/products/${id}`);
  revalidatePath("/products");
  return { ok: true };
}

/** Called after the browser has uploaded the file to Storage (Storage RLS checks product.edit). */
export async function recordProductFile(input: {
  productId: string; path: string; fileName: string; mimeType: string; size: number; kind: string; asImage: boolean;
}): Promise<ActionResult> {
  const v = z.object({
    productId: uuid,
    path: z.string().startsWith(`products/${input.productId}/`),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().max(120),
    size: z.number().int().positive().max(25 * 1024 * 1024),
    kind: z.enum(["datasheet", "certificate", "manual", "drawing", "image", "other"]),
    asImage: z.boolean(),
  }).safeParse(input);
  if (!v.success) return { ok: false, error: "Invalid file." };
  const supabase = await createClient();
  if (v.data.asImage) {
    const { error } = await supabase.rpc("set_product_image", { p_id: v.data.productId, p_path: v.data.path });
    if (error) return { ok: false, error: userMessage(error) };
  } else {
    const { error } = await supabase.from("product_attachments").insert({
      product_id: v.data.productId, storage_path: v.data.path, file_name: v.data.fileName,
      mime_type: v.data.mimeType, size_bytes: v.data.size, kind: v.data.kind,
    });
    if (error) {
      await supabase.storage.from("product-media").remove([v.data.path]);
      return { ok: false, error: userMessage(error) };
    }
  }
  revalidatePath(`/products/${v.data.productId}`);
  return { ok: true };
}

export async function deleteProductAttachment(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid attachment." };
  const supabase = await createClient();
  const { data: att, error } = await supabase.from("product_attachments").delete().eq("id", id).select("product_id, storage_path").single();
  if (error) return { ok: false, error: userMessage(error) };
  await supabase.storage.from("product-media").remove([att.storage_path]);
  revalidatePath(`/products/${att.product_id}`);
  return { ok: true };
}

export async function removeProductImage(productId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: p } = await supabase.from("products").select("image_path").eq("id", productId).single();
  const { error } = await supabase.rpc("set_product_image", { p_id: productId, p_path: null });
  if (error) return { ok: false, error: userMessage(error) };
  if (p?.image_path) await supabase.storage.from("product-media").remove([p.image_path]);
  revalidatePath(`/products/${productId}`);
  return { ok: true };
}

/** Product picker search for inventory documents. */
export async function searchProducts(q: string, stockOnly = true) {
  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select("id, sku, name, item_type, uom:units_of_measure(code)")
    .eq("is_active", true)
    .order("name")
    .limit(20);
  if (stockOnly) query = query.eq("item_type", "stock");
  const term = q.trim().replace(/[%,()]/g, " ");
  if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.eq.${term}`);
  const { data } = await query;
  return (data ?? []).map((p: any) => ({ id: p.id as string, sku: p.sku as string, name: p.name as string, uom: p.uom?.code as string }));
}

// ---------------------------------------------------------------------------
// Categories (direct table writes; RLS requires category.manage, the database
// trigger prevents cycles and duplicate names)
// ---------------------------------------------------------------------------
const categorySchema = z.object({
  id: optUuid,
  name: z.string().trim().min(1, "Enter a name").max(100),
  code: z.string().trim().toUpperCase().max(20),
  parent_id: optUuid,
  description: z.string().trim().max(500),
  sort_order: z.coerce.number().int().min(0).max(9999).catch(0),
  is_active: z.string().transform((v) => v === "on" || v === "true"),
});

export async function saveCategory(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const parsed = categorySchema.safeParse({
    id: str(formData.get("id")), name: str(formData.get("name")), code: str(formData.get("code")),
    parent_id: str(formData.get("parent_id")), description: str(formData.get("description")),
    sort_order: str(formData.get("sort_order")) || "0", is_active: str(formData.get("is_active")) || "false",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, ...row } = parsed.data;
  const supabase = await createClient();
  const payload = { ...row, code: row.code || null, description: row.description || null };
  const { error } = id
    ? await supabase.from("product_categories").update(payload).eq("id", id)
    : await supabase.from("product_categories").insert(payload);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "A category with this name already exists at this level (or the code is taken)." };
    return { ok: false, error: userMessage(error) };
  }
  revalidatePath("/products/categories");
  return { ok: true, message: id ? "Category updated." : "Category created." };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_product_category", { p_id: id });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/products/categories");
  return { ok: true, message: "Category deleted." };
}
