import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSalesLookups } from "@/lib/sales";
import { PageHeader } from "@/components/layout/page-header";
import { LeadForm } from "../../lead-form";

export const metadata: Metadata = { title: "Edit enquiry" };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("lead.edit");
  const supabase = await createClient();
  const [{ data: lead }, { data: customers }] = await Promise.all([
    supabase.from("leads").select("*, items:lead_items(*, product:products(id, sku, name, uom:units_of_measure(code)))").eq("id", id).maybeSingle(),
    supabase.from("customers").select("id, name, code").in("status", ["active", "on_hold"]).order("name"),
  ]);
  if (!lead) notFound();
  if (["won", "lost"].includes(lead.stage)) redirect(`/leads/${id}`);
  return (
    <>
      <PageHeader title={`Edit ${lead.doc_no}`} back={{ href: `/leads/${id}`, label: lead.doc_no }} />
      <LeadForm lookups={await loadSalesLookups()} customers={customers ?? []} initial={lead} canAssign={can(user, "lead.assign")} currentUserId={user.id} />
    </>
  );
}
