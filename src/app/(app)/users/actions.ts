"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { userMessage, type ActionResult } from "@/lib/errors";
import { siteUrl } from "@/lib/request-info";

const uuid = z.string().uuid();
const details = z.object({
  full_name: z.string().trim().min(2, "Enter the full name").max(120),
  job_title: z.string().trim().max(80).optional(),
  employee_code: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(40).optional(),
  department_id: z.union([z.literal(""), uuid]).optional(),
  manager_id: z.union([z.literal(""), uuid]).optional(),
});

/** Invite a new employee: Supabase sends an email with a link to set their password. */
export async function inviteUser(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = details.extend({
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    roles: z.array(z.string()).min(1, "Assign at least one role"),
  }).safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  // The service-role client bypasses RLS, so the permission check MUST happen here first.
  const me = await getCurrentUser();
  if (!me?.isActive || !me.permissions.has("user.manage")) return { ok: false, error: "You do not have permission to add users." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Inviting users needs SUPABASE_SERVICE_ROLE_KEY on the server. See the README." };

  const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    data: { full_name: parsed.data.full_name },
    redirectTo: `${siteUrl()}/auth/confirm?next=/reset-password`,
  });
  if (error) {
    return { ok: false, error: /already|registered|exists/i.test(error.message) ? "A user with this email already exists." : `Could not send the invitation: ${error.message}` };
  }
  const id = invited.user.id;

  // Details and roles go through the normal permission-checked functions, as the signed-in admin.
  const supabase = await createClient();
  const { email, roles, ...rest } = parsed.data;
  const r1 = await supabase.rpc("admin_update_user", { p: { id, ...rest } });
  const r2 = r1.error ? r1 : await supabase.rpc("admin_set_user_roles", { p_user: id, p_role_codes: roles });
  if (r1.error || r2.error) {
    await admin.auth.admin.deleteUser(id);   // undo, so no half-created account is left behind
    return { ok: false, error: userMessage(r1.error ?? r2.error) };
  }
  await admin.rpc("log_auth_event", { p_user: id, p_email: email, p_type: "user_invited", p_details: { by: me.email, roles } });
  revalidatePath("/users");
  return { ok: true, data: { id } };
}

export async function updateUserDetails(id: string, payload: unknown): Promise<ActionResult> {
  const parsed = details.safeParse(payload);
  if (!parsed.success || !uuid.safeParse(id).success) return { ok: false, error: parsed.success ? "Invalid user." : parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_user", { p: { id, ...parsed.data } });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/users/${id}`);
  return { ok: true, message: "Details saved." };
}

export async function setUserRoles(id: string, roles: string[]): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_roles", { p_user: id, p_role_codes: roles });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/users/${id}`);
  return { ok: true, message: "Roles saved." };
}

export async function setUserActive(id: string, active: boolean, reason?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_active", { p_user: id, p_active: active, p_reason: reason ?? null });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/users/${id}`); revalidatePath("/users");
  return { ok: true, message: active ? "User reactivated." : "User deactivated and signed out everywhere." };
}

export async function setUserPermission(id: string, code: string, effect: "grant" | "deny", reason: string, expiresAt?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_permission", {
    p_user: id, p_code: code, p_effect: effect, p_reason: reason,
    p_expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59+04:00`).toISOString() : null,
  });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/users/${id}`);
  return { ok: true, message: effect === "grant" ? "Permission granted." : "Permission denied for this user." };
}

export async function removeUserPermission(id: string, code: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_remove_user_permission", { p_user: id, p_code: code });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/users/${id}`);
  return { ok: true };
}

export async function revokeSessions(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_user_sessions", { p_user: id });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/users/${id}`);
  return { ok: true, message: "Signed out of all devices." };
}

export async function resendInvite(email: string): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me?.permissions.has("user.manage")) return { ok: false, error: "You do not have permission." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl()}/auth/confirm?next=/reset-password` });
  if (error) return { ok: false, error: "Could not send the email." };
  return { ok: true, message: "A link to set a new password has been emailed." };
}

export async function saveRolePermissions(roleCode: string, codes: string[]): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_role_permissions", { p_role_code: roleCode, p_codes: codes });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/users/roles");
  return { ok: true, message: "Role permissions saved." };
}

export async function saveRole(payload: unknown): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_role", { p: payload });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/users/roles");
  return { ok: true, message: "Role saved." };
}
