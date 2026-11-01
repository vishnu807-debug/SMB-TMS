export type DocKind = "receipts" | "issues" | "transfers" | "adjustments";

export const DOC_KINDS: Record<DocKind, {
  title: string; singular: string; table: string; linesTable: string; parentKey: string; dateField: string;
  createPermission: string; docType: string; saveRpc: string; description: string;
}> = {
  receipts: {
    title: "Goods received", singular: "Goods received note", table: "goods_receipts", linesTable: "goods_receipt_lines",
    parentKey: "goods_receipt_id", dateField: "receipt_date", createPermission: "inventory.receive", docType: "goods_receipt",
    saveRpc: "save_goods_receipt", description: "Stock received into a warehouse, valued at purchase cost.",
  },
  issues: {
    title: "Goods issued", singular: "Goods issue", table: "goods_issues", linesTable: "goods_issue_lines",
    parentKey: "goods_issue_id", dateField: "issue_date", createPermission: "inventory.issue", docType: "goods_issue",
    saveRpc: "save_goods_issue", description: "Stock leaving a warehouse for internal use, samples or return to supplier.",
  },
  transfers: {
    title: "Stock transfers", singular: "Stock transfer", table: "stock_transfers", linesTable: "stock_transfer_lines",
    parentKey: "stock_transfer_id", dateField: "transfer_date", createPermission: "inventory.transfer", docType: "stock_transfer",
    saveRpc: "save_stock_transfer", description: "Stock moved between warehouses. In-transit stock shows as incoming at the destination.",
  },
  adjustments: {
    title: "Stock adjustments", singular: "Stock adjustment", table: "stock_adjustments", linesTable: "stock_adjustment_lines",
    parentKey: "stock_adjustment_id", dateField: "adjustment_date", createPermission: "inventory.adjust", docType: "stock_adjustment",
    saveRpc: "save_stock_adjustment", description: "The only way to correct a balance. Every adjustment needs approval before it posts.",
  },
};

export function isDocKind(k: string): k is DocKind {
  return k in DOC_KINDS;
}

export const ISSUE_TYPES = ["internal_use", "sample", "return_to_supplier", "other"] as const;
export const ADJUSTMENT_REASONS = ["physical_count", "damaged", "expired", "lost_or_stolen", "found", "data_correction", "opening_balance", "other"] as const;
