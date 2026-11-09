import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import pc from "picocolors"
import {
  ConfigSchema,
  Store,
  coreMemorySkill,
  createLogger,
  ensureDataDir,
  loadConfig,
  loadDotEnv,
  loadSkills,
  saveConfig,
  configPath,
  type IbraConfig,
} from "@ibrax/core"
import { findPreset, listProviders, providerStatuses } from "@ibrax/providers"
import { createApp } from "@ibrax/app"
import { startServer } from "@ibrax/server"
import { whatsappSkill } from "@ibrax/whatsapp"

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

async function ask(question: string, fallback = ""): Promise<string> {
  if (!process.stdin.isTTY) return fallback
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(`${question}${fallback ? pc.dim(` (${fallback})`) : ""}: `)).trim()
    return answer || fallback
  } finally {
    rl.close()
  }
}

function envPath(cwd = process.cwd()): string {
  return resolve(cwd, ".env")
}

/** Menulis/mengganti satu variabel di file .env. */
function writeEnvVar(key: string, value: string, cwd = process.cwd()): void {
  const path = envPath(cwd)
  const line = `${key}=${value}`
  let content = existsSync(path) ? readFileSync(path, "utf8") : ""
  const re = new RegExp(`^${key}=.*$`, "m")
  if (re.test(content)) content = content.replace(re, line)
  else content += (content.endsWith("\n") || content === "" ? "" : "\n") + line + "\n"
  writeFileSync(path, content, "utf8")
}

