"use client";
import { formatDate, formatMoney } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export type OpenItem = { id: string; doc_no: string; invoice_date?: string; bill_date?: string; due_date: string | null; currency_code: string; total: number; balance: number; days_overdue: number; ref?: string };

/** Open invoices / bills with an amount box each, plus "fill oldest first". */
export function AllocationTable({ items, currency, amounts, onChange, available, link }: {
  items: OpenItem[]; currency: string; amounts: Record<string, string>; onChange: (a: Record<string, string>) => void; available: number; link: (id: string) => string;
}) {
  const usable = items.filter((i) => i.currency_code === currency);
  const allocated = Object.values(amounts).reduce((a, v) => a + (Number(v) || 0), 0);
  const autoFill = () => {
    let left = available;
    const next: Record<string, string> = {};
    for (const i of usable) { const take = Math.min(Number(i.balance), Math.max(left, 0)); if (take > 0) next[i.id] = take.toFixed(2); left -= take; }
    onChange(next);
  };
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-2 text-sm">
        <span className="text-slate-600">Allocated {formatMoney(allocated, currency)} of {formatMoney(available, currency)}
          {allocated > available + 0.001 && <span className="ml-2 font-medium text-red-700">— more than the payment</span>}
          {allocated < available - 0.001 && available > 0 && <span className="ml-2 text-slate-500">({formatMoney(available - allocated)} left unallocated)</span>}</span>
        <button type="button" onClick={autoFill} className="text-xs font-medium text-navy-700 hover:underline" disabled={usable.length === 0}>Allocate oldest first</button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-2 text-left">Document</th><th className="px-4 py-2 text-left">Date</th><th className="px-4 py-2 text-left">Due</th>
            <th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2 text-right">Outstanding</th><th className="w-40 px-4 py-2 text-right">Allocate</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No open items.</td></tr>}
          {items.map((i) => {
            const other = i.currency_code !== currency;
            return (
              <tr key={i.id} className={other ? "opacity-50" : ""}>
                <td className="px-4 py-2"><a href={link(i.id)} target="_blank" rel="noreferrer" className="font-mono text-xs font-semibold text-navy-800 hover:underline">{i.doc_no}</a>{i.ref && <p className="text-xs text-slate-500">{i.ref}</p>}</td>
                <td className="px-4 py-2">{formatDate(i.invoice_date ?? i.bill_date)}</td>
                <td className={`px-4 py-2 ${i.days_overdue > 0 ? "font-medium text-red-700" : ""}`}>{formatDate(i.due_date)}{i.days_overdue > 0 && ` · ${i.days_overdue} d`}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(i.total, i.currency_code)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(i.balance)}</td>
                <td className="px-4 py-2">{other ? <span className="block text-right text-xs">{i.currency_code}</span> :
                  <Input type="number" min="0" max={i.balance} step="0.01" className="text-right" value={amounts[i.id] ?? ""} onChange={(e) => onChange({ ...amounts, [i.id]: e.target.value })} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
