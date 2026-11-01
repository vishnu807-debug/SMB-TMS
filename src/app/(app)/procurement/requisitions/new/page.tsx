import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { RequisitionForm } from "@/components/procurement/requisition-form";

export const metadata: Metadata = { title: "New requisition" };

export default async function NewRequisitionPage() {
  await requirePermission("purchase_requisition.manage");
  const supabase = await createClient();
  const { data: suppliers } = await supabase.from("suppliers").select("id, name").in("status", ["active", "on_hold"]).order("name");
  return (
    <>
      <PageHeader title="New purchase requisition" back={{ href: "/procurement", label: "Procurement" }}
        description="A request to buy items for stock. Customer-order requisitions are raised automatically when a sales order is confirmed." />
      <RequisitionForm suppliers={suppliers ?? []} />
    </>
  );
}
