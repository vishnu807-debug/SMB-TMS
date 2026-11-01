import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/auth/session";

export type ProductLookups = Awaited<ReturnType<typeof loadProductLookups>>;

export async function loadProductLookups(user: CurrentUser) {
  const supabase = await createClient();
  const [cats, brands, uoms, taxes, currencies, suppliers] = await Promise.all([
    supabase.from("v_product_categories").select("id, full_path, depth, is_active").order("sort_path"),
    supabase.from("brands").select("id, name").eq("is_active", true).order("name"),
    supabase.from("units_of_measure").select("id, code, name").eq("is_active", true).order("code"),
    supabase.from("tax_codes").select("id, code, name, is_default").eq("is_active", true).order("rate", { ascending: false }),
    supabase.from("currencies").select("code, name").eq("is_active", true).order("code"),
    user.permissions.has("supplier.view")
      ? supabase.from("suppliers").select("id, code, name").in("status", ["active", "on_hold"]).order("name")
      : Promise.resolve({ data: [] as { id: string; code: string; name: string }[] }),
  ]);
  return {
    categories: cats.data ?? [],
    brands: brands.data ?? [],
    uoms: uoms.data ?? [],
    taxCodes: taxes.data ?? [],
    currencies: currencies.data ?? [],
    suppliers: suppliers.data ?? [],
    canViewCost: user.permissions.has("product.view_cost"),
    canViewSuppliers: user.permissions.has("supplier.view"),
  };
}
