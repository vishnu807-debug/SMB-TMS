import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { RoleMatrix } from "./role-matrix";

export const metadata: Metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  const me = await requirePermission("role.manage");
  const supabase = await createClient();
  const [{ data: roles }, { data: perms }, { data: rp }, { data: isSuper }] = await Promise.all([
    supabase.from("roles").select("id, code, name, description, is_system, is_active").order("sort_order"),
    supabase.from("permissions").select("code, module, description").order("module").order("code"),
    supabase.from("role_permissions").select("role_id, permission:permissions(code)"),
    supabase.rpc("is_super_admin", { p_user: me.id }),
  ]);
  const byRole = new Map<string, string[]>();
  (rp ?? []).forEach((x: any) => byRole.set(x.role_id, [...(byRole.get(x.role_id) ?? []), x.permission.code]));
  return (
    <>
      <PageHeader title="Roles & permissions" description="What each role can see and do. The Super Administrator always has every permission." back={{ href: "/users", label: "User management" }} />
      <RoleMatrix perms={perms ?? []} adminOnlyEditable={isSuper === true}
        roles={(roles ?? []).map((r) => ({ ...r, perms: byRole.get(r.id) ?? [] }))} />
    </>
  );
}
