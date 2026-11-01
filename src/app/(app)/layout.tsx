import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { NAVIGATION } from "@/lib/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);

  // Only show menu items the user's permissions allow.
  const groups = NAVIGATION.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.permission.some((p) => user.permissions.has(p))),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex min-h-screen">
      <Sidebar groups={groups} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} unread={count ?? 0} />
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
