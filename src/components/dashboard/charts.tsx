import { formatMoney } from "@/lib/utils";

const compact = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M` : v >= 10_000 ? `${Math.round(v / 1000)}K` : new Intl.NumberFormat("en-AE").format(Math.round(v));

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/**
 * Single-series column chart (one hue, so no legend — the card title names it).
 * Hairline grid, 4px rounded caps, ≤24px columns, labels only on the peak and the
 * latest month, a hover tooltip on every column, and a table view for screen readers.
 */
export function ColumnChart({ data, valueLabel }: { data: { label: string; value: number; sub?: string }[]; valueLabel: string }) {
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const peak = data.reduce((iMax, d, i, a) => (d.value > a[iMax].value ? i : iMax), 0);
  return (
    <div>
      <div className="flex h-56 gap-2" aria-hidden="true">
        <div className="relative w-10 shrink-0 text-right text-[11px] text-slate-500">
          {ticks.map((t) => <span key={t} className="absolute right-1 -translate-y-1/2" style={{ bottom: `${(t / max) * 100}%` }}>{compact(t)}</span>)}
        </div>
        <div className="relative flex-1">
          {ticks.map((t) => <div key={t} className="absolute inset-x-0 border-t border-slate-200" style={{ bottom: `${(t / max) * 100}%` }} />)}
          <div className="absolute inset-0 flex items-end">
            {data.map((d, i) => {
              const h = (d.value / max) * 100;
              const label = (i === peak || i === data.length - 1) && d.value > 0;
              return (
                <div key={d.label} className="group relative flex h-full flex-1 items-end justify-center">
                  {label && <span className="absolute text-[11px] font-medium text-slate-700" style={{ bottom: `calc(${h}% + 4px)` }}>{compact(d.value)}</span>}
                  <div className="w-full max-w-[24px] rounded-t bg-navy-700 transition-colors group-hover:bg-navy-500" style={{ height: `${Math.max(h, d.value > 0 ? 1 : 0)}%` }} />
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block">
                    <p className="font-medium">{d.label}</p>
                    <p>{valueLabel}: {formatMoney(d.value)}</p>
                    {d.sub && <p className="text-slate-300">{d.sub}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ml-12 mt-1.5 flex text-[11px] text-slate-500" aria-hidden="true">
        {data.map((d) => <span key={d.label} className="flex-1 text-center">{d.label.split(" ")[0]}</span>)}
      </div>
      <details className="mt-2 text-xs text-slate-500">
        <summary className="cursor-pointer select-none">View as table</summary>
        <table className="mt-2 w-full">
          <tbody>{data.map((d) => <tr key={d.label}><td className="py-0.5">{d.label}</td><td className="text-right tabular-nums">{formatMoney(d.value)}</td><td className="pl-3 text-right">{d.sub}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

/** Horizontal bars for one measure across a few categories; value at the bar tip. */
export function BarList({ rows, format = "money" }: { rows: { label: string; value: number; note?: string; href?: string }[]; format?: "money" | "count" }) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  if (rows.length === 0) return <p className="text-sm text-slate-500">Nothing in this period.</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="group">
          <div className="mb-1 flex justify-between gap-3 text-sm">
            {r.href ? <a href={r.href} className="truncate text-slate-700 hover:text-navy-800 hover:underline">{r.label}</a> : <span className="truncate text-slate-700">{r.label}</span>}
            <span className="shrink-0 tabular-nums text-slate-900">{format === "money" ? formatMoney(r.value) : r.value}{r.note && <span className="ml-1.5 text-xs text-slate-500">{r.note}</span>}</span>
          </div>
          <div className="h-2.5 rounded-r bg-slate-100">
            <div className="h-full rounded-r bg-navy-700 group-hover:bg-navy-500" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
