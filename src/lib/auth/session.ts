import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  jobTitle: string | null;
  isActive: boolean;
  permissions: Set<string>;
  /** Modules switched on for this installation (backend setting). */
  modules: Set<string>;
};

/** The signed-in user with their effective permissions (one load per request). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: profile }, { data: perms }, { data: mods }] = await Promise.all([
    supabase.from("profiles").select("full_name, email, job_title, is_active").eq("id", user.id).single(),
    supabase.rpc("my_permissions"),
    supabase.rpc("enabled_modules"),
  ]);
  return {
    id: user.id,
    email: profile?.email ?? user.email ?? "",
    fullName: profile?.full_name || user.email || "",
    jobTitle: profile?.job_title ?? null,
    isActive: profile?.is_active ?? false,
    permissions: new Set<string>((perms as string[] | null) ?? []),
    modules: new Set<string>((mods as string[] | null) ?? ["core"]),
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.isActive) redirect("/login?error=inactive");
  return user;
}

/**
 * Application-level guard for pages. The database enforces the same rules
 * independently (RLS + permission checks inside every function).
 */
export async function requirePermission(code: string | string[]): Promise<CurrentUser> {
  const user = await requireUser();
  const codes = Array.isArray(code) ? code : [code];
  if (!codes.some((c) => user.permissions.has(c))) redirect("/forbidden");
  return user;
}

export function can(user: CurrentUser, code: string) {
  return user.permissions.has(code);
}

/** True when any of the given modules is switched on. */
export function moduleOn(user: CurrentUser, codes: string | string[]) {
  return (Array.isArray(codes) ? codes : [codes]).some((c) => user.modules.has(c));
}
