import * as React from "react";
import { cn, humanize } from "@/lib/utils";

const tones = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  navy: "bg-navy-50 text-navy-800 ring-navy-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
} as const;

export function Badge({ tone = "slate", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)} {...props} />
  );
}

const statusTone: Record<string, keyof typeof tones> = {
  draft: "slate", submitted: "amber", pending: "amber", in_transit: "blue", posted: "green", received: "green",
  approved: "green", active: "green", cancelled: "slate", rejected: "red", released: "slate", consumed: "navy",
  inactive: "slate",
  // quotations
  pending_approval: "amber", sent: "blue", accepted: "green", lost: "red", expired: "slate", superseded: "slate", converted: "navy",
  // sales orders & lines
  confirmed: "navy", partially_fulfilled: "blue", fulfilled: "green", invoiced: "green", closed: "slate", on_hold: "amber",
  reserved: "green", partially_reserved: "amber", not_reserved: "red", awaiting_receipt: "blue", not_required: "slate",
  requisitioned: "amber", ordered: "blue", partially_ordered: "blue", partially_received: "blue",
  partially_delivered: "blue", delivered: "green",
  // leads
  new: "blue", contacted: "navy", qualified: "navy", quoted: "amber", won: "green",
  blocked: "red",
  // logistics & procurement
  dispatched: "blue", planned: "slate", completed: "green", selected: "green",
  open: "amber",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] ?? "slate"}>{humanize(status)}</Badge>;
}
