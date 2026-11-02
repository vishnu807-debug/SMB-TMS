export type ImportResultRow = {
  row: number; status: "ready" | "error" | "duplicate" | "unmatched" | "skipped" | "imported"; messages: string[];
  id?: string | null; code?: string | null; customer?: string | null;
};
export type ImportResult = { rows: ImportResultRow[]; batch_id?: string | null };
export type CustomerOption = { id: string; code: string; name: string };
