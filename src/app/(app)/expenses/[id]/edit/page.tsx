import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { ExpenseForm } from "@/components/finance/expense-form";

export const metadata: Metadata = { title: "Edit expense claim" };

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data: e }, { data: cats }] = await Promise.all([
    supabase.from("expenses").select("*").eq("id", id).maybeSingle(),
    supabase.from("expense_categories").select("id, name").eq("is_active", true).order("name"),
  ]);
  if (!e) notFound();
  if (e.created_by !== user.id || !["draft", "rejected"].includes(e.status)) redirect(`/expenses/${id}`);
  return (
    <>
      <PageHeader title={`Edit ${e.doc_no}`} back={{ href: `/expenses/${id}`, label: e.doc_no }} />
      <ExpenseForm categories={cats ?? []} initial={Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v ?? ""]))} />
    </>
  );
}
