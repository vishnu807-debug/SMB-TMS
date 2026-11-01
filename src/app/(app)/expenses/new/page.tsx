import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { ExpenseForm } from "@/components/finance/expense-form";

export const metadata: Metadata = { title: "New expense claim" };

export default async function NewExpensePage() {
  await requirePermission("expense.submit");
  const { data } = await (await createClient()).from("expense_categories").select("id, name").eq("is_active", true).order("name");
  return (
    <>
      <PageHeader title="New expense claim" back={{ href: "/expenses", label: "Expenses" }} description="Save, attach the receipt, then submit it for approval." />
      <ExpenseForm categories={data ?? []} />
    </>
  );
}
