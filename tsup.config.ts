import { defineConfig } from "tsup"

/**
 * Dua build:
 *  1. `dist/cli.js` — CLI lengkap (semua paket @ibrax/* di-inline; dependensi
 *     pihak ketiga tetap eksternal sesuai `dependencies`).
 *  2. `dist/skills/**` — skill contoh yang dikompilasi ke JS (mandiri), agar
 *     dapat dimuat tanpa TS loader saat dijalankan dari paket npm.
 */
export default defineConfig([
  {
    entry: { cli: "packages/cli/src/index.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    outDir: "dist",
    clean: true,
    splitting: false,
    sourcemap: false,
    dts: false,
    minify: false,
    banner: { js: "#!/usr/bin/env node" },
    noExternal: [/^@ibrax\//],
  },
  {
    entry: { sdk: "packages/sdk/src/index.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    outDir: "dist",
    clean: false,
    splitting: false,
    sourcemap: false,
    dts: true,
    minify: false,
  },
  {
    entry: {
      "skills/reminders/index": "skills/reminders/index.ts",
      "skills/scheduler/index": "skills/scheduler/index.ts",
      "skills/digest/index": "skills/digest/index.ts",
      "skills/web-fetch/index": "skills/web-fetch/index.ts",
      "skills/web-search/index": "skills/web-search/index.ts",
    },
    format: ["esm"],
    platform: "node",
    target: "node20",
    outDir: "dist",
    clean: false,
    splitting: false,
    sourcemap: false,
    dts: false,
    noExternal: [/^@ibrax\//],
  },
])
