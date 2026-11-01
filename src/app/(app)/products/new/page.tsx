import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { loadProductLookups } from "../lookups";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const user = await requirePermission("product.edit");
  const lookups = await loadProductLookups(user);
  return (
    <>
      <PageHeader title="New product" back={{ href: "/products", label: "Products" }} description="Image and attachments can be added after the product is saved." />
      <ProductForm lookups={lookups} />
    </>
  );
}
