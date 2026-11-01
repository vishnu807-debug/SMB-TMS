"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

export async function decideApproval(requestId: string, approve: boolean, comment: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(requestId).success) return { ok: false, error: "Invalid request." };
  if (!approve && !comment.trim()) return { ok: false, error: "Please give a reason for rejecting." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_approval", { p_request_id: requestId, p_approve: approve, p_comment: comment.trim() || null });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/approvals");
  return { ok: true };
}
