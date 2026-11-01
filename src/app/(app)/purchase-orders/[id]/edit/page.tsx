import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { PurchaseOrderEditor } from "@/components/purchase-orders/po-editor";
import { loadProcurementLookups } from "@/lib/procurement/lookups";
import { loadContactsAndTerms, loadPoForEdit } from "@/lib/procurement/po-loader";

export const metadata: Metadata = { title: "Edit purchase order" };

export default async function EditPoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("purchase_order.create");
  const [lookups, { contacts, terms }, initial] = await Promise.all([loadProcurementLookups(), loadContactsAndTerms(), loadPoForEdit(id)]);
  if (!initial) notFound();
  if (initial.header.status !== "draft") redirect(`/purchase-orders/${id}`);
  return (
    <>
      <PageHeader title={`Edit ${initial.header.doc_no}`} back={{ href: `/purchase-orders/${id}`, label: initial.header.doc_no }} />
      <PurchaseOrderEditor lookups={lookups} contacts={contacts} initial={initial} defaultTerms={terms} />
    </>
  );
}
