/** Template and error-report downloads (generated in the browser). */
import type { ImportColumn } from "./columns";

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const csvCell = (v: string) => (/[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export async function downloadTemplate(columns: ImportColumn[], baseName: string, format: "xlsx" | "csv") {
  if (format === "csv") {
    const text = "﻿" + columns.map((c) => csvCell(c.header + (c.required ? " *" : ""))).join(",") + "\r\n";
    return save(new Blob([text], { type: "text/csv;charset=utf-8" }), `${baseName}.csv`);
  }
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const head = columns.map((c) => ({ value: c.header + (c.required ? " *" : ""), fontWeight: "bold" as const, backgroundColor: "#E2E8F0" }));
  const info = [
    [{ value: "Column", fontWeight: "bold" as const }, { value: "Required", fontWeight: "bold" as const }, { value: "What to enter", fontWeight: "bold" as const }, { value: "Example", fontWeight: "bold" as const }],
    ...columns.map((c) => [{ value: c.header }, { value: c.required ? "Yes" : "" }, { value: c.help }, { value: c.example }]),
    [], [{ value: "Fill the Data sheet from row 2. Keep the header row. One row per record. Rows with problems are reported on the preview screen and are not imported." }],
  ];
  const blob = await writeXlsxFile([
    { data: [head], sheet: "Data", columns: columns.map((c) => ({ width: Math.max(14, c.header.length + 4) })), stickyRowsCount: 1 },
    { data: info as any, sheet: "Instructions", columns: [{ width: 26 }, { width: 10 }, { width: 70 }, { width: 30 }] },
  ]).toBlob();
  save(blob, `${baseName}.xlsx`);
}

export type ReportRow = { rowNumber: number; values: Record<string, string>; status: string; messages: string[] };

export async function downloadErrorReport(columns: ImportColumn[], rows: ReportRow[], baseName: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const head = ["Row in file", "Status", "Problems", ...columns.map((c) => c.header)].map((v) => ({ value: v, fontWeight: "bold" as const, backgroundColor: "#E2E8F0" }));
  const data = rows.map((r) => [
    { value: r.rowNumber }, { value: r.status }, { value: r.messages.join(" ") },
    ...columns.map((c) => ({ value: r.values[c.key] ?? "" })),
  ]);
  const blob = await writeXlsxFile([head, ...data] as any, { columns: [{ width: 10 }, { width: 12 }, { width: 60 }, ...columns.map(() => ({ width: 20 }))], stickyRowsCount: 1 }).toBlob();
  save(blob, `${baseName}-problems.xlsx`);
}
