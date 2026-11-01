import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSalesLookups } from "@/lib/sales";
import { PageHeader } from "@/components/layout/page-header";
import { CustomerForm } from "../../customer-form";

export const metadata: Metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("customer.edit");
  const supabase = await createClient();
  const { data: c } = await supabase.from("customers")
    .select("*, contacts:customer_contacts(*), addresses:customer_addresses(*)").eq("id", id).maybeSingle();
  if (!c) notFound();
  return (
    <>
      <PageHeader title={`Edit ${c.name}`} back={{ href: `/customers/${id}`, label: c.code }} />
      <CustomerForm lookups={await loadSalesLookups()} currentUserId={user.id} initial={c}
        perms={{ setCredit: can(user, "customer.set_credit"), assign: can(user, "customer.assign") }} />
    </>
  );
}
