import type { Metadata } from "next";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSalesLookups } from "@/lib/sales";
import { PageHeader } from "@/components/layout/page-header";
import { LeadForm } from "../lead-form";

export const metadata: Metadata = { title: "New enquiry" };

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const user = await requirePermission("lead.create");
  const { customer } = await searchParams;
  const supabase = await createClient();
  const { data: customers } = await supabase.from("customers").select("id, name, code").in("status", ["active", "on_hold"]).order("name");
  const lookups = await loadSalesLookups();
  return (
    <>
      <PageHeader title="Register enquiry" back={{ href: "/leads", label: "Leads & enquiries" }} />
      <LeadForm lookups={lookups} customers={customers ?? []} canAssign={can(user, "lead.assign")} currentUserId={user.id}
        initial={customer ? { source: "existing_customer", currency_code: lookups.baseCurrency, probability: 30, priority: "medium", owner_id: user.id, customer_id: customer } : undefined} />
    </>
  );
}
