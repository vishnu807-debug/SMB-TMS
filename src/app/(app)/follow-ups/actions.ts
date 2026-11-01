"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";
import { str } from "@/lib/utils";

const TYPES = ["call", "meeting", "email", "whatsapp", "site_visit", "follow_up", "note"] as const;
const optUuid = z.union([z.literal(""), z.string().uuid()]).transform((v) => v || null);

export async function addActivity(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    activity_type: z.enum(TYPES),
    subject: z.string().trim().min(2, "Enter a subject.").max(200),
    notes: z.string().trim().max(4000),
    due_at: z.string().trim(),
    done: z.boolean(),
    owner_id: optUuid,
    lead_id: optUuid, customer_id: optUuid, quotation_id: optUuid, sales_order_id: optUuid,
    path: z.string().startsWith("/"),
  }).safeParse({
    activity_type: str(formData.get("activity_type")), subject: str(formData.get("subject")), notes: str(formData.get("notes")),
    due_at: str(formData.get("due_at")), done: formData.get("done") === "on", owner_id: str(formData.get("owner_id")),
    lead_id: str(formData.get("lead_id")), customer_id: str(formData.get("customer_id")),
    quotation_id: str(formData.get("quotation_id")), sales_order_id: str(formData.get("sales_order_id")), path: str(formData.get("path")) || "/",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.activity_type === "follow_up" && !d.due_at) return { ok: false, error: "A follow-up needs a due date and time." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("activities").insert({
    activity_type: d.activity_type, subject: d.subject, notes: d.notes || null,
    // datetime-local has no zone: interpret it as Dubai time.
    due_at: d.due_at ? new Date(`${d.due_at}:00+04:00`).toISOString() : null,
    completed_at: d.done ? new Date().toISOString() : null,
    owner_id: d.owner_id ?? user?.id, lead_id: d.lead_id, customer_id: d.customer_id,
    quotation_id: d.quotation_id, sales_order_id: d.sales_order_id,
  });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(d.path);
  revalidatePath("/follow-ups");
  return { ok: true, message: "Saved." };
}

export async function completeActivity(id: string, outcome: string, path: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_activity", { p_id: id, p_outcome: outcome || null });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(path.startsWith("/") ? path : "/follow-ups");
  revalidatePath("/follow-ups");
  return { ok: true };
}
