import { loadConfig } from "@ibrax/core"
import { startServer } from "./index.ts"

// Entri mandiri server: `npm run server` / `node dist/...`
startServer(loadConfig().config).catch((error) => {
  console.error("Gagal menjalankan server:", error)
  process.exit(1)
})
