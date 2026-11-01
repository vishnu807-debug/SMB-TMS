"use client";
import { useActionState } from "react";
import { saveWarehouse } from "./actions";
import type { ActionResult } from "@/lib/errors";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";

type W = { id: string; code: string; name: string; address: string | null; phone: string | null; is_active: boolean };

export function WarehouseForm({ warehouse }: { warehouse?: W }) {
  const [state, action] = useActionState<ActionResult | undefined, FormData>(saveWarehouse, undefined);
  return (
    <form action={action} className="space-y-3">
      {state && <Alert tone={state.ok ? "success" : "error"}>{state.ok ? state.message : state.error}</Alert>}
      <input type="hidden" name="id" value={warehouse?.id ?? ""} />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Code" htmlFor={`code-${warehouse?.id ?? "new"}`} required>
          <Input id={`code-${warehouse?.id ?? "new"}`} name="code" defaultValue={warehouse?.code} className="uppercase" maxLength={20} required />
        </Field>
        <Field label="Name" htmlFor={`name-${warehouse?.id ?? "new"}`} required className="col-span-2">
          <Input id={`name-${warehouse?.id ?? "new"}`} name="name" defaultValue={warehouse?.name} required />
        </Field>
      </div>
      <Field label="Address" htmlFor={`addr-${warehouse?.id ?? "new"}`}><Input id={`addr-${warehouse?.id ?? "new"}`} name="address" defaultValue={warehouse?.address ?? ""} /></Field>
      <Field label="Phone" htmlFor={`phone-${warehouse?.id ?? "new"}`}><Input id={`phone-${warehouse?.id ?? "new"}`} name="phone" defaultValue={warehouse?.phone ?? ""} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={warehouse?.is_active ?? true} className="size-4" /> Active</label>
      <div className="flex justify-end"><SubmitButton size="sm">{warehouse ? "Save" : "Add warehouse"}</SubmitButton></div>
    </form>
  );
}
