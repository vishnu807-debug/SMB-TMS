import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { SupplierPaymentForm } from "@/components/finance/supplier-payment-form";

export const metadata: Metadata = { title: "Pay supplier" };

export default async function NewSupplierPaymentPage({ searchParams }: { searchParams: Promise<{ bill?: string }> }) {
  await requirePermission("payable.manage");
  const { bill } = await searchParams;
  const supabase = await createClient();
  const [{ data: suppliers }, { data: banks }, { data: cur }, { data: settings }, b] = await Promise.all([
    supabase.from("suppliers").select("id, name, currency_code, bank_details").order("name"),
    supabase.from("bank_accounts").select("id, name, currency_code").eq("is_active", true).order("name"),
    supabase.from("currencies").select("code").eq("is_active", true).order("code"),
    supabase.from("company_settings").select("base_currency").single(),
    bill && /^[0-9a-f-]{36}$/i.test(bill) ? supabase.from("supplier_bills").select("supplier_id").eq("id", bill).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return (
    <>
      <PageHeader title="Pay supplier" back={{ href: "/payables?tab=payments", label: "Payables" }} description="Only approved bills can be paid. One payment can settle several bills." />
      <SupplierPaymentForm suppliers={suppliers ?? []} banks={banks ?? []} currencies={cur ?? []} baseCurrency={settings?.base_currency ?? "AED"}
        initial={{ supplier_id: b.data?.supplier_id, bill_id: bill }} />
    </>
  );
}
