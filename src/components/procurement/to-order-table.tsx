"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, ShoppingCart } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { formatDate, formatQty } from "@/lib/utils";

type Row = {
  id: string; requisition_id: string; requisition_no: string; required_date: string | null; sku: string; product_name: string; uom_code: string;
  description: string; qty: number; qty_open: number; suggested_supplier_id: string | null; suggested_supplier: string | null;
  sales_order_no: string | null; customer_name: string | null;
};

/** Open requisition lines; pick several and turn them into one purchase order. */
export function ToOrderTable({ rows, suppliers, warehouses, canCreatePo }: {
  rows: Row[]; suppliers: { id: string; name: string }[]; warehouses: { id: string; code: string; name: string }[]; canCreatePo: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [supplier, setSupplier] = useState("");
  const [warehouse, setWarehouse] = useState(warehouses[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const pickedRows = useMemo(() => rows.filter((r) => picked.has(r.id)), [rows, picked]);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const suggested = pickedRows.find((r) => r.suggested_supplier_id)?.suggested_supplier_id ?? "";

  const createPo = () => {
    const sup = supplier || suggested;
    if (!sup) return setError("Choose the supplier for this purchase order.");
    const p = new URLSearchParams({ lines: [...picked].join(","), supplier: sup, warehouse });
    router.push(`/purchase-orders/new?${p}`);
  };
  const reqIds = [...new Set(pickedRows.map((r) => r.requisition_id))];

  return (
    <Card>
      {canCreatePo && (
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
          <span className="text-sm text-slate-600">{picked.size} selected</span>
          <Select value={supplier} onChange={(e) => setSupplier(e.target.value)} className="w-64" aria-label="Supplier">
            <option value="">{suggested ? "Suggested supplier" : "Choose supplier…"}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="w-48" aria-label="Deliver to">
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </Select>
          <Button disabled={picked.size === 0} onClick={createPo}><ShoppingCart /> Create purchase order</Button>
          {reqIds.length === 1 && (
            <Link href={`/procurement/quotes/new?requisition=${reqIds[0]}`} className={buttonVariants({ variant: "outline" })}><FileText /> Record supplier quote</Link>
          )}
          {error && <Alert tone="error" className="w-full">{error}</Alert>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {canCreatePo && <th className="w-10 px-4 py-2.5"><input type="checkbox" className="size-4" aria-label="Select all"
                checked={picked.size > 0 && picked.size === rows.length} onChange={(e) => setPicked(new Set(e.target.checked ? rows.map((r) => r.id) : []))} /></th>}
              <th className="px-4 py-2.5 text-left">Item</th><th className="px-4 py-2.5 text-right">To order</th>
              <th className="px-4 py-2.5 text-left">For</th><th className="px-4 py-2.5 text-left">Requisition</th>
              <th className="px-4 py-2.5 text-left">Required by</th><th className="px-4 py-2.5 text-left">Suggested supplier</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Nothing waiting to be ordered.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className={picked.has(r.id) ? "bg-navy-50/50" : "hover:bg-slate-50/70"}>
                {canCreatePo && <td className="px-4 py-2.5"><input type="checkbox" className="size-4" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.sku}`} /></td>}
                <td className="px-4 py-2.5"><span className="font-mono text-xs text-slate-500">{r.sku}</span> {r.description}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(r.qty_open)} <span className="text-xs text-slate-400">{r.uom_code}</span>
                  {Number(r.qty_open) < Number(r.qty) && <p className="text-xs text-slate-500">of {formatQty(r.qty)}</p>}</td>
                <td className="px-4 py-2.5">{r.sales_order_no ? <><span className="font-mono text-xs">{r.sales_order_no}</span><p className="text-xs text-slate-500">{r.customer_name}</p></> : <span className="text-slate-500">Stock</span>}</td>
                <td className="px-4 py-2.5"><Link href={`/procurement/requisitions/${r.requisition_id}`} className="font-mono text-xs text-navy-800 hover:underline">{r.requisition_no}</Link></td>
                <td className={`px-4 py-2.5 ${r.required_date && r.required_date < today ? "font-medium text-red-700" : ""}`}>{formatDate(r.required_date)}</td>
                <td className="px-4 py-2.5">{r.suggested_supplier ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
