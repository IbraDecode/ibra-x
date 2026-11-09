import { resolve } from "node:path"
import {
  EventBus,
  Runtime,
  Store,
  coreMemorySkill,
  createLogger,
  createTranscriber,
  ensureDataDir,
  loadMcpSkills,
  loadSkills,
  type IbraConfig,
  type SkillRegistry,
} from "@ibrax/core"
import type { Logger, SkillStore } from "@ibrax/sdk"
import { findPreset, resolveProvider } from "@ibrax/providers"
import { WhatsAppManager, whatsappSkill, type AccountStatus } from "@ibrax/whatsapp"

export interface CreateAppOptions {
  /** Cetak QR ke terminal otomatis. */
  printQr?: boolean
  /** Jalankan transport WhatsApp saat createApp. Default false. */
  autoStart?: boolean
  /** Jalankan aksi `ask` tanpa persetujuan (mode auto/CLI --yes). */
  autoApprove?: boolean
  /** Callback QR khusus (menimpa cetak terminal). */
  onQr?: (accountId: string, qr: string) => void
}

export interface IbraApp {
  config: IbraConfig
  logger: Logger
  store: Store
  bus: EventBus
  registry: SkillRegistry
  runtime: Runtime
  manager: WhatsAppManager
  start(): Promise<void>
  stop(): void
}

/**
 * Menyusun seluruh aplikasi Ibra X dari sebuah config. Ini satu-satunya tempat
 * yang mengetahui semua paket, sehingga CLI dan server dapat berbagi komposisi
 * yang sama tanpa duplikasi.
 */
export async function createApp(config: IbraConfig, opts: CreateAppOptions = {}): Promise<IbraApp> {
  const logger = createLogger({ level: config.logLevel, bindings: { app: "ibra-x" } })
  const dataDir = ensureDataDir(config)
  const store = new Store(resolve(dataDir, "ibra.sqlite"))
  const bus = new EventBus()

  const provider = resolveProvider({ providerId: config.provider })

  const rootSkillStore: SkillStore = {
    get: async <T>(key: string) => store.kvGet<T>(`skill:${key}`),
    set: async (key, value) => store.kvSet(`skill:${key}`, value),
    delete: async (key) => store.kvDelete(`skill:${key}`),
    list: async (prefix = "") => store.kvList(`skill:${prefix}`),
  }

  const registry = await loadSkills({
    dirs: config.skills.dirs,
    packages: config.skills.packages,
    disabled: config.skills.disabled,
    builtins: [coreMemorySkill, whatsappSkill],
    store: rootSkillStore,
    logger: logger.child({ comp: "skills" }),
  })

  // Server MCP: daftarkan tool-nya sebagai skill.
  const mcp = await loadMcpSkills(config.mcpServers, logger.child({ comp: "mcp" }))
  for (const skill of mcp.skills) registry.register(skill)

  const manager = new WhatsAppManager({
    config,
    dataDir,
    logger: logger.child({ comp: "whatsapp" }),
    onInbound: () => {},
    onQr: opts.onQr,
    onStatus: (accountId: string, status: AccountStatus, reason?: string) => {
      bus.emit("account.status", { accountId, status, reason })
    },
    printQr: opts.printQr,
  })

  // Transkripsi audio (opsional) memakai endpoint penyedia aktif.
  let transcriber
  if (config.media.transcribe) {
    const preset = findPreset(config.provider)
    const apiKey = preset?.apiKeyEnv ? process.env[preset.apiKeyEnv] : undefined
    if (preset) {
      transcriber = createTranscriber({
        baseUrl: preset.baseUrl,
        apiKey,
        model: config.media.transcribeModel,
        maxBytes: config.media.maxAudioBytes,
      })
      logger.info({ model: config.media.transcribeModel }, "transkripsi audio aktif")
    }
  }

  const runtime = new Runtime({
    config,
    store,
    bus,
    logger: logger.child({ comp: "runtime" }),
    provider,
    registry,
    transport: manager,
    autoApprove: opts.autoApprove,
    transcriber,
  })

  manager.setInboundHandler((msg) => runtime.handleInbound(msg))

  // Registrasi akun ke store untuk jejak & audit.
  for (const account of config.accounts) {
    store.upsertAccount({ id: account.id, role: account.role, label: account.label, enabled: account.enabled })
  }

  bus.on("account.status", ({ accountId, status, reason }) => {
    logger.info({ accountId, status, reason }, "status akun WhatsApp")
  })

  async function start(): Promise<void> {
    await manager.startAll()
  }

  function stop(): void {
    manager.stopAll()
    void Promise.all(mcp.clients.map((client) => client.close().catch(() => {})))
    store.close()
  }

  const app: IbraApp = { config, logger, store, bus, registry, runtime, manager, start, stop }
  if (opts.autoStart) await start()
  return app
}
