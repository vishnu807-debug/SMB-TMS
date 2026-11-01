import type { Metadata } from "next";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { CategoryManager, type Cat } from "./category-manager";

export const metadata: Metadata = { title: "Product categories" };

export default async function CategoriesPage() {
  const user = await requirePermission("product.view");
  const supabase = await createClient();
  const [{ data: tree }, { data: details }] = await Promise.all([
    supabase.from("v_product_categories").select("*").order("sort_path"),
    supabase.from("product_categories").select("id, description"),
  ]);
  const desc = new Map((details ?? []).map((d) => [d.id, d.description]));
  const categories = (tree ?? []).map((c) => ({ ...c, description: desc.get(c.id) ?? null })) as Cat[];
  return (
    <>
      <PageHeader title="Product categories" description="Unlimited levels of categories and subcategories." back={{ href: "/products", label: "Products" }} />
      <CategoryManager categories={categories} canManage={can(user, "category.manage")} />
    </>
  );
}
