import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadSalesLookups } from "@/lib/sales";
import type { CurrentUser } from "@/lib/auth/session";

export async function loadEditorData(user: CurrentUser) {
  const supabase = await createClient();
  const [lookups, { data: customers }, { data: rules }] = await Promise.all([
    loadSalesLookups(),
    supabase.from("customers").select("id, name, code").eq("status", "active").order("name"),
    supabase.from("approval_rules").select("metric, comparison, threshold, name").eq("doc_type", "quotation").eq("is_active", true),
  ]);
  return {
    lookups, customers: customers ?? [],
    rules: (rules ?? []).map((r) => ({ ...r, threshold: Number(r.threshold) })),
    canViewCost: user.permissions.has("quotation.view_cost"),
    canChooseRep: user.permissions.has("quotation.view_all"),
    currentUserId: user.id,
  };
}
