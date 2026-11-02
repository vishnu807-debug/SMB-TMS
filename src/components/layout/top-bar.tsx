import Link from "next/link";
import { Bell, LogOut } from "lucide-react";
import type { CurrentUser } from "@/lib/auth/session";
import type { NavGroup } from "@/lib/navigation";
import { MobileNav, type SidebarBrand } from "./sidebar";

export function TopBar({ user, unread, groups, brand }: { user: CurrentUser; unread: number; groups: NavGroup[]; brand: SidebarBrand }) {
  const initials = user.fullName.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
      <MobileNav groups={groups} brand={brand} />
      <p className="hidden flex-1 text-sm text-slate-500 sm:block">
        {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" })}
      </p>
      <div className="flex items-center gap-4">
        <Link href="/notifications" className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label={`${unread} unread notifications`}>
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Link>
        <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
          <div className="flex size-8 items-center justify-center rounded-full bg-navy-100 text-xs font-semibold text-navy-800">{initials}</div>
          <Link href="/profile" className="hidden leading-tight hover:opacity-80 sm:block" title="My profile">
            <p className="text-sm font-medium text-slate-900">{user.fullName}</p>
            <p className="text-xs text-slate-500">{user.jobTitle ?? user.email}</p>
          </Link>
          <form action="/auth/signout" method="post">
            <button className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="Sign out" aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
