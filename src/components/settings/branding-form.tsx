"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { saveBranding } from "@/app/(app)/settings/branding-actions";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export type BrandingValues = {
  productName: string; companyName: string; tagline: string | null; notice: string | null;
  panelColor: string; panelTextColor: string; formColor: string; accentColor: string;
  productLogoPath: string | null; companyLogoPath: string | null; panelImagePath: string | null; formImagePath: string | null;
  productLogoUrl: string | null; companyLogoUrl: string | null; panelImageUrl: string | null; formImageUrl: string | null;
};
type Slot = "product_logo_path" | "company_logo_path" | "panel_image_path" | "form_image_path";
type Img = { path: string | null; url: string | null; file?: File };

const SLOTS: Record<Slot, { label: string; folder: string; hint: string; types: string[] }> = {
  company_logo_path: { label: "Company logo", folder: "company", hint: "PNG or JPG, ideally on a transparent or white background. Also printed on quotations, orders and invoices.", types: ["image/png", "image/jpeg"] },
  product_logo_path: { label: "Product logo", folder: "product", hint: "PNG, JPG or WebP. Shown as “Powered by” at the foot of the login screen.", types: ["image/png", "image/jpeg", "image/webp"] },
  panel_image_path: { label: "Left panel background image", folder: "login", hint: "Optional. Wide photo; the panel colour is laid over it so text stays readable.", types: ["image/png", "image/jpeg", "image/webp"] },
  form_image_path: { label: "Sign-in side background image", folder: "login", hint: "Optional. The sign-in form is shown on a white card over it.", types: ["image/png", "image/jpeg", "image/webp"] },
};
const DEFAULT_COLORS = { panelColor: "#0b1b38", panelTextColor: "#ffffff", formColor: "#ffffff", accentColor: "#0f244b" };

