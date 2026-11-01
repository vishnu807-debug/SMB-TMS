"use client";
import { useState, useTransition } from "react";
import { setProductActive } from "../actions";
import { Button } from "@/components/ui/button";

export function ActiveToggle({ id, active }: { id: string; active: boolean }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end">
      <Button variant="outline" disabled={busy}
        onClick={() => {
          if (active && !confirm("Deactivate this product? It will no longer be available for new quotations and stock documents.")) return;
          start(async () => { const r = await setProductActive(id, !active); setError(r.ok ? null : r.error); });
        }}>
        {active ? "Deactivate" : "Activate"}
      </Button>
      {error && <p className="mt-1 max-w-xs text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
