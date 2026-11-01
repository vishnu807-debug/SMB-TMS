import type { Metadata } from "next";
import { requirePermission, can } from "@/lib/auth/session";
import { loadSalesLookups } from "@/lib/sales";
import { PageHeader } from "@/components/layout/page-header";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const user = await requirePermission("customer.create");
  return (
    <>
      <PageHeader title="New customer" description="The customer code is assigned automatically." back={{ href: "/customers", label: "Customers" }} />
      <CustomerForm lookups={await loadSalesLookups()} currentUserId={user.id}
        perms={{ setCredit: can(user, "customer.set_credit"), assign: can(user, "customer.assign") }} />
    </>
  );
}
