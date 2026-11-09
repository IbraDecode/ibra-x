import type { JobContext, Logger, RuntimeApi, Skill, SkillStore } from "@ibrax/sdk"

export interface PeriodicTask {
  name: string
  intervalMs: number
  lastRun: number
  handler: () => Promise<void>
}

export interface SchedulerOptions {
  logger: Logger
  /** Dapat disuntik untuk pengujian waktu deterministik. */
  now?: () => number
}

/**
 * Scheduler ringan untuk job periodik milik skill. Tidak memakai layanan
 * eksternal dan tidak mempersistenkan job — setiap skill menyimpan state-nya
 * sendiri lewat `SkillStore`, sehingga scheduler tetap sederhana.
 */
export class Scheduler {
  private readonly tasks: PeriodicTask[] = []
  private timer?: NodeJS.Timeout
  private readonly now: () => number

  constructor(private readonly opts: SchedulerOptions) {
    this.now = opts.now ?? (() => Date.now())
  }

  registerPeriodic(name: string, intervalMs: number, handler: () => Promise<void>): void {
    this.tasks.push({ name, intervalMs, lastRun: Number.NEGATIVE_INFINITY, handler })
  }

  /** Menjalankan satu putaran: menjalankan tugas yang sudah waktunya. */
  async tick(now = this.now()): Promise<void> {
    for (const task of this.tasks) {
      if (now - task.lastRun < task.intervalMs) continue
      task.lastRun = now
      try {
        await task.handler()
      } catch (error) {
        this.opts.logger.error({ error, task: task.name }, "job terjadwal gagal")
      }
    }
  }

  start(tickIntervalMs = 15_000): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), tickIntervalMs)
    this.opts.logger.info({ tasks: this.tasks.length }, "scheduler berjalan")
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  get taskNames(): string[] {
    return this.tasks.map((t) => t.name)
  }
}

/** Mendaftarkan seluruh job yang dideklarasikan skill ke scheduler. */
export function registerSkillJobs(
  scheduler: Scheduler,
  skills: Skill[],
  deps: { runtime: RuntimeApi; storeFor: (skillId: string) => SkillStore; logger: Logger },
): void {
  for (const skill of skills) {
    for (const job of skill.jobs ?? []) {
      const store = deps.storeFor(skill.id)
      const jobLogger = deps.logger.child({ skill: skill.id, job: job.id })
      scheduler.registerPeriodic(`${skill.id}:${job.id}`, job.intervalMs, async () => {
        const ctx: JobContext = { store, runtime: deps.runtime, logger: jobLogger }
        await job.run(ctx)
      })
    }
  }
}
