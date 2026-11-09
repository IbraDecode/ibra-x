import { resolve } from "node:path"
import {
  EventBus,
  Runtime,
  Scheduler,
  Store,
  WebhookDispatcher,
  coreMemorySkill,
  createImageDescriber,
  createLogger,
  createSpeaker,
  createTranscriber,
  ensureDataDir,
  loadMcpSkills,
  loadSkills,
  registerSkillJobs,
  resolveSkillDirs,
  subagentSkill,
  type IbraConfig,
  type ImageDescriber,
  type SkillRegistry,
  type Speaker,
  type Transcriber,
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
  scheduler: Scheduler
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

  // Webhook keluar (opsional): tersambung ke bus event.
  const webhooks = new WebhookDispatcher(bus, { logger: logger.child({ comp: "webhooks" }) })
  webhooks.start(config.webhooks)

  const provider = resolveProvider({ providerId: config.provider })

  const rootSkillStore: SkillStore = {
    get: async <T>(key: string) => store.kvGet<T>(`skill:${key}`),
    set: async (key, value) => store.kvSet(`skill:${key}`, value),
    delete: async (key) => store.kvDelete(`skill:${key}`),
    list: async (prefix = "") => store.kvList(`skill:${prefix}`),
  }

  // Skill paket (hasil build berada di <paket>/dist/skills) + skill dari config.
  const registry = await loadSkills({
    dirs: resolveSkillDirs(config.skills.dirs, import.meta.url),
    packages: config.skills.packages,
    disabled: config.skills.disabled,
    builtins: [coreMemorySkill, whatsappSkill, subagentSkill],
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
  let transcriber: Transcriber | undefined
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

  // Deskripsi gambar (opsional) memakai model multimodal.
  let imageDescriber: ImageDescriber | undefined
  if (config.media.describeImages) {
    const preset = findPreset(config.provider)
    const apiKey = preset?.apiKeyEnv ? process.env[preset.apiKeyEnv] : undefined
    if (preset) {
      imageDescriber = createImageDescriber({
        baseUrl: preset.baseUrl,
        apiKey,
        model: config.media.visionModel ?? config.model,
        maxBytes: config.media.maxImageBytes,
      })
      logger.info({ model: config.media.visionModel ?? config.model }, "deskripsi gambar aktif")
    }
  }

  // Sintesis suara (opsional) untuk balasan voice note.
  let speaker: Speaker | undefined
  if (config.media.speak) {
    const preset = findPreset(config.provider)
    const apiKey = preset?.apiKeyEnv ? process.env[preset.apiKeyEnv] : undefined
    if (preset) {
      speaker = createSpeaker({
        baseUrl: preset.baseUrl,
        apiKey,
        model: config.media.ttsModel,
        voice: config.media.ttsVoice,
      })
      logger.info({ model: config.media.ttsModel }, "sintesis suara aktif")
    }
  }
  const mediaDir = resolve(dataDir, "media")

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
    imageDescriber,
    speaker,
    mediaDir,
  })

  manager.setInboundHandler((msg) => runtime.handleInbound(msg))

  // Scheduler untuk job periodik milik skill (pengingat, pesan terjadwal, dst.).
  const scheduler = new Scheduler({ logger: logger.child({ comp: "scheduler" }) })
  registerSkillJobs(scheduler, registry.list(), {
    runtime,
    storeFor: (skillId) => runtime.skillStore(skillId),
    logger: logger.child({ comp: "jobs" }),
  })

  // Registrasi akun ke store untuk jejak & audit.
  for (const account of config.accounts) {
    store.upsertAccount({ id: account.id, role: account.role, label: account.label, enabled: account.enabled })
  }

  bus.on("account.status", ({ accountId, status, reason }) => {
    logger.info({ accountId, status, reason }, "status akun WhatsApp")
  })

  async function start(): Promise<void> {
    await manager.startAll()
    scheduler.start()
  }

  function stop(): void {
    scheduler.stop()
    webhooks.stop()
    manager.stopAll()
    void Promise.all(mcp.clients.map((client) => client.close().catch(() => {})))
    store.close()
  }

  const app: IbraApp = { config, logger, store, bus, registry, runtime, manager, scheduler, start, stop }
  if (opts.autoStart) await start()
  return app
}
