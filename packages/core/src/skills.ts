import { existsSync, readdirSync, statSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Logger, Skill, SkillStore, Tool } from "@ibrax/sdk"

/**
 * Menghitung direktori skill: sertakan direktori skill bawaan paket (hasil
 * build `dist/skills`, sebelah modul pemanggil) bila ada, lalu dir dari config.
 * `moduleUrl` adalah `import.meta.url` pemanggil.
 */
export function resolveSkillDirs(configDirs: string[], moduleUrl: string): string[] {
  let packaged: string | undefined
  try {
    packaged = fileURLToPath(new URL("./skills", moduleUrl))
  } catch {
    packaged = undefined
  }
  return [...(packaged && existsSync(packaged) ? [packaged] : []), ...configDirs]
}

export interface LoadSkillsOptions {
  /** Direktori yang dipindai (relatif terhadap cwd). */
  dirs?: string[]
  /** Nama paket npm yang diekspor sebagai skill. */
  packages?: string[]
  /** id skill yang dinonaktifkan. */
  disabled?: string[]
  /** Skill bawaan yang selalu tersedia. */
  builtins?: Skill[]
  store: SkillStore
  logger: Logger
  cwd?: string
}

/** Registry skill: menampung skill, mengindeks tool, dan menjalankan setup. */
export class SkillRegistry {
  private readonly skills = new Map<string, Skill>()
  private readonly toolOwners = new Map<string, Skill>()

  constructor(private readonly logger?: Logger) {}

  register(skill: Skill): void {
    if (this.skills.has(skill.id)) {
      this.logger?.warn({ skill: skill.id }, "skill dengan id sama sudah ada, menimpa")
    }
    for (const tool of skill.tools ?? []) {
      const existing = this.toolOwners.get(tool.name)
      if (existing && existing.id !== skill.id) {
        throw new Error(`Konflik nama tool "${tool.name}": dimiliki "${existing.id}" dan "${skill.id}"`)
      }
      this.toolOwners.set(tool.name, skill)
    }
    this.skills.set(skill.id, skill)
  }

  unregister(id: string): void {
    const skill = this.skills.get(id)
    if (!skill) return
    for (const tool of skill.tools ?? []) this.toolOwners.delete(tool.name)
    this.skills.delete(id)
  }

  list(): Skill[] {
    return [...this.skills.values()]
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id)
  }

  tools(): Tool[] {
    const out: Tool[] = []
    for (const skill of this.skills.values()) out.push(...(skill.tools ?? []))
    return out
  }

  getTool(name: string): { skill: Skill; tool: Tool } | undefined {
    const skill = this.toolOwners.get(name)
    if (!skill) return undefined
    const tool = (skill.tools ?? []).find((t) => t.name === name)
    return tool ? { skill, tool } : undefined
  }
}

async function importSkillModule(target: string, cwd: string): Promise<Skill | undefined> {
  const spec = isAbsolute(target) ? pathToFileURL(target).href : target
  const mod = (await import(spec)) as { default?: unknown; skill?: unknown }
  const candidate = mod.default ?? mod.skill
  if (candidate && typeof candidate === "object" && "id" in (candidate as object) && "name" in (candidate as object)) {
    return candidate as Skill
  }
  return undefined
}

/**
 * Memuat skill dari beberapa sumber:
 *  1. skill bawaan (in-code),
 *  2. paket npm (`ibra-skill-*` atau nama eksplisit),
 *  3. direktori lokal (setiap subdirektori dengan `index.ts`/`index.js`).
 */
export async function loadSkills(opts: LoadSkillsOptions): Promise<SkillRegistry> {
  const registry = new SkillRegistry(opts.logger)
  const disabled = new Set(opts.disabled ?? [])
  const cwd = opts.cwd ?? process.cwd()

  for (const skill of opts.builtins ?? []) {
    if (!disabled.has(skill.id)) registry.register(skill)
  }

  for (const pkg of opts.packages ?? []) {
    try {
      const skill = await importSkillModule(pkg, cwd)
      if (skill && !disabled.has(skill.id)) registry.register(skill)
      else if (!skill) opts.logger?.warn({ pkg }, "paket skill tidak mengekspor default skill")
    } catch (error) {
      opts.logger?.error({ pkg, error }, "gagal memuat paket skill")
    }
  }

  for (const dir of opts.dirs ?? []) {
    const abs = resolve(cwd, dir)
    if (!existsSync(abs)) continue
    for (const entry of readdirSync(abs)) {
      const full = join(abs, entry)
      if (!statSync(full).isDirectory()) continue
      for (const candidate of ["index.ts", "index.js", "index.mjs"]) {
        const file = join(full, candidate)
        if (!existsSync(file)) continue
        try {
          const skill = await importSkillModule(file, cwd)
          if (skill && !disabled.has(skill.id)) registry.register(skill)
          else if (skill) opts.logger?.debug({ skill: skill.id }, "skill dinonaktifkan")
        } catch (error) {
          opts.logger?.error({ file, error }, "gagal memuat skill lokal")
        }
        break
      }
    }
  }

  for (const skill of registry.list()) {
    if (skill.setup) {
      try {
        await skill.setup({ store: opts.store, logger: opts.logger.child({ skill: skill.id }) })
      } catch (error) {
        opts.logger?.error({ skill: skill.id, error }, "setup skill gagal")
      }
    }
  }

  opts.logger?.info({ skills: registry.list().map((s) => s.id), tools: registry.tools().length }, "skill dimuat")
  return registry
}
