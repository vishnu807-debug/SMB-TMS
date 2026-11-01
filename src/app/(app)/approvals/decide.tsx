"use client";
import { useState, useTransition } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { decideApproval } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Decide({ requestId }: { requestId: string }) {
  const [comment, setComment] = useState("");
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const go = (approve: boolean) => start(async () => { const r = await decideApproval(requestId, approve, comment); setError(r.ok ? null : r.error); });
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (required to reject)" className="h-8 w-56" />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => go(false)}><XCircle /> Reject</Button>
        <Button size="sm" variant="success" disabled={busy} onClick={() => go(true)}><CheckCircle2 /> Approve</Button>
      </div>
      {error && <p className="max-w-md text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
