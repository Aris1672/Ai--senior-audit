import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist and @napi-rs/canvas (used for scanned-PDF → vision rendering
  // in lib/file-parser.ts) ship native/WASM bindings that Turbopack can't
  // place into an ESM chunk. Marking them external tells Next.js to leave
  // them out of the bundle and require() them directly at runtime instead.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
