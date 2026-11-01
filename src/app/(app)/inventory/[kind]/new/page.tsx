import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { DOC_KINDS, isDocKind } from "@/lib/inventory-config";
import { PageHeader } from "@/components/layout/page-header";
import { StockDocumentForm } from "@/components/inventory/stock-document-form";
import { loadDocLookups } from "../../lookups";

export const metadata: Metadata = { title: "New stock document" };

export default async function NewDocPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isDocKind(kind)) notFound();
  const cfg = DOC_KINDS[kind];
  const user = await requirePermission(cfg.createPermission);
  return (
    <>
      <PageHeader title={`New ${cfg.singular.toLowerCase()}`} description="Saved as a draft. Stock only changes when the document is posted."
        back={{ href: `/inventory/${kind}`, label: cfg.title }} />
      <StockDocumentForm kind={kind} lookups={await loadDocLookups(user)} />
    </>
  );
}
