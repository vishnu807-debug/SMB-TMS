"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";
import { passwordSchema } from "@/lib/validation/password";

export async function updateMyProfile(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ full_name: z.string().trim().min(2, "Enter your name").max(120), phone: z.string().trim().max(40) })
    .safeParse({ full_name: formData.get("full_name"), phone: formData.get("phone") ?? "" });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("profiles").update({ full_name: parsed.data.full_name, phone: parsed.data.phone || null }).eq("id", user!.id);
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile updated." };
}

export async function changeMyPassword(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("password") ?? "");
  if (next !== String(formData.get("confirm") ?? "")) return { ok: false, error: "The new passwords don't match." };
  const parsed = passwordSchema.safeParse(next);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (current === next) return { ok: false, error: "Choose a password different from the current one." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Re-check the current password before changing it.
  const { error: authError } = await supabase.auth.signInWithPassword({ email: user!.email!, password: current });
  if (authError) return { ok: false, error: "Your current password is incorrect." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { ok: false, error: "Could not change the password. Please try again." };
  await supabase.rpc("record_own_auth_event", { p_type: "password_changed" });
  await supabase.auth.signOut({ scope: "others" });
  return { ok: true, message: "Password changed. Other devices have been signed out." };
}

export async function signOutOtherDevices(): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return { ok: false, error: "Could not sign out other devices." };
  revalidatePath("/profile");
  return { ok: true, message: "Other devices have been signed out." };
}

export async function signOutEverywhere() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.rpc("revoke_user_sessions", { p_user: user!.id });
  await supabase.auth.signOut();
  redirect("/login?error=session");
}
