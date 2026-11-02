import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { BulkImport } from "@/components/import/bulk-import";
import { commitCustomerImport, previewCustomerImport } from "./actions";

export const metadata: Metadata = { title: "Import customers" };

export default async function ImportCustomersPage() {
  await requirePermission("customer.create");
  return (
    <>
      <PageHeader title="Import customers" back={{ href: "/customers", label: "Customers" }}
        description="Upload many customers at once from Excel or CSV. Every row is checked and duplicates are caught before anything is saved." />
      <BulkImport entity="customers" preview={previewCustomerImport} commit={commitCustomerImport} />
    </>
  );
}
