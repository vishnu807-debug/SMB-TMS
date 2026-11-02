/* eslint-disable @next/next/no-img-element */
import { getBranding, type Branding } from "@/lib/branding";

function CompanyMark({ b, size = "md" }: { b: Branding; size?: "md" | "sm" }) {
  const box = size === "md" ? "size-10 text-lg" : "size-8 text-sm";
  return b.companyLogoUrl
    // Logos sit on a white tile so they stay visible on any panel colour.
    ? <span className={`inline-flex rounded-md bg-white ${size === "md" ? "px-3 py-2" : "px-2 py-1 ring-1 ring-slate-200"}`}><img src={b.companyLogoUrl} alt={b.companyName} className={size === "md" ? "h-10 max-w-[200px] object-contain" : "h-7 max-w-[140px] object-contain"} /></span>
    : <div className={`flex ${box} items-center justify-center rounded-md bg-white font-bold`} style={{ color: b.panelColor }}>{b.companyName.slice(0, 1).toUpperCase()}</div>;
}

/** Sign-in pages. Colours, images, names and logos come from the branding settings. */
export async function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const b = await getBranding();
  const panelBg = b.panelImageUrl
    ? { backgroundImage: `linear-gradient(${b.panelColor}cc, ${b.panelColor}e6), url("${b.panelImageUrl}")`, backgroundSize: "cover", backgroundPosition: "center" }
    : {};
  const formBg = b.formImageUrl ? { backgroundImage: `url("${b.formImageUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : {};
  return (
    <main className="flex min-h-screen">
      {/* Accent colour for the sign-in button and links. */}
      <style>{`.auth-form button[type=submit]{background-color:${b.accentColor}} .auth-form button[type=submit]:hover{filter:brightness(1.15)} .auth-form a{color:${b.accentColor}}`}</style>
      <div className="hidden w-[44%] flex-col justify-between p-12 lg:flex" style={{ backgroundColor: b.panelColor, color: b.panelTextColor, ...panelBg }}>
        <div className="flex items-center gap-3">
          <CompanyMark b={b} />
          {!b.companyLogoUrl && <span className="text-lg font-semibold tracking-wide">{b.companyName}</span>}
        </div>
        <div>
          <h1 className="text-3xl font-semibold leading-tight">{b.productName}</h1>
          {b.tagline && <p className="mt-3 max-w-sm opacity-80">{b.tagline}</p>}
        </div>
        <p className="text-xs opacity-70">{b.notice}</p>
      </div>
      <div className="flex flex-1 flex-col" style={{ backgroundColor: b.formColor, ...formBg }}>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className={`auth-form w-full max-w-sm ${b.formImageUrl ? "rounded-xl bg-white/95 p-8 shadow-xl backdrop-blur" : ""}`}>
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <CompanyMark b={b} size="sm" />
              <span className="font-semibold text-slate-900">{b.companyLogoUrl ? "" : b.companyName}</span>
            </div>
            <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mb-6 mt-1 text-sm text-slate-500">{subtitle}</p>}
            {children}
          </div>
        </div>
        {/* Company and product logos at the foot of the screen. */}
        <footer className={`flex flex-wrap items-center justify-between gap-3 px-6 py-4 text-xs ${b.formImageUrl ? "bg-white/90 text-slate-600 backdrop-blur" : "border-t border-slate-200/70 text-slate-500"}`}>
          <div className="flex items-center gap-2">
            {b.companyLogoUrl && <img src={b.companyLogoUrl} alt="" className="h-6 max-w-[120px] object-contain" />}
            <span>© {new Date().getFullYear()} {b.companyName}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Powered by</span>
            {b.productLogoUrl ? <img src={b.productLogoUrl} alt={b.productName} className="h-6 max-w-[140px] object-contain" /> : null}
            <span className="font-medium text-slate-700">{b.productName}</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
