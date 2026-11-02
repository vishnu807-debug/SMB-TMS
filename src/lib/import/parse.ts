/** Browser-side reading of CSV / Excel files into rows keyed by template column. */
import type { ImportColumn } from "./columns";
import { MAX_IMPORT_ROWS } from "./columns";

export type ParsedFile = {
  rows: { rowNumber: number; values: Record<string, string> }[];
  unknownHeaders: string[];
  missingRequired: string[];
};

const norm = (s: string) => s.toLowerCase().replace(/\*/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    // Excel dates arrive as UTC midnight.
    return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v).trim();
}

/** RFC 4180 CSV with "," or ";" separators (detected from the header line). */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** dd/mm/yyyy, dd-mm-yyyy and dd.mm.yyyy → yyyy-mm-dd (UAE day-first format). */
export function normaliseDate(v: string): string {
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return v;
}

export async function readImportFile(file: File, columns: ImportColumn[]): Promise<ParsedFile> {
  let table: unknown[][];
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    table = parseCsv(await file.text());
  } else if (name.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser");
    table = (await readSheet(file)) as unknown[][];
  } else if (name.endsWith(".xls")) {
    throw new Error("Old Excel files (.xls) are not supported. Save the file as .xlsx or .csv and try again.");
  } else {
    throw new Error("Upload an Excel (.xlsx) or CSV file.");
  }
  // The header row is the first row with any text in it.
  const start = table.findIndex((r) => r.some((c) => cellText(c) !== ""));
  if (start < 0) throw new Error("The file is empty.");
  const headers = table[start].map((c) => cellText(c));
  const lookup = new Map<string, string>();
  for (const col of columns) for (const a of [col.header, col.key, ...(col.aliases ?? [])]) lookup.set(norm(a), col.key);
  const keys = headers.map((h) => lookup.get(norm(h)) ?? null);
  const unknownHeaders = headers.filter((h, i) => h && !keys[i]);
  const missingRequired = columns.filter((c) => c.required && !keys.includes(c.key)).map((c) => c.header);

  const rows: ParsedFile["rows"] = [];
  for (let i = start + 1; i < table.length; i++) {
    const values: Record<string, string> = {};
    let any = false;
    keys.forEach((k, j) => {
      if (!k) return;
      let v = cellText(table[i][j]);
      if (k.endsWith("_date") && v) v = normaliseDate(v);
      if (v) { values[k] = v.slice(0, 4000); any = true; }
    });
    if (any) rows.push({ rowNumber: i + 1, values });
  }
  if (rows.length === 0) throw new Error("The file has a header row but no data rows.");
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`The file has ${rows.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time.`);
  return { rows, unknownHeaders, missingRequired };
}
