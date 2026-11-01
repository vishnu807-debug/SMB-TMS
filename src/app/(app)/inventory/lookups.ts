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
