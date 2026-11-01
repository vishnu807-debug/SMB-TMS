import Link from "next/link";
import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

async function markAllRead() {
  "use server";
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  revalidatePath("/", "layout");
}

export default async function NotificationsPage() {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
  return (
    <>
      <PageHeader title="Notifications" actions={<form action={markAllRead}><Button variant="outline">Mark all as read</Button></form>} />
      <Card>
        <ul className="divide-y divide-slate-100">
          {(data ?? []).length === 0 && <li className="p-8 text-center text-sm text-slate-500">You have no notifications.</li>}
          {(data ?? []).map((n) => (
            <li key={n.id} className={`flex gap-3 px-5 py-3 ${n.read_at ? "" : "bg-navy-50/50"}`}>
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-navy-600"}`} />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p>
                {n.body && <p className="text-sm text-slate-600">{n.body}</p>}
              </div>
              <span className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(n.created_at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
