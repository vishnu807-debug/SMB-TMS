"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { ChevronRight, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { deleteCategory, saveCategory } from "../actions";
import type { ActionResult } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";

export type Cat = {
  id: string; name: string; code: string | null; parent_id: string | null; depth: number; full_path: string;
  path_ids: string[]; sort_order: number; is_active: boolean; description?: string | null;
  product_count: number; product_count_incl_sub: number;
};

type Editing = { mode: "new"; parentId: string | null } | { mode: "edit"; cat: Cat } | null;

export function CategoryManager({ categories, canManage }: { categories: Cat[]; canManage: boolean }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [state, action] = useActionState<ActionResult | undefined, FormData>(saveCategory, undefined);
  const [busy, start] = useTransition();
  const [notice, setNotice] = useState<ActionResult | null>(null);

  useEffect(() => { if (state?.ok) setEditing(null); }, [state]);

  const current = editing?.mode === "edit" ? editing.cat : null;
  // A category cannot move under itself or its own descendants.
  const parentChoices = categories.filter((c) => !current || !c.path_ids.includes(current.id));

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Category tree</CardTitle>
          {canManage && <Button size="sm" onClick={() => setEditing({ mode: "new", parentId: null })}><FolderPlus /> New top-level category</Button>}
        </CardHeader>
        <CardContent className="p-0">
          {notice && <div className="p-4 pb-0"><Alert tone={notice.ok ? "success" : "error"}>{notice.ok ? notice.message : notice.error}</Alert></div>}
          {categories.length === 0 && <p className="p-6 text-sm text-slate-500">No categories yet.</p>}
          <ul className="divide-y divide-slate-100">
            {categories.map((c) => (
              <li key={c.id} className="group flex items-center gap-2 px-4 py-2" style={{ paddingLeft: 16 + c.depth * 22 }}>
                <ChevronRight className="size-3.5 text-slate-300" />
                <span className={c.is_active ? "font-medium text-slate-900" : "text-slate-400 line-through"}>{c.name}</span>
                {c.code && <span className="font-mono text-xs text-slate-400">{c.code}</span>}
                {!c.is_active && <Badge>Inactive</Badge>}
                <span className="ml-auto text-xs text-slate-500">
                  {c.product_count_incl_sub} product{c.product_count_incl_sub === 1 ? "" : "s"}
                </span>
                {canManage && (
                  <span className="flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <Button size="icon" variant="ghost" title="Add subcategory" aria-label={`Add subcategory to ${c.name}`}
                      onClick={() => setEditing({ mode: "new", parentId: c.id })}><FolderPlus /></Button>
                    <Button size="icon" variant="ghost" title="Edit" aria-label={`Edit ${c.name}`}
                      onClick={() => setEditing({ mode: "edit", cat: c })}><Pencil /></Button>
                    <Button size="icon" variant="ghost" title="Delete" aria-label={`Delete ${c.name}`} disabled={busy}
                      onClick={() => {
                        if (!confirm(`Delete "${c.name}"? Only empty categories can be deleted.`)) return;
                        start(async () => setNotice(await deleteCategory(c.id)));
                      }}><Trash2 /></Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {canManage && editing && (
        <Card className="h-fit lg:col-span-2">
          <CardHeader><CardTitle>{editing.mode === "new" ? "New category" : `Edit ${current?.name}`}</CardTitle></CardHeader>
          <CardContent>
            <form key={editing.mode === "edit" ? editing.cat.id : `new-${editing.parentId}`} action={action} className="space-y-4">
              {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
              <input type="hidden" name="id" value={current?.id ?? ""} />
              <Field label="Name" htmlFor="cat-name" required>
                <Input id="cat-name" name="name" defaultValue={current?.name} required maxLength={100} autoFocus />
              </Field>
              <Field label="Parent category" htmlFor="cat-parent" hint="Moving a category moves all its subcategories with it">
                <Select id="cat-parent" name="parent_id" defaultValue={current?.parent_id ?? (editing.mode === "new" ? editing.parentId ?? "" : "")}>
                  <option value="">— Top level —</option>
                  {parentChoices.map((c) => <option key={c.id} value={c.id}>{c.full_path}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Code" htmlFor="cat-code"><Input id="cat-code" name="code" defaultValue={current?.code ?? ""} className="uppercase" maxLength={20} /></Field>
                <Field label="Sort order" htmlFor="cat-sort"><Input id="cat-sort" name="sort_order" type="number" min={0} defaultValue={current?.sort_order ?? 0} /></Field>
              </div>
              <Field label="Description" htmlFor="cat-desc"><Textarea id="cat-desc" name="description" defaultValue={current?.description ?? ""} rows={2} /></Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_active" defaultChecked={current?.is_active ?? true} className="size-4 rounded border-slate-300" /> Active
              </label>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <SubmitButton>Save</SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
