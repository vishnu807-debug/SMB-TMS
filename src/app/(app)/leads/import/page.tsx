import type { Metadata } from "next";
import { can, requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { BulkImport } from "@/components/import/bulk-import";
import { commitLeadImport, previewLeadImport, searchImportCustomers } from "./actions";

export const metadata: Metadata = { title: "Import enquiries" };

export default async function ImportLeadsPage() {
  const user = await requirePermission("lead.create");
  return (
    <>
      <PageHeader title="Import enquiries" back={{ href: "/leads", label: "Leads & enquiries" }}
        description="Upload enquiries from Excel or CSV. Each row is linked to an existing customer; when a customer is not found you choose what to do before importing." />
      <BulkImport entity="leads" preview={previewLeadImport} commit={commitLeadImport} searchCustomers={searchImportCustomers}
        canCreateCustomers={can(user, "customer.create")} />
    </>
  );
}
