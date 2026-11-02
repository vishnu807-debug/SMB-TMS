"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, RefreshCw, Upload } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { columnsFor, type ImportEntity } from "@/lib/import/columns";
import { readImportFile, type ParsedFile } from "@/lib/import/parse";
import { downloadErrorReport, downloadTemplate } from "@/lib/import/files";
import type { CustomerOption, ImportResult, ImportResultRow } from "@/lib/import/types";
import { Card, CardContent, CardHeader, CardTitle, StatCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Resolution = { mode: "" | "link" | "create" | "prospect" | "skip"; customer?: CustomerOption };
type Props = {
  entity: ImportEntity;
  preview: (rows: Record<string, string>[]) => Promise<ActionResult<ImportResult>>;
  commit: (rows: Record<string, string>[], fileName: string, token: string) => Promise<ActionResult<ImportResult>>;
  searchCustomers?: (q: string) => Promise<CustomerOption[]>;
  canCreateCustomers?: boolean;
};

const LABEL = { customers: { one: "customer", many: "customers", link: "/customers" }, leads: { one: "enquiry", many: "enquiries", link: "/leads" } };
const normKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Rows with the same unknown customer are resolved together.
const groupKey = (v: Record<string, string>) => (v.customer_code ? `code:${v.customer_code.toUpperCase()}` : `name:${normKey(v.company_name ?? "")}`);

export function BulkImport({ entity, preview, commit, searchCustomers, canCreateCustomers }: Props) {
  const columns = columnsFor(entity);
  const label = LABEL[entity];
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; parsed: ParsedFile; token: string } | null>(null);
  const [results, setResults] = useState<ImportResultRow[] | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "ready" | "problems">("all");
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [busy, start] = useTransition();
  const [busyText, setBusyText] = useState("");

  const payload = (parsed: ParsedFile, res: Record<string, Resolution>) => parsed.rows.map((r) => {
    const choice = entity === "leads" ? res[groupKey(r.values)] : undefined;
    if (!choice?.mode || (choice.mode === "link" && !choice.customer)) return r.values;
    return { ...r.values, customer_resolution: choice.mode, ...(choice.customer ? { customer_id: choice.customer.id } : {}) };
  });

  const check = (f: { name: string; parsed: ParsedFile; token: string }, res: Record<string, Resolution>) => start(async () => {
    setBusyText(`Checking ${f.parsed.rows.length} rows…`);
    const r = await preview(payload(f.parsed, res));
    if (!r.ok) { setError(r.error); setResults(null); return; }
    setError(null); setResults(r.data!.rows);
  });

  const onFile = (picked?: File) => {
    if (!picked) return;
    setError(null); setResults(null); setDone(false); setResolutions({}); setFile(null); setFilter("all");
    start(async () => {
      setBusyText("Reading the file…");
      try {
        const parsed = await readImportFile(picked, columns);
        if (parsed.missingRequired.length) {
          setError(`The file is missing the column${parsed.missingRequired.length > 1 ? "s" : ""}: ${parsed.missingRequired.join(", ")}. Use the template.`);
          return;
        }
        const f = { name: picked.name, parsed, token: crypto.randomUUID() };
        setFile(f);
        setBusyText(`Checking ${parsed.rows.length} rows…`);
        const r = await preview(payload(parsed, {}));
        if (!r.ok) { setError(r.error); return; }
        setResults(r.data!.rows);
      } catch (e) {
        setError((e as Error).message || "The file could not be read.");
      } finally {
        if (input.current) input.current.value = "";
      }
    });
  };

  const counts = useMemo(() => {
    const c = { total: 0, ready: 0, imported: 0, unmatched: 0, problems: 0 };
    (results ?? []).forEach((r) => {
      c.total++;
      if (r.status === "ready") c.ready++;
      else if (r.status === "imported") c.imported++;
      else if (r.status === "unmatched") c.unmatched++;
      else c.problems++;
    });
    return c;
  }, [results]);

  // Unknown customers on enquiry rows, grouped.
  const groups = useMemo(() => {
    if (entity !== "leads" || !file || !results || done) return [];
    const m = new Map<string, { key: string; label: string; rows: number[]; message: string; hasName: boolean }>();
    results.forEach((r, i) => {
      const v = file.parsed.rows[i].values;
      const k = groupKey(v);
      const chosen = resolutions[k]?.mode;
      if (r.status !== "unmatched" && !chosen) return;
      const g = m.get(k) ?? { key: k, label: v.customer_code ? `Code ${v.customer_code}` : v.company_name ?? "(no company)", rows: [], message: r.messages[0] ?? "", hasName: !!v.company_name };
      g.rows.push(file.parsed.rows[i].rowNumber);
      m.set(k, g);
    });
    return [...m.values()];
  }, [entity, file, results, resolutions, done]);
  const pendingChoices = groups.some((g) => !resolutions[g.key]?.mode || (resolutions[g.key].mode === "link" && !resolutions[g.key].customer));

  const doImport = () => {
    if (!file || !counts.ready) return;
    if (!confirm(`Import ${counts.ready} ${counts.ready === 1 ? label.one : label.many}? Rows with problems are not imported.`)) return;
    start(async () => {
      setBusyText(`Importing ${counts.ready} rows…`);
      const r = await commit(payload(file.parsed, resolutions), file.name, file.token);
      if (!r.ok) return setError(r.error);
      setError(null); setResults(r.data!.rows); setDone(true); setFilter("all");
    });
  };

  const reportRows = (results ?? []).map((r, i) => ({ r, src: file!.parsed.rows[i] })).filter(({ r }) => !["ready", "imported"].includes(r.status));
  const shown = (results ?? []).map((r, i) => ({ r, src: file!.parsed.rows[i] }))
    .filter(({ r }) => filter === "all" || (filter === "ready" ? ["ready", "imported"].includes(r.status) : !["ready", "imported"].includes(r.status)));
  const keyCols = entity === "customers" ? ["name", "email", "phone", "trn"] : ["title", "company_name", "customer_code"];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>1. Download the template</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-600">
          <p>Fill one row per {label.one}. Columns marked * are required. The Excel template has an Instructions sheet explaining every column.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => downloadTemplate(columns, `${label.many}-import-template`, "xlsx")}><FileSpreadsheet /> Excel template</Button>
            <Button type="button" variant="outline" onClick={() => downloadTemplate(columns, `${label.many}-import-template`, "csv")}><Download /> CSV template</Button>
          </div>
          <details className="rounded-md border border-slate-200">
            <summary className="cursor-pointer px-3 py-2 font-medium text-slate-700">Columns</summary>
            <Table>
              <THead><TR><TH>Column</TH><TH>What to enter</TH><TH>Example</TH></TR></THead>
              <TBody>{columns.map((c) => <TR key={c.key}><TD className="whitespace-nowrap font-medium">{c.header}{c.required && <span className="text-red-600"> *</span>}</TD><TD>{c.help}</TD><TD className="text-slate-500">{c.example || "—"}</TD></TR>)}</TBody>
            </Table>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Upload your file</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
            <Upload className="size-6 text-slate-400" />
            <p className="text-sm text-slate-600">Drop an Excel (.xlsx) or CSV file here, or</p>
            <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <Button type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? <Loader2 className="animate-spin" /> : <Upload />} Choose file</Button>
            <p className="text-xs text-slate-500">Up to 2,000 rows per file.</p>
          </div>
          {busy && <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="size-4 animate-spin" /> {busyText}</p>}
          {error && <Alert tone="error">{error}</Alert>}
          {file && !busy && (
            <p className="text-sm text-slate-600"><span className="font-medium text-slate-900">{file.name}</span> · {file.parsed.rows.length} data rows
              {file.parsed.unknownHeaders.length > 0 && <span className="text-amber-700"> · Ignored columns: {file.parsed.unknownHeaders.join(", ")}</span>}</p>
          )}
        </CardContent>
      </Card>

      {results && file && (
        <>
          {done ? (
            <Alert tone={counts.imported ? "success" : "warning"}>
              {counts.imported} {counts.imported === 1 ? label.one : label.many} imported.{" "}
              {reportRows.length > 0 ? `${reportRows.length} row${reportRows.length === 1 ? " was" : "s were"} not imported — download the report, fix the rows and import them again.` : "Every row was imported."}
            </Alert>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Rows in file" value={counts.total} />
            <StatCard label={done ? "Imported" : "Ready to import"} value={done ? counts.imported : counts.ready} tone="success" />
            {entity === "leads" && <StatCard label="Customer to choose" value={counts.unmatched} tone={counts.unmatched ? "warning" : "default"} hint={counts.unmatched ? "Resolve below" : undefined} />}
            <StatCard label={done ? "Not imported" : "With problems"} value={done ? reportRows.length : counts.problems} tone={(done ? reportRows.length : counts.problems) ? "danger" : "default"} hint="Duplicates and invalid rows" />
          </div>

          {groups.length > 0 && (
            <Card>
              <CardHeader><CardTitle>3. Customers not found</CardTitle><span className="text-xs text-slate-500">Choose what to do, then re-check</span></CardHeader>
              <CardContent className="space-y-3">
                {groups.map((g) => (
                  <CustomerChoice key={g.key} label={g.label} rows={g.rows} message={g.message} hasName={g.hasName} canCreate={!!canCreateCustomers}
                    value={resolutions[g.key] ?? { mode: "" }} search={searchCustomers!}
                    onChange={(v) => setResolutions((x) => ({ ...x, [g.key]: v }))} />
                ))}
                <div className="flex justify-end">
                  <Button type="button" variant="outline" disabled={busy || pendingChoices} onClick={() => check(file, resolutions)}>
                    {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Apply choices and re-check
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{done ? "Import result" : "Preview"}</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {(["all", "ready", "problems"] as const).map((f) => (
                  <button key={f} type="button" onClick={() => setFilter(f)}
                    className={cn("rounded-full px-3 py-1 text-xs font-medium", filter === f ? "bg-navy-800 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>
                    {f === "all" ? "All rows" : f === "ready" ? (done ? "Imported" : "Ready") : "Problems"}
                  </button>
                ))}
                {reportRows.length > 0 && (
                  <Button type="button" size="sm" variant="outline" onClick={() => downloadErrorReport(columns, reportRows.map(({ r, src }) => ({ rowNumber: src.rowNumber, values: src.values, status: r.status, messages: r.messages })), label.many)}>
                    <Download /> Error report
                  </Button>
                )}
              </div>
            </CardHeader>
            <Table>
              <THead><TR><TH>Row</TH><TH>Status</TH>{keyCols.map((k) => <TH key={k}>{columns.find((c) => c.key === k)?.header}</TH>)}{entity === "leads" && <TH>Customer</TH>}<TH>Details</TH></TR></THead>
              <TBody>
                {shown.length === 0 && <EmptyRow colSpan={keyCols.length + 4}>No rows in this view.</EmptyRow>}
                {shown.slice(0, 500).map(({ r, src }) => (
                  <TR key={src.rowNumber}>
                    <TD className="tabular-nums text-slate-500">{src.rowNumber}</TD>
                    <TD><StatusBadge status={r.status} /></TD>
                    {keyCols.map((k) => <TD key={k} className="max-w-[220px] truncate">{src.values[k] ?? ""}</TD>)}
                    {entity === "leads" && <TD className="max-w-[220px] truncate text-slate-600">{r.customer ?? "—"}</TD>}
                    <TD className="min-w-[260px] text-xs">
                      {r.status === "imported" && r.id ? <Link href={`${label.link}/${r.id}`} className="font-medium text-navy-700 hover:underline">{r.code ?? "Open"}</Link>
                        : r.messages.length ? <ul className="space-y-0.5 text-red-700">{r.messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
                        : <span className="text-emerald-700">OK</span>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {shown.length > 500 && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Showing the first 500 rows of this view. The error report contains every row with problems.</p>}
          </Card>

          <div className="flex flex-wrap justify-end gap-2">
            {done ? (
              <>
                <Link href={label.link} className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50">Back to {label.many}</Link>
                <Button type="button" onClick={() => { setFile(null); setResults(null); setDone(false); input.current?.click(); }}><Upload /> Import another file</Button>
              </>
            ) : (
              <Button type="button" variant="success" disabled={busy || counts.ready === 0} onClick={doImport}>
                {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Import {counts.ready} {counts.ready === 1 ? label.one : label.many}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CustomerChoice({ label, rows, message, hasName, canCreate, value, onChange, search }: {
  label: string; rows: number[]; message: string; hasName: boolean; canCreate: boolean;
  value: Resolution; onChange: (v: Resolution) => void; search: (q: string) => Promise<CustomerOption[]>;
}) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<CustomerOption[] | null>(null);
  const [searching, start] = useTransition();
  const find = () => start(async () => setOptions(await search(q)));
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-slate-900">{label}</p>
          <p className="text-xs text-slate-500">{message} · row{rows.length > 1 ? "s" : ""} {rows.slice(0, 8).join(", ")}{rows.length > 8 ? "…" : ""}</p>
        </div>
        <Select className="w-64" value={value.mode} onChange={(e) => onChange({ mode: e.target.value as Resolution["mode"] })} aria-label={`What to do with ${label}`}>
          <option value="">Choose…</option>
          <option value="link">Link to an existing customer</option>
          {hasName && canCreate && <option value="create">Create a new customer</option>}
          {hasName && <option value="prospect">Keep as prospect (no customer record)</option>}
          <option value="skip">Skip these rows</option>
        </Select>
      </div>
      {value.mode === "link" && (
        <div className="mt-3 space-y-2">
          {value.customer ? (
            <p className="flex items-center gap-2 text-sm">Linked to <Badge tone="navy">{value.customer.code}</Badge> {value.customer.name}
              <button type="button" className="text-xs text-navy-700 hover:underline" onClick={() => onChange({ mode: "link" })}>change</button></p>
          ) : (
            <>
              <div className="flex gap-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer name or code" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); find(); } }} />
                <Button type="button" variant="outline" disabled={searching} onClick={find}>{searching ? <Loader2 className="animate-spin" /> : null} Search</Button>
              </div>
              {options && (options.length === 0 ? <p className="text-xs text-slate-500">No matching customers.</p> : (
                <ul className="max-h-48 divide-y divide-slate-100 overflow-auto rounded-md border border-slate-200">
                  {options.map((o) => (
                    <li key={o.id}><button type="button" onClick={() => onChange({ mode: "link", customer: o })} className="flex w-full gap-2 px-3 py-1.5 text-left text-sm hover:bg-navy-50">
                      <span className="font-mono text-xs text-slate-500">{o.code}</span>{o.name}</button></li>
                  ))}
                </ul>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
