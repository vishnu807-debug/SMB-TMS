import Link from "next/link";
import { headers } from "next/headers";
import { PackageX } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { modulesForPath, visibleNavigation } from "@/lib/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ count }, { data: moduleNames }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase.from("system_modules").select("code, name"),
  ]);

  // Only menu items the user's permissions allow, in modules that are switched on.
  const groups = visibleNavigation(user.permissions, user.modules);

  // Pages of switched-off modules are closed even when the address is typed in.
  // (The database refuses their data and actions independently.)
  const path = (await headers()).get("x-pathname") ?? "";
  const needed = modulesForPath(path);
  const closed = needed && !needed.some((m) => user.modules.has(m));
  const names = needed?.map((m) => moduleNames?.find((x) => x.code === m)?.name ?? m).join(" or ");

  return (
    <div className="flex min-h-screen">
      <Sidebar groups={groups} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} unread={count ?? 0} groups={groups} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          {closed ? (
            <div className="mx-auto mt-16 max-w-md text-center">
              <PackageX className="mx-auto size-10 text-slate-400" />
              <h1 className="mt-4 text-lg font-semibold text-slate-900">This module is not enabled</h1>
              <p className="mt-2 text-sm text-slate-600">{names} is not part of this installation. Contact your system provider to activate it.</p>
              <Link href="/" className={buttonVariants({ variant: "outline", className: "mt-6" })}>Go to the start page</Link>
            </div>
          ) : children}
        </main>
      </div>
    </div>
  );
}