export function BrandingForm({ initial, vendor }: { initial: BrandingValues; vendor: boolean }) {
  const router = useRouter();
  const [v, setV] = useState({
    productName: initial.productName, companyName: initial.companyName, tagline: initial.tagline ?? "", notice: initial.notice ?? "",
    panelColor: initial.panelColor, panelTextColor: initial.panelTextColor, formColor: initial.formColor, accentColor: initial.accentColor,
  });
  const [img, setImg] = useState<Record<Slot, Img>>({
    company_logo_path: { path: initial.companyLogoPath, url: initial.companyLogoUrl },
    product_logo_path: { path: initial.productLogoPath, url: initial.productLogoUrl },
    panel_image_path: { path: initial.panelImagePath, url: initial.panelImageUrl },
    form_image_path: { path: initial.formImagePath, url: initial.formImageUrl },
  });
  // Paths as last saved: replaced files are deleted after the next save.
  const saved = useRef<Record<string, string | null>>({ company_logo_path: initial.companyLogoPath, product_logo_path: initial.productLogoPath, panel_image_path: initial.panelImagePath, form_image_path: initial.formImagePath });
  const [busy, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof v, x: string) => setV((o) => ({ ...o, [k]: x }));
  const slots = (Object.keys(SLOTS) as Slot[]).filter((s) => vendor || s !== "product_logo_path");

  useEffect(() => () => Object.values(img).forEach((i) => i.file && i.url && URL.revokeObjectURL(i.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (slot: Slot, file?: File) => {
    if (!file) return;
    const spec = SLOTS[slot];
    if (!spec.types.includes(file.type)) return setResult({ ok: false, text: `${spec.label}: use ${spec.types.map((t) => t.split("/")[1].toUpperCase()).join(", ")}.` });
    if (file.size > 5 * 1024 * 1024) return setResult({ ok: false, text: `${spec.label}: images must be 5 MB or smaller.` });
    setResult(null);
    setImg((o) => ({ ...o, [slot]: { path: null, url: URL.createObjectURL(file), file } }));
  };

  const save = () => start(async () => {
    setResult(null);
    const storage = createClient().storage.from("branding");
    const payload: Record<string, string> = {
      company_name: v.companyName, tagline: v.tagline, notice: v.notice,
      panel_color: v.panelColor, panel_text_color: v.panelTextColor, form_color: v.formColor, accent_color: v.accentColor,
      ...(vendor ? { product_name: v.productName } : {}),
    };
    const uploaded: string[] = [];
    for (const slot of slots) {
      const i = img[slot];
      if (i.file) {
        const ext = i.file.type === "image/png" ? "png" : i.file.type === "image/webp" ? "webp" : "jpg";
        const path = `${SLOTS[slot].folder}/${crypto.randomUUID()}.${ext}`;
        const { error } = await storage.upload(path, i.file, { contentType: i.file.type, upsert: false });
        if (error) {
          if (uploaded.length) await storage.remove(uploaded);
          return setResult({ ok: false, text: `${SLOTS[slot].label}: ${/row-level security|Unauthorized/i.test(error.message) ? "you are not allowed to upload this image." : error.message}` });
        }
        uploaded.push(path);
        payload[slot] = path;
      } else payload[slot] = i.path ?? "";
    }
    const r = await saveBranding(payload, saved.current);
    if (!r.ok) return setResult({ ok: false, text: r.error });
    for (const slot of slots) saved.current[slot] = payload[slot] || null;
    setImg((o) => Object.fromEntries(Object.entries(o).map(([k, i]) => [k, { path: (payload[k] ?? i.path) || null, url: i.url }])) as Record<Slot, Img>);
    setResult({ ok: true, text: r.message ?? "Saved." });
    router.refresh();
  });

  const panelBg = img.panel_image_path.url
    ? { backgroundImage: `linear-gradient(${v.panelColor}cc, ${v.panelColor}e6), url("${img.panel_image_path.url}")`, backgroundSize: "cover", backgroundPosition: "center" } : {};
  const formBg = img.form_image_path.url ? { backgroundImage: `url("${img.form_image_path.url}")`, backgroundSize: "cover", backgroundPosition: "center" } : {};
  const colorField = (k: "panelColor" | "panelTextColor" | "formColor" | "accentColor", label: string) => (
    <Field label={label}>
      <div className="flex gap-2">
        <input type="color" value={v[k]} onChange={(e) => set(k, e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white p-0.5" aria-label={label} />
        <Input value={v[k]} onChange={(e) => set(k, e.target.value)} maxLength={7} className="font-mono" aria-label={`${label} hex`} />
      </div>
    </Field>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-4">
        {result && <Alert tone={result.ok ? "success" : "error"}>{result.text}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          {vendor ? (
            <Field label="Product name" required hint="Set by the system provider. Shown on the login screen, the menu and browser tabs.">
              <Input value={v.productName} maxLength={60} onChange={(e) => set("productName", e.target.value)} />
            </Field>
          ) : (
            <Field label="Product name" hint="Set by your system provider."><Input value={v.productName} disabled /></Field>
          )}
          <Field label="Company name" required><Input value={v.companyName} maxLength={80} onChange={(e) => set("companyName", e.target.value)} /></Field>
          <Field label="Tagline" className="sm:col-span-2"><Textarea rows={2} maxLength={200} value={v.tagline} onChange={(e) => set("tagline", e.target.value)} /></Field>
          <Field label="Notice at the bottom of the panel" className="sm:col-span-2"><Input maxLength={160} value={v.notice} onChange={(e) => set("notice", e.target.value)} /></Field>
          {colorField("panelColor", "Left panel colour")}
          {colorField("panelTextColor", "Left panel text colour")}
          {colorField("formColor", "Sign-in side colour")}
          {colorField("accentColor", "Button and link colour")}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setV((o) => ({ ...o, ...DEFAULT_COLORS }))}><RotateCcw /> Default colours</Button>
        <div className="space-y-3">
          {slots.map((slot) => (
            <div key={slot} className="flex items-center gap-3 rounded-md border border-slate-200 p-3">
              <div className="flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100">
                {img[slot].url ? <img src={img[slot].url!} alt="" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="size-5 text-slate-400" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{SLOTS[slot].label}{img[slot].file && <span className="ml-2 text-xs font-normal text-amber-700">not saved yet</span>}</p>
                <p className="text-xs text-slate-500">{SLOTS[slot].hint}</p>
              </div>
              <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium hover:bg-slate-50">
                {img[slot].url ? "Replace" : "Upload"}
                <input type="file" hidden accept={SLOTS[slot].types.join(",")} aria-label={`Upload ${SLOTS[slot].label}`} onChange={(e) => { pick(slot, e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              {img[slot].url && <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${SLOTS[slot].label}`} onClick={() => setImg((o) => ({ ...o, [slot]: { path: null, url: null } }))}><Trash2 /></Button>}
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save branding</Button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Login screen preview</p>
        <div className="flex aspect-[16/10] overflow-hidden rounded-lg border border-slate-200 text-[10px] shadow-sm">
          <div className="flex w-[44%] flex-col justify-between p-4" style={{ backgroundColor: v.panelColor, color: v.panelTextColor, ...panelBg }}>
            <div className="flex items-center gap-1.5">
              {img.company_logo_path.url ? <span className="rounded bg-white px-1.5 py-1"><img src={img.company_logo_path.url} alt="" className="h-5 max-w-[90px] object-contain" /></span>
                : <><span className="flex size-5 items-center justify-center rounded bg-white font-bold" style={{ color: v.panelColor }}>{v.companyName.slice(0, 1)}</span><span className="font-semibold">{v.companyName}</span></>}
            </div>
            <div><p className="text-sm font-semibold leading-tight">{v.productName}</p><p className="mt-1 opacity-80">{v.tagline}</p></div>
            <p className="opacity-70">{v.notice}</p>
          </div>
          <div className="flex flex-1 flex-col" style={{ backgroundColor: v.formColor, ...formBg }}>
            <div className="flex flex-1 items-center justify-center p-3">
              <div className={`w-3/4 space-y-1.5 ${img.form_image_path.url ? "rounded bg-white/95 p-3 shadow" : ""}`}>
                <p className="text-xs font-semibold text-slate-900">Sign in</p>
                <div className="h-4 rounded border border-slate-300 bg-white" /><div className="h-4 rounded border border-slate-300 bg-white" />
                <div className="flex h-4 items-center justify-center rounded text-white" style={{ backgroundColor: v.accentColor }}>Sign in</div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-200/70 bg-white/80 px-2 py-1 text-[8px] text-slate-500">
              <span className="flex items-center gap-1">{img.company_logo_path.url && <img src={img.company_logo_path.url} alt="" className="h-3" />}© {v.companyName}</span>
              <span className="flex items-center gap-1">Powered by {img.product_logo_path.url && <img src={img.product_logo_path.url} alt="" className="h-3" />}<b>{v.productName}</b></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
