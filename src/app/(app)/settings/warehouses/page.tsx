import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";
import { WarehouseForm } from "./warehouse-form";

export const metadata: Metadata = { title: "Warehouses" };

export default async function WarehousesPage() {
  const user = await requirePermission(["warehouse.manage", "inventory.view"]);
  const supabase = await createClient();
  const [{ data: warehouses }, { data: valuation }, { data: settings }] = await Promise.all([
    supabase.from("warehouses").select("*").order("code"),
    supabase.rpc("inventory_valuation"),
    supabase.from("company_settings").select("default_warehouse_id").single(),
  ]);
  const value = new Map((valuation ?? []).map((v: any) => [v.warehouse_id, v]));
  const manage = can(user, "warehouse.manage");

  return (
    <>
      <PageHeader title="Warehouses" description="Stock is held per warehouse. A warehouse holding stock cannot be deactivated." />
      <div className="grid gap-6 lg:grid-cols-2">
        {(warehouses ?? []).map((w) => (
          <Card key={w.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {w.name} <span className="font-mono text-xs text-slate-500">{w.code}</span>
                {w.id === settings?.default_warehouse_id && <Badge tone="navy">Default</Badge>}
                {!w.is_active && <Badge>Inactive</Badge>}
              </CardTitle>
              <Link href={`/inventory?warehouse=${w.id}`} className="text-sm text-navy-700 hover:underline">View stock</Link>
            </CardHeader>
            <CardContent>
              {value.has(w.id) && (
                <p className="mb-3 text-sm text-slate-600">
                  {(value.get(w.id) as any).products} items in stock · value AED {formatMoney((value.get(w.id) as any).stock_value)}
                </p>
              )}
              {manage ? <WarehouseForm warehouse={w} /> : <p className="text-sm text-slate-600">{w.address ?? "No address"}</p>}
            </CardContent>
          </Card>
        ))}
        {manage && (
          <Card>
            <CardHeader><CardTitle>New warehouse</CardTitle></CardHeader>
            <CardContent><WarehouseForm /></CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
