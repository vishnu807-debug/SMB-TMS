import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { loadProcurementLookups } from "@/lib/procurement/lookups";
import { SupplierForm } from "../../supplier-form";

export const metadata: Metadata = { title: "Edit supplier" };

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("supplier.edit");
  const supabase = await createClient();
  const [{ data: s }, l] = await Promise.all([
    supabase.from("suppliers").select("*, contacts:supplier_contacts(id, name, designation, email, phone, is_primary)").eq("id", id).maybeSingle(),
    loadProcurementLookups(),
  ]);
  if (!s) notFound();
  const initial = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v ?? ""]));
  initial.contacts = (s.contacts ?? []).map((c: any) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ""])));
  return (
    <>
      <PageHeader title={`Edit ${s.name}`} back={{ href: `/suppliers/${id}`, label: s.code }} />
      <SupplierForm lookups={{ currencies: l.currencies, paymentTerms: l.paymentTerms, baseCurrency: l.baseCurrency }} initial={initial} />
    </>
  );
}
