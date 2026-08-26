import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const isDev = process.env.NODE_ENV !== "production";
const orchestratorOrigin = readOrigin(
  process.env.ORCHESTRATOR_BASE_URL ?? "https://api.agentforall.co.il",
);

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://connect.facebook.net`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' https: data:",
  `connect-src 'self' ${orchestratorOrigin} https://storage.googleapis.com https://*.supabase.co https://www.facebook.com https://connect.facebook.net`,
  `frame-src 'self' ${orchestratorOrigin}`,
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  transpilePackages: ["@agent-forall/db"],
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: csp },
      ],
    },
  ],
};

function readOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "https://api.agentforall.co.il";
  }
}

export default createMDX({})(nextConfig);
