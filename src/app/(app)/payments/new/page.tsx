import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PaymentForm } from "@/components/finance/payment-form";

export const metadata: Metadata = { title: "Record receipt" };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ invoice?: string; customer?: string }> }) {
  await requirePermission("payment.record");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: customers }, { data: banks }, { data: cur }, { data: settings }, inv] = await Promise.all([
    supabase.from("customers").select("id, name, currency_code").order("name"),
    supabase.from("bank_accounts").select("id, name, currency_code").eq("is_active", true).order("name"),
    supabase.from("currencies").select("code").eq("is_active", true).order("code"),
    supabase.from("company_settings").select("base_currency").single(),
    sp.invoice && /^[0-9a-f-]{36}$/i.test(sp.invoice) ? supabase.from("customer_invoices").select("customer_id").eq("id", sp.invoice).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return (
    <>
      <PageHeader title="Record customer receipt" back={{ href: "/payments", label: "Receipts" }} description="Money received from a customer, applied to one or more open invoices." />
      <PaymentForm customers={customers ?? []} banks={banks ?? []} currencies={cur ?? []} baseCurrency={settings?.base_currency ?? "AED"}
        initial={{ customer_id: inv.data?.customer_id ?? sp.customer, invoice_id: sp.invoice }} />
    </>
  );
}
