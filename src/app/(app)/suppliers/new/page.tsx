import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { loadProcurementLookups } from "@/lib/procurement/lookups";
import { SupplierForm } from "../supplier-form";

export const metadata: Metadata = { title: "New supplier" };

export default async function NewSupplierPage() {
  await requirePermission("supplier.edit");
  const l = await loadProcurementLookups();
  return (
    <>
      <PageHeader title="New supplier" back={{ href: "/suppliers", label: "Suppliers" }} description="The supplier code is assigned automatically." />
      <SupplierForm lookups={{ currencies: l.currencies, paymentTerms: l.paymentTerms, baseCurrency: l.baseCurrency }} />
    </>
  );
}
