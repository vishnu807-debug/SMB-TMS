"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";
import { createInvoiceFromOrder } from "@/app/(app)/invoices/actions";
import { Button } from "@/components/ui/button";

export function CreateInvoiceButton({ orderId, deliveryNoteIds, label = "Invoice", size = "sm" }: { orderId: string; deliveryNoteIds?: string[]; label?: string; size?: "sm" | "default" }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button size={size} disabled={busy} onClick={() => start(async () => {
        const r = await createInvoiceFromOrder(orderId, deliveryNoteIds);
        if (!r.ok) return setError(r.error);
        router.push(`/invoices/${r.data!.id}`);
      })}>{busy ? <Loader2 className="animate-spin" /> : <FilePlus2 />} {label}</Button>
      {error && <span className="mt-1 max-w-xs text-right text-xs text-red-600">{error}</span>}
    </span>
  );
}
