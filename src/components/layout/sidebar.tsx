"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight, BadgeCheck, CalendarClock, BarChart3, Building2, ClipboardCheck, ClipboardList, CreditCard, FileText, FolderTree,
  History, LayoutDashboard, Lock, MapPin, Package, PackageMinus, PackagePlus, Receipt, Route, Settings, ShieldCheck, ScrollText, ShoppingCart,
  Factory, Target, Truck, Users, Wallet, Warehouse, type LucideIcon,
} from "lucide-react";
import type { NavGroup } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  ArrowLeftRight, BadgeCheck, CalendarClock, BarChart3, Building2, ClipboardCheck, ClipboardList, CreditCard, FileText, FolderTree,
  History, LayoutDashboard, Lock, MapPin, Package, PackageMinus, PackagePlus, Receipt, Route, Settings, ShieldCheck, ScrollText, ShoppingCart,
  Factory, Target, Truck, Users, Wallet, Warehouse,
};

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  // Longest matching href wins, so /inventory/receipts doesn't also light up /inventory.
  const all = groups.flatMap((g) => g.items).filter((i) => i.ready);
  const active = all
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-navy-900 text-navy-100 lg:flex">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <div className="flex size-8 items-center justify-center rounded bg-white text-sm font-bold text-navy-900">S</div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">SMP Trading</p>
          <p className="text-[11px] text-navy-300">Management System</p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((g) => (
          <div key={g.label} className="mb-5">
            <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-navy-400">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const Icon = ICONS[item.icon] ?? Package;
                if (!item.ready) {
                  return (
                    <li key={item.href}>
                      <span title="Coming in a later phase" className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-navy-400/70">
                        <Icon className="size-4" /> {item.label}
                        <span className="ml-auto rounded bg-white/5 px-1.5 text-[10px] uppercase">Soon</span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active === item.href ? "bg-white/10 font-medium text-white" : "text-navy-200 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <Icon className="size-4" /> {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
