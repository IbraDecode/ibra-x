#!/usr/bin/env node
// Shim CLI Ibra X: menjalankan TypeScript sumber dengan tsx.
// Tidak ada build step — cukup `npm install` lalu jalankan.
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const entry = resolve(here, "../src/index.ts")

const child = spawn(process.execPath, ["--import", "tsx", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
})

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
