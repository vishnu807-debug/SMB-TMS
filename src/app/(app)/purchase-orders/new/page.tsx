import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { PurchaseOrderEditor } from "@/components/purchase-orders/po-editor";
import { loadProcurementLookups } from "@/lib/procurement/lookups";
import { loadContactsAndTerms, loadPoPrefill } from "@/lib/procurement/po-loader";

export const metadata: Metadata = { title: "New purchase order" };

export default async function NewPoPage({ searchParams }: { searchParams: Promise<{ supplier?: string; quote?: string; lines?: string; warehouse?: string }> }) {
  await requirePermission("purchase_order.create");
  const sp = await searchParams;
  const [lookups, { contacts, terms }, initial] = await Promise.all([loadProcurementLookups(), loadContactsAndTerms(), loadPoPrefill(sp)]);
  if (initial) {
    // Fill a missing VAT code with the default and the primary contact for the supplier.
    const def = lookups.taxCodes.find((t) => t.is_default)?.id ?? "";
    initial.lines.forEach((l) => { if (!l.tax_code_id) l.tax_code_id = def; });
    const s = lookups.suppliers.find((x) => x.id === initial.header.supplier_id);
    if (s) initial.header = { currency_code: s.currency_code, payment_term_id: s.payment_term_id ?? "",
      supplier_contact_id: contacts.find((c) => c.supplier_id === s.id && c.is_primary)?.id ?? "", ...initial.header };
  }
  return (
    <>
      <PageHeader title="New purchase order" back={{ href: "/purchase-orders", label: "Purchase orders" }}
        description="Saved as a draft. Submitting sends large orders for approval; approved orders count as incoming stock." />
      <PurchaseOrderEditor lookups={lookups} contacts={contacts} initial={initial} defaultTerms={terms} />
    </>
  );
}
