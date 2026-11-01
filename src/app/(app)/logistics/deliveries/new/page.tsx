import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { DeliveryForm } from "@/components/logistics/delivery-form";
import { loadDeliveryForm } from "@/lib/logistics/loader";

export const metadata: Metadata = { title: "New delivery note" };

export default async function NewDeliveryPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  await requirePermission("delivery.manage");
  const { order } = await searchParams;
  const data = order && /^[0-9a-f-]{36}$/i.test(order) ? await loadDeliveryForm(order) : { error: "Open a confirmed sales order (or the Ready to deliver list) and choose “Delivery note”." };
  return (
    <>
      <PageHeader title="New delivery note" back={{ href: "/logistics", label: "Logistics" }} description="Saved as a draft. Stock is issued when the note is dispatched." />
      {"error" in data ? <Alert tone="warning">{data.error}</Alert>
        : data.lines.length === 0 ? <Alert tone="info">Everything on {data.order.doc_no} has been delivered or is on a draft delivery note.</Alert>
        : <DeliveryForm {...data} />}
    </>
  );
}
