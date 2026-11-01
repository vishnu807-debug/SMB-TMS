import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { BillForm } from "@/components/finance/bill-form";
import { loadBillLookups } from "@/lib/finance/lookups";

export const metadata: Metadata = { title: "Enter supplier bill" };

export default async function NewBillPage({ searchParams }: { searchParams: Promise<{ po?: string }> }) {
  await requirePermission("payable.manage");
  const { po } = await searchParams;
  const lookups = await loadBillLookups();
  let initial: Record<string, any> | undefined;
  if (po && /^[0-9a-f-]{36}$/i.test(po)) {
    const { data } = await (await createClient()).from("purchase_orders").select("id, supplier_id").eq("id", po).maybeSingle();
    if (data) initial = { supplier_id: data.supplier_id, purchase_order_id: data.id, supplier_trn: lookups.suppliers.find((s) => s.id === data.supplier_id)?.trn ?? "" };
  }
  return (
    <>
      <PageHeader title="Enter supplier bill" back={{ href: "/payables", label: "Payables" }} description="Record a supplier's tax invoice. It is matched against the purchase order and the goods received." />
      <BillForm {...lookups} initial={initial} />
    </>
  );
}
