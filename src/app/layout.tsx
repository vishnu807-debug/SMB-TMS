import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { getBranding } from "@/lib/branding";

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  return {
    title: { default: `${b.companyName} · ${b.productName}`, template: `%s · ${b.companyName}` },
    robots: { index: false, follow: false },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
