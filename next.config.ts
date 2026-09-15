import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Documentos de hasta 4 MB (spec 002, FR-003) más el sobrecosto de multipart. Vercel no acepta más de 4,5 MB.
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;
