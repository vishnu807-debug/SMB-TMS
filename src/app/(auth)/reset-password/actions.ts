"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { passwordSchema } from "@/lib/validation/password";

export async function setNewPassword(_prev: { error?: string } | undefined, formData: FormData) {
  const pw = String(formData.get("password") ?? "");
  if (pw !== String(formData.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  const parsed = passwordSchema.safeParse(pw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: error.message.includes("different") ? "Choose a password you haven't used before." : "Could not change the password. Request a new link." };
  await supabase.rpc("record_own_auth_event", { p_type: "password_changed" });
  // Every device signs in again with the new password.
  await supabase.rpc("revoke_user_sessions", { p_user: (await supabase.auth.getUser()).data.user!.id });
  await supabase.auth.signOut();
  redirect("/login?reset=done");
}
