import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist and @napi-rs/canvas (used for scanned-PDF → vision rendering
  // in lib/file-parser.ts) ship native/WASM bindings that Turbopack can't
  // place into an ESM chunk. Marking them external tells Next.js to leave
  // them out of the bundle and require() them directly at runtime instead.
  // pdf-parse was removed entirely (see lib/file-parser.ts) — its nested
  // pdfjs-dist copy's worker file kept getting dropped by Vercel's file-tracing
  // no matter what was externalized, so text extraction now uses the top-level
  // pdfjs-dist directly instead (same package as the scanned-PDF image path).
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
