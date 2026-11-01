/**
 * Mirrors the generated columns on quotation_lines / sales_order_lines so the
 * editor shows exactly what the database will store. The database remains the
 * source of truth; this is only for live display while editing.
 */
export function round2(x: number) {
  // Half away from zero, like PostgreSQL numeric round().
  const s = Math.sign(x);
  return (s * Math.round(Math.abs(x) * 100 + 1e-9)) / 100;
}

export function computeLine(qty: number, unitPrice: number, discountPct: number, taxRate: number) {
  const gross = round2(qty * unitPrice);
  const discount = round2((gross * discountPct) / 100);
  const net = round2(gross - discount);
  const tax = round2((net * taxRate) / 100);
  return { gross, discount, net, tax, total: round2(net + tax) };
}

export function computeTotals(lines: ReturnType<typeof computeLine>[]) {
  const sum = (k: keyof ReturnType<typeof computeLine>) => round2(lines.reduce((s, l) => s + l[k], 0));
  return { gross: sum("gross"), discount: sum("discount"), net: sum("net"), tax: sum("tax"), total: sum("total") };
}
