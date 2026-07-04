import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist and @napi-rs/canvas (used for scanned-PDF → vision rendering
  // in lib/file-parser.ts) ship native/WASM bindings that Turbopack can't
  // place into an ESM chunk. Marking them external tells Next.js to leave
  // them out of the bundle and require() them directly at runtime instead.
  // pdf-parse@2.x bundles its OWN nested pdfjs-dist copy (with its own worker
  // .mjs file) separate from the top-level pdfjs-dist used for scanned-PDF
  // rendering below. Marking only the top-level package external doesn't cover
  // pdf-parse's internal copy — its worker file gets dropped during bundling,
  // causing "Cannot find module .../pdf-parse/node_modules/pdfjs-dist/.../pdf.worker.mjs"
  // at runtime. Adding pdf-parse itself here makes Next skip bundling it, so
  // Vercel's file-tracing copies its full node_modules subtree (worker included).
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "pdf-parse"],
};

export default nextConfig;
