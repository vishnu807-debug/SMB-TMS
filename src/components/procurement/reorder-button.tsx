"use client";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { createReorderRequisition } from "@/app/(app)/procurement/actions";
import { Button } from "@/components/ui/button";

/** Raises one requisition for every stock item below its minimum level. */
export function ReorderButton() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="max-w-xs text-xs text-slate-600">{msg}</span>}
      <Button variant="outline" disabled={busy} onClick={() => start(async () => {
        const r = await createReorderRequisition();
        if (!r.ok) setMsg(r.error);
        else router.push(`/procurement/requisitions/${r.data!.id}`);
      })}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Reorder below minimum</Button>
    </div>
  );
}
