"use client";
import { useActionState, useState, useTransition } from "react";
import { Calendar, CheckCircle2, Mail, MapPin, MessageCircle, Phone, StickyNote, Users } from "lucide-react";
import { addActivity, completeActivity } from "@/app/(app)/follow-ups/actions";
import type { ActionResult } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn, formatDateTime, humanize } from "@/lib/utils";

export type Activity = {
  id: string; activity_type: string; subject: string; notes: string | null; due_at: string | null; completed_at: string | null;
  outcome: string | null; owner_name?: string | null; created_at: string;
};
type Link = { lead_id?: string; customer_id?: string; quotation_id?: string; sales_order_id?: string };

const ICON: Record<string, React.ReactNode> = {
  call: <Phone className="size-4" />, meeting: <Users className="size-4" />, email: <Mail className="size-4" />,
  whatsapp: <MessageCircle className="size-4" />, site_visit: <MapPin className="size-4" />, follow_up: <Calendar className="size-4" />,
  note: <StickyNote className="size-4" />,
};

export function ActivityPanel({ activities, link, path, canManage }: { activities: Activity[]; link: Link; path: string; canManage: boolean }) {
  const [state, action] = useActionState<ActionResult | undefined, FormData>(addActivity, undefined);
  const [type, setType] = useState("follow_up");
  const [formKey, setFormKey] = useState(0);
  const now = Date.now();

  return (
    <Card>
      <CardHeader><CardTitle>Activities & follow-ups</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {canManage && (
          <form key={formKey} action={async (fd) => { await action(fd); setFormKey((k) => k + 1); }} className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
            {Object.entries(link).map(([k, v]) => <input key={k} type="hidden" name={k} value={v ?? ""} />)}
            <input type="hidden" name="path" value={path} />
            <div className="flex gap-2">
              <Select name="activity_type" value={type} onChange={(e) => setType(e.target.value)} className="w-36">
                {Object.keys(ICON).map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
              </Select>
              <Input name="subject" placeholder={type === "follow_up" ? "What to follow up on" : "Subject"} required maxLength={200} />
            </div>
            <Textarea name="notes" rows={2} placeholder="Notes" />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                {type === "follow_up" ? "Due" : "Date"}
                <Input type="datetime-local" name="due_at" className="w-52" required={type === "follow_up"} />
              </label>
              {type !== "follow_up" && (
                <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="done" defaultChecked className="size-4" /> Already done</label>
              )}
              <SubmitButton size="sm" className="ml-auto">Add</SubmitButton>
            </div>
          </form>
        )}
        {activities.length === 0 && <p className="text-sm text-slate-500">No activities yet.</p>}
        <ul className="space-y-3">
          {activities.map((a) => {
            const overdue = !a.completed_at && a.due_at && new Date(a.due_at).getTime() < now;
            return (
              <li key={a.id} className="flex gap-3">
                <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
                  a.completed_at ? "bg-slate-100 text-slate-500" : overdue ? "bg-red-50 text-red-600" : "bg-navy-50 text-navy-700")}>
                  {ICON[a.activity_type]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{a.subject}</p>
                  <p className="text-xs text-slate-500">
                    {humanize(a.activity_type)}
                    {a.due_at && <> · {a.completed_at ? "" : "due "}{formatDateTime(a.due_at)}</>}
                    {a.owner_name && <> · {a.owner_name}</>}
                    {overdue && <span className="ml-1 font-semibold text-red-600">Overdue</span>}
                    {a.completed_at && <span className="ml-1 text-emerald-700">Done {formatDateTime(a.completed_at)}</span>}
                  </p>
                  {a.notes && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{a.notes}</p>}
                  {a.outcome && <p className="mt-1 text-sm text-slate-700"><span className="font-medium">Outcome:</span> {a.outcome}</p>}
                  {!a.completed_at && canManage && <CompleteButton id={a.id} path={path} />}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

export function CompleteButton({ id, path }: { id: string; path: string }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setOpen(true)}>Mark done</Button>;
  return (
    <div className="mt-1 flex gap-2">
      <Input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Outcome (optional)" className="h-8" />
      <Button size="sm" variant="success" disabled={busy}
        onClick={() => start(async () => { const r = await completeActivity(id, outcome, path); if (!r.ok) setError(r.error); else setOpen(false); })}>
        <CheckCircle2 /> Done
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