function loadContext(): { config: IbraConfig; path: string } {
  loadDotEnv(envPath())
  return loadConfig()
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export async function cmdInit(): Promise<void> {
  console.log(pc.bold("\n🧠 Ibra X — penyiapan\n"))

  const providers = listProviders()
  console.log("Penyedia LLM yang tersedia:")
  providers.forEach((p, i) => console.log(`  ${pc.cyan(String(i + 1).padStart(2))}. ${p.id.padEnd(12)} ${pc.dim(p.label)}`))
  const providerChoice = await ask("\nPilih penyedia (id atau nomor)", "openrouter")
  const provider =
    providers[Number(providerChoice) - 1]?.id ?? providers.find((p) => p.id === providerChoice)?.id ?? "openrouter"
  const preset = findPreset(provider)!

  if (preset.requiresKey) {
    const key = await ask(`Masukkan API key ${preset.label}`, "")
    if (key) {
      writeEnvVar(preset.apiKeyEnv ?? `${preset.id.toUpperCase()}_API_KEY`, key)
      console.log(pc.green(`✓ Disimpan ke .env sebagai ${preset.apiKeyEnv}`))
    } else {
      console.log(pc.yellow(`! Belum ada API key. Isi ${preset.apiKeyEnv} di .env nanti.`))
    }
  }

  const model = await ask("Model default", preset.recommendedModels?.[0] ?? "gpt-4.1-mini")
  const autonomy = await ask("Tingkat otonomi (readonly|suggest|auto|autonomous)", "suggest")
  const owner = await ask("Nomor owner (opsional, format 62812...)", "")
  const accountId = await ask("ID akun WhatsApp", "primary")
  const role = await ask("Peran akun (observer|assistant|hybrid)", "hybrid")

  const config = ConfigSchema.parse({
    provider,
    model,
    autonomy,
    ownerNumbers: owner ? [owner] : [],
    accounts: [{ id: accountId, role, enabled: true, respondTo: "allowlist" }],
  })

  ensureDataDir(config)
  const path = configPath(config.dataDir)
  saveConfig(config, path)

  console.log(pc.green(`\n✓ Konfigurasi disimpan: ${path}`))
  console.log(pc.bold("\nLangkah berikutnya:"))
  console.log(`  1. ${pc.cyan("ibrax pair " + accountId + " <nomor-tanpa-plus>")}  — tautkan WhatsApp via kode pairing`)
  console.log(`     atau ${pc.cyan("ibrax start")} lalu pindai QR yang muncul`)
  console.log(`  2. ${pc.cyan("ibrax start")}  — jalankan agen + server\n`)
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

export async function cmdStart(): Promise<void> {
  const { config } = loadContext()
  if (!config.accounts.length) {
    console.log(pc.yellow("Belum ada akun. Jalankan `ibrax init` dulu."))
    return
  }

  const autoApprove = config.autonomy === "auto" || config.autonomy === "autonomous"
  const { app } = await startServer(config, { printQr: true, autoApprove })

  console.log(pc.bold(pc.green("\n🚀 Ibra X berjalan")))
  console.log(`   Provider : ${config.provider} (${config.model})`)
  console.log(`   Otonomi  : ${config.autonomy}`)
  console.log(`   Akun     : ${config.accounts.map((a) => `${a.id}/${a.role}`).join(", ")}`)
  console.log(`   API      : http://${config.host}:${config.port}/health`)
  console.log(pc.dim("\nTekan Ctrl+C untuk berhenti.\n"))

  const shutdown = () => {
    console.log(pc.dim("\nMenghentikan…"))
    app.stop()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  // Jaga proses tetap hidup.
  await new Promise<void>(() => {})
}

// ---------------------------------------------------------------------------
// pair
// ---------------------------------------------------------------------------

export async function cmdPair(accountId: string, phone: string): Promise<void> {
  const { config } = loadContext()
  const app = await createApp(config, { printQr: false })
  try {
    console.log(pc.dim(`Menjalankan akun ${accountId}…`))
    const runtime = await app.manager.startAccount(accountId)
    const code = await runtime.requestPairingCode(phone.replace(/[^0-9]/g, ""))
    console.log(pc.bold(pc.green(`\nKode pairing: ${code}\n`)))
    console.log("Buka WhatsApp → Perangkat Tertaut → Tautkan dengan nomor telepon, lalu masukkan kode di atas.")
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (runtime.status === "open") {
          clearInterval(t)
          console.log(pc.green("\n✓ Berhasil tertaut!"))
          resolve()
        }
      }, 1500)
      setTimeout(() => {
        clearInterval(t)
        resolve()
      }, 120_000)
    })
  } finally {
    app.stop()
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function cmdStatus(): Promise<void> {
  const { config } = loadContext()
  const store = new Store(resolve(process.cwd(), config.dataDir, "ibra.sqlite"))
  const registry = await loadSkills({
    dirs: config.skills.dirs,
    packages: config.skills.packages,
    disabled: config.skills.disabled,
    builtins: [coreMemorySkill, whatsappSkill],
    store: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
    logger: createLogger({ level: "error" }),
  })

  console.log(pc.bold("\n📊 Status Ibra X\n"))
  console.log(`  Provider : ${config.provider} (${config.model})`)
  console.log(`  Otonomi  : ${config.autonomy}`)
  console.log(`  Data     : ${config.dataDir}`)
  console.log(`  Akun     : ${config.accounts.map((a) => `${a.id}/${a.role}`).join(", ") || pc.dim("(belum ada)")}`)
  console.log(`  Skill    : ${registry.list().map((s) => s.id).join(", ") || pc.dim("(kosong)")}`)
  console.log(`  Tool     : ${registry.tools().length}`)
  console.log(`  Pesan    : ${store.countMessages()}`)
  console.log(`  Memori   : ${store.countMemory()}\n`)
  store.close()
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

export async function cmdDoctor(): Promise<void> {
  const { config, path } = loadContext()
  console.log(pc.bold("\n🩺 Diagnostik Ibra X\n"))

  const nodeMajor = Number(process.versions.node.split(".")[0])
  console.log(`  Node.js  : ${process.version} ${nodeMajor >= 20 ? pc.green("✓") : pc.red("✗ butuh >= 20")}`)
  console.log(`  Config   : ${existsSync(path) ? pc.green(path) : pc.yellow("(belum ada — jalankan `ibrax init`)")}`)

  try {
    ensureDataDir(config)
    const store = new Store(resolve(process.cwd(), config.dataDir, "ibra.sqlite"))
    store.kvSet("__doctor__", Date.now())
    store.close()
    console.log(`  SQLite   : ${pc.green("✓")} (data dir dapat ditulis)`)
  } catch (error) {
    console.log(`  SQLite   : ${pc.red("✗ " + String(error))}`)
  }

  console.log(pc.bold("\n  Penyedia LLM:"))
  for (const { info, hasKey } of providerStatuses()) {
    const mark = hasKey ? pc.green("✓") : pc.dim("–")
    console.log(`    ${mark} ${info.id.padEnd(12)} ${info.requiresKey ? (hasKey ? "" : pc.dim("(tanpa kunci)")) : pc.dim("(tanpa kunci)")}`)
  }

  const activePreset = findPreset(config.provider)
  const activeHasKey = activePreset?.requiresKey ? Boolean(activePreset.apiKeyEnv && process.env[activePreset.apiKeyEnv]) : true
  console.log(
    `\n  Provider aktif : ${config.provider} ${activeHasKey ? pc.green("✓") : pc.red("✗ kunci belum di-set")}`,
  )
  console.log()
}

// ---------------------------------------------------------------------------
// skills
// ---------------------------------------------------------------------------

export async function cmdSkills(): Promise<void> {
  const { config } = loadContext()
  const registry = await loadSkills({
    dirs: config.skills.dirs,
    packages: config.skills.packages,
    disabled: config.skills.disabled,
    builtins: [coreMemorySkill, whatsappSkill],
    store: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
    logger: createLogger({ level: "error" }),
  })
  console.log(pc.bold(`\n🧩 Skill terpasang (${registry.list().length})\n`))
  for (const skill of registry.list()) {
    console.log(`  ${pc.cyan(skill.id)} — ${skill.name}${skill.description ? pc.dim(" · " + skill.description) : ""}`)
    for (const tool of skill.tools ?? []) {
      console.log(`      • ${tool.name} ${pc.dim(`[${tool.risk}]`)}`)
    }
    for (const job of skill.jobs ?? []) {
      console.log(`      ⏱ ${job.id} ${pc.dim(`setiap ${Math.max(1, Math.round(job.intervalMs / 1000))}s`)}`)
    }
  }
  console.log()
}

// ---------------------------------------------------------------------------
// memory
// ---------------------------------------------------------------------------

export async function cmdMemorySearch(query: string, limit = 20): Promise<void> {
  const { config } = loadContext()
  const store = new Store(resolve(process.cwd(), config.dataDir, "ibra.sqlite"))
  const rows = store.searchMemory(query, { limit })
  console.log(pc.bold(`\n🔎 ${rows.length} hasil untuk "${query}"\n`))
  for (const row of rows) {
    console.log(`  ${pc.dim(row.id.slice(0, 8))} ${pc.cyan(`[${row.scope}${row.scopeId ? ":" + row.scopeId : ""}]`)} ${row.text}`)
  }
  console.log()
  store.close()
}

export async function cmdMemoryList(limit = 50): Promise<void> {
  const { config } = loadContext()
  const store = new Store(resolve(process.cwd(), config.dataDir, "ibra.sqlite"))
  const rows = store.searchMemory("", { limit })
  console.log(pc.bold(`\n🧠 Memori (${store.countMemory()} total)\n`))
  for (const row of rows) console.log(`  ${pc.dim(row.id.slice(0, 8))} ${row.text}`)
  console.log()
  store.close()
}

export async function cmdMemoryRemove(id: string): Promise<void> {
  const { config } = loadContext()
  const store = new Store(resolve(process.cwd(), config.dataDir, "ibra.sqlite"))
  store.deleteMemory(id)
  console.log(pc.green(`✓ Memori ${id} dihapus (bila ada).`))
  store.close()
}

// ---------------------------------------------------------------------------
// chat (uji agen dari terminal)
// ---------------------------------------------------------------------------

export async function cmdChat(text: string, opts: { chat?: string; account?: string }): Promise<void> {
  const { config } = loadContext()
  const app = await createApp(config, { autoApprove: true })
  try {
    const accountId = opts.account ?? config.accounts[0]?.id ?? "default"
    const chatId = opts.chat ?? "cli:local"
    app.store.insertMessage({
      id: `cli-${Date.now()}`,
      accountId,
      chatId,
      senderId: "cli:local",
      fromMe: false,
      text,
      timestamp: Date.now(),
    })
    const result = await app.runtime.agent.run({
      accountId,
      chatId,
      chatKind: "dm",
      role: "hybrid",
      senderId: "cli:local",
      sessionId: app.runtime.session.sessionId(accountId, chatId),
    })
    console.log(pc.bold("\n🤖 Ibra X:\n"))
    console.log(result.text)
    console.log(pc.dim(`\n[reason=${result.reason} steps=${result.steps} tokens=${(result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0)}]`))
  } finally {
    app.stop()
  }
}
