import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Activity } from "@/components/sales/activity-panel";

export async function loadActivities(filter: Partial<Record<"lead_id" | "customer_id" | "quotation_id" | "sales_order_id", string>>): Promise<Activity[]> {
  const supabase = await createClient();
  let q = supabase.from("activities")
    .select("id, activity_type, subject, notes, due_at, completed_at, outcome, created_at, owner:profiles!activities_owner_id_fkey(full_name)")
    .order("completed_at", { ascending: false, nullsFirst: true }).order("due_at", { ascending: true }).limit(100);
  for (const [k, v] of Object.entries(filter)) if (v) q = q.eq(k, v);
  const { data } = await q;
  return (data ?? []).map((a: any) => ({ ...a, owner_name: a.owner?.full_name ?? null }));
}
