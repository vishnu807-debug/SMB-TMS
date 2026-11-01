import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { loadProductLookups } from "../../lookups";
import { ProductForm } from "../../product-form";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("product.edit");
  const supabase = await createClient();
  const { data: p } = await supabase
    .from("products")
    .select("*, supplier:suppliers(name)")
    .eq("id", id)
    .maybeSingle();
  if (!p) notFound();
  const lookups = await loadProductLookups(user);
  return (
    <>
      <PageHeader title={`Edit ${p.name}`} back={{ href: `/products/${id}`, label: p.sku }} />
      <ProductForm lookups={lookups} initial={{ ...p, default_supplier_name: p.supplier?.name ?? null }} />
    </>
  );
}
