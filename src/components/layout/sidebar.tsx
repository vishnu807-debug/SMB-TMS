"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftRight, BadgeCheck, CalendarClock, BarChart3, Building2, ClipboardCheck, ClipboardList, CreditCard, FileText, FolderTree,
  History, Landmark, LayoutDashboard, Lock, MapPin, Package, PackageCheck, PackageMinus, PackagePlus, Receipt, Route, Settings, ShieldCheck, ScrollText, ShoppingCart,
  Factory, KeyRound, Menu, Target, Truck, Users, Wallet, Warehouse, X, type LucideIcon,
} from "lucide-react";
import type { NavGroup } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  ArrowLeftRight, BadgeCheck, CalendarClock, BarChart3, Building2, ClipboardCheck, ClipboardList, CreditCard, FileText, FolderTree,
  History, Landmark, LayoutDashboard, Lock, MapPin, Package, PackageCheck, PackageMinus, PackagePlus, Receipt, Route, Settings, ShieldCheck, ScrollText, ShoppingCart,
  Factory, KeyRound, Target, Truck, Users, Wallet, Warehouse,
};

function NavContent({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  // Longest matching href wins, so /inventory/receipts doesn't also light up /inventory.
  const all = groups.flatMap((g) => g.items).filter((i) => i.ready);
  const active = all
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <>
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
              {g.items.filter((i) => i.ready).map((item) => {
                const Icon = ICONS[item.icon] ?? Package;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
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
    </>
  );
}

/** Desktop: fixed column; the navy background runs the full page height. */
export function Sidebar({ groups }: { groups: NavGroup[] }) {
  return (
    <div className="hidden w-64 shrink-0 bg-navy-900 lg:block">
      <aside className="sticky top-0 flex h-screen flex-col text-navy-100">
        <NavContent groups={groups} />
      </aside>
    </div>
  );
}

/** Phones and tablets: menu button in the top bar opening a drawer. */
export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="-ml-2 rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
        <Menu className="size-5" />
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-navy-900 text-navy-100 shadow-xl">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded p-1 text-navy-200 hover:bg-white/10" aria-label="Close menu"><X className="size-5" /></button>
            <NavContent groups={groups} onNavigate={() => setOpen(false)} />
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}
