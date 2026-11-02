"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runImport } from "@/lib/import/server";
import type { CustomerOption } from "@/lib/import/types";

export async function previewLeadImport(rows: unknown) {
  return runImport("import_leads", rows, false);
}

export async function commitLeadImport(rows: unknown, fileName: string, token: string) {
  const res = await runImport("import_leads", rows, { fileName, token });
  revalidatePath("/leads");
  revalidatePath("/customers");
  return res;
}

/** Customers the signed-in user can see (RLS), for mapping enquiry rows. */
export async function searchImportCustomers(q: string): Promise<CustomerOption[]> {
  const term = q.trim().replace(/[%,()]/g, " ").slice(0, 80);
  const supabase = await createClient();
  let query = supabase.from("customers").select("id, code, name").in("status", ["active", "on_hold"]).order("name").limit(15);
  if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
  const { data } = await query;
  return data ?? [];
}
