"use client";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { searchProducts } from "@/app/(app)/products/actions";
import { Input } from "@/components/ui/input";

export type PickedProduct = { id: string; sku: string; name: string; uom: string };

export function ProductPicker({ value, onChange, disabled, stockOnly = true }: { value: PickedProduct | null; onChange: (p: PickedProduct) => void; disabled?: boolean; stockOnly?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => { setResults(await searchProducts(q, stockOnly)); setActive(0); }, 200);
    return () => clearTimeout(t);
  }, [q, open, stockOnly]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (p: PickedProduct) => { onChange(p); setOpen(false); setQ(""); };

  return (
    <div ref={box} className="relative">
      {!open && value ? (
        <button type="button" disabled={disabled} onClick={() => setOpen(true)}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-left text-sm hover:border-slate-400 disabled:bg-slate-50">
          <span className="font-mono text-xs text-slate-500">{value.sku}</span>
          <span className="truncate">{value.name}</span>
        </button>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" />
          <Input autoFocus={open} value={q} disabled={disabled} placeholder="Search product or SKU…" className="pl-8"
            onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter" && results[active]) { e.preventDefault(); pick(results[active]); }
              if (e.key === "Escape") setOpen(false);
            }} />
        </div>
      )}
      {open && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-64 w-full min-w-[320px] overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">{stockOnly ? "No active stock items found." : "No active products found."}</li>}
          {results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${i === active ? "bg-navy-50" : ""}`}>
              <span className="font-mono text-xs text-slate-500">{p.sku}</span>
              <span className="truncate">{p.name}</span>
              <span className="ml-auto text-xs text-slate-400">{p.uom}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
