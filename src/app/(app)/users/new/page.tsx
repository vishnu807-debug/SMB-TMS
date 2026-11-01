import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { InviteForm } from "../user-forms";

export const metadata: Metadata = { title: "Add user" };

export default async function NewUserPage() {
  await requirePermission("user.manage");
  const supabase = await createClient();
  const [{ data: roles }, { data: depts }, { data: people }] = await Promise.all([
    supabase.from("roles").select("code, name, description, department:departments(name)").eq("is_active", true).order("sort_order"),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);
  return (
    <>
      <PageHeader title="Add user" description="The employee receives an invitation email to set their own password." back={{ href: "/users", label: "User management" }} />
      <Card className="max-w-4xl"><CardContent>
        <InviteForm roles={(roles ?? []).map((r: any) => ({ code: r.code, name: r.name, description: r.description, department: r.department?.name ?? null }))}
          departments={depts ?? []} managers={(people ?? []).map((p) => ({ id: p.id, name: p.full_name }))} />
      </CardContent></Card>
    </>
  );
}
