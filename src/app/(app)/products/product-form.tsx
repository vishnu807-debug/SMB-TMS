"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { saveProduct, type ProductFormState } from "./actions";
import type { ProductLookups } from "./lookups";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

export type ProductFormValues = {
  id?: string; sku?: string; name?: string; item_type?: string; category_id?: string | null; brand_id?: string | null;
  uom_id?: string; description?: string | null; model_no?: string | null; barcode?: string | null; hs_code?: string | null;
  default_supplier_id?: string | null; default_supplier_name?: string | null; currency_code?: string;
  purchase_price?: number | null; default_sell_price?: number | null; tax_code_id?: string | null;
  min_stock_level?: number | null; reorder_qty?: number | null; technical_specs?: { name: string; value: string }[];
};

export function ProductForm({ lookups, initial }: { lookups: ProductLookups; initial?: ProductFormValues }) {
  const [state, action] = useActionState<ProductFormState, FormData>(saveProduct, undefined);
  const [specs, setSpecs] = useState(initial?.technical_specs?.length ? initial.technical_specs : [{ name: "", value: "" }]);
  const [itemType, setItemType] = useState(initial?.item_type ?? "stock");
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  const defaultTax = lookups.taxCodes.find((t) => t.is_default)?.id;

  return (
    <form action={action} className="space-y-6">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="id" value={initial?.id ?? ""} />
      <input type="hidden" name="technical_specs" value={JSON.stringify(specs.filter((s) => s.name.trim()))} />

      <Card>
        <CardHeader><CardTitle>General</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Product name" htmlFor="name" required error={fe.name} className="md:col-span-2">
            <Input id="name" name="name" defaultValue={initial?.name} required maxLength={200} />
          </Field>
          <Field label="SKU / product code" htmlFor="sku" hint="Leave blank to number automatically" error={fe.sku}>
            <Input id="sku" name="sku" defaultValue={initial?.sku} className="font-mono uppercase" maxLength={40} />
          </Field>
          <Field label="Type" htmlFor="item_type" required hint={itemType === "stock" ? "Kept in inventory" : "Never held in stock"}>
            <Select id="item_type" name="item_type" value={itemType} onChange={(e) => setItemType(e.target.value)}>
              <option value="stock">Stock item</option>
              <option value="non_stock">Non-stock item (always procured)</option>
              <option value="service">Service</option>
            </Select>
          </Field>
          <Field label="Category" htmlFor="category_id" error={fe.category_id}>
            <Select id="category_id" name="category_id" defaultValue={initial?.category_id ?? ""}>
              <option value="">— None —</option>
              {lookups.categories.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.is_active}>
                  {"   ".repeat(c.depth)}{c.full_path.split(" › ").pop()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Brand" htmlFor="brand_id" hint="Or type a new brand below">
            <Select id="brand_id" name="brand_id" defaultValue={initial?.brand_id ?? ""}>
              <option value="">— None —</option>
              {lookups.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Input name="new_brand" placeholder="New brand name" className="mt-2" maxLength={80} />
          </Field>
          <Field label="Unit of measurement" htmlFor="uom_id" required error={fe.uom_id}>
            <Select id="uom_id" name="uom_id" defaultValue={initial?.uom_id ?? ""} required>
              <option value="">Select…</option>
              {lookups.uoms.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
            </Select>
          </Field>
          <Field label="Model number" htmlFor="model_no"><Input id="model_no" name="model_no" defaultValue={initial?.model_no ?? ""} /></Field>
          <Field label="Barcode" htmlFor="barcode"><Input id="barcode" name="barcode" defaultValue={initial?.barcode ?? ""} /></Field>
          <Field label="Description" htmlFor="description" className="md:col-span-3">
            <Textarea id="description" name="description" defaultValue={initial?.description ?? ""} rows={3} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Technical specifications</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setSpecs([...specs, { name: "", value: "" }])}>
            <Plus /> Add row
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {specs.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <GripVertical className="size-4 text-slate-300" />
              <Input placeholder="Specification (e.g. Voltage)" value={s.name} maxLength={80} className="w-1/3"
                onChange={(e) => setSpecs(specs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input placeholder="Value (e.g. 600/1000 V)" value={s.value} maxLength={500}
                onChange={(e) => setSpecs(specs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove row" onClick={() => setSpecs(specs.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          {specs.length === 0 && <p className="text-sm text-slate-500">No specifications.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Pricing, VAT and supplier</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Preferred currency" htmlFor="currency_code" required>
            <Select id="currency_code" name="currency_code" defaultValue={initial?.currency_code ?? "AED"}>
              {lookups.currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
            </Select>
          </Field>
          {lookups.canViewCost ? (
            <Field label="Purchase price" htmlFor="purchase_price" error={fe.purchase_price}>
              <Input id="purchase_price" name="purchase_price" type="number" min="0" step="0.0001" defaultValue={initial?.purchase_price ?? ""} />
            </Field>
          ) : <input type="hidden" name="purchase_price" value="" />}
          <Field label="Selling price" htmlFor="default_sell_price" error={fe.default_sell_price}>
            <Input id="default_sell_price" name="default_sell_price" type="number" min="0" step="0.01" defaultValue={initial?.default_sell_price ?? ""} />
          </Field>
          <Field label="VAT category" htmlFor="tax_code_id">
            <Select id="tax_code_id" name="tax_code_id" defaultValue={initial?.tax_code_id ?? defaultTax ?? ""}>
              {lookups.taxCodes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          {lookups.canViewSuppliers ? (
            <Field label="Default supplier" htmlFor="default_supplier_id">
              <Select id="default_supplier_id" name="default_supplier_id" defaultValue={initial?.default_supplier_id ?? ""}>
                <option value="">— None —</option>
                {lookups.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
              </Select>
            </Field>
          ) : (
            <Field label="Default supplier">
              <input type="hidden" name="default_supplier_id" value={initial?.default_supplier_id ?? ""} />
              <Input value={initial?.default_supplier_name ?? "—"} disabled />
            </Field>
          )}
          <Field label="HS code" htmlFor="hs_code" hint="Customs tariff code"><Input id="hs_code" name="hs_code" defaultValue={initial?.hs_code ?? ""} /></Field>
        </CardContent>
      </Card>

      {itemType === "stock" ? (
        <Card>
          <CardHeader><CardTitle>Stock control</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Field label="Minimum stock level" htmlFor="min_stock_level" hint="Alert when available stock falls below this" error={fe.min_stock_level}>
              <Input id="min_stock_level" name="min_stock_level" type="number" min="0" step="0.001" defaultValue={initial?.min_stock_level ?? 0} />
            </Field>
            <Field label="Reorder quantity" htmlFor="reorder_qty" hint="Suggested quantity to buy">
              <Input id="reorder_qty" name="reorder_qty" type="number" min="0" step="0.001" defaultValue={initial?.reorder_qty ?? 0} />
            </Field>
          </CardContent>
        </Card>
      ) : (
        <><input type="hidden" name="min_stock_level" value="0" /><input type="hidden" name="reorder_qty" value="0" /></>
      )}

      <div className="flex justify-end gap-2">
        <Link href={initial?.id ? `/products/${initial.id}` : "/products"} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <SubmitButton>{initial?.id ? "Save changes" : "Create product"}</SubmitButton>
      </div>
    </form>
  );
}
