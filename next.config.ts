import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@react-pdf/renderer"],
  // The PDF routes read font files from disk at runtime (our Inter fonts, and pdfkit's
  // built-in standard fonts which it loads on start-up). File tracing cannot see these
  // dynamic reads, so list them explicitly or they are missing on Vercel.
  outputFileTracingIncludes: Object.fromEntries(
    ["/quotations/[id]/pdf", "/quotations/[id]/package", "/purchase-orders/[id]/pdf", "/logistics/deliveries/[id]/pdf", "/invoices/[id]/pdf"].map((route) => [
      route,
      ["./node_modules/@fontsource/inter/files/inter-latin-{400,700}-normal.woff", "./node_modules/pdfkit/js/standard-fonts/**/*"],
    ]),
  ),
  experimental: { serverActions: { bodySizeLimit: "26mb" } },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
