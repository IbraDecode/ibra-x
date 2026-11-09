import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Logger, RuntimeApi, Skill, SkillStore } from "@ibrax/sdk"
import { Scheduler, registerSkillJobs } from "./scheduler.ts"

const logger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => logger,
}

const fakeRuntime: RuntimeApi = {
  accountId: "a1",
  sendMessage: async () => ({ messageId: "m" }),
  getChatHistory: async () => [],
  markRead: async () => {},
  memory: { remember: async () => ({ id: "1" }), search: async () => [], forget: async () => {} },
}

test("tick menjalankan tugas sesuai interval", async () => {
  let now = 0
  const scheduler = new Scheduler({ logger, now: () => now })
  let count = 0
  scheduler.registerPeriodic("t", 1000, async () => {
    count++
  })

  await scheduler.tick()
  assert.equal(count, 1, "jalan pertama kali")

  now = 500
  await scheduler.tick()
  assert.equal(count, 1, "belum waktunya")

  now = 1000
  await scheduler.tick()
  assert.equal(count, 2, "jalan setelah interval")

  assert.deepEqual(scheduler.taskNames, ["t"])
})

test("job yang gagal tidak menghentikan tick", async () => {
  const now = 0
  const scheduler = new Scheduler({ logger, now: () => now })
  let good = 0
  scheduler.registerPeriodic("bad", 1, async () => {
    throw new Error("boom")
  })
  scheduler.registerPeriodic("good", 1, async () => {
    good++
  })
  await scheduler.tick()
  assert.equal(good, 1)
})

test("registerSkillJobs meneruskan store skill ke job", async () => {
  const scheduler = new Scheduler({ logger, now: () => 0 })
  const store: SkillStore = {
    get: async <T>(key: string) => (key === "n" ? (5 as unknown as T) : undefined),
    set: async () => {},
    delete: async () => {},
    list: async () => [],
  }
  let observed: unknown
  const skill: Skill = {
    id: "s",
    name: "S",
    jobs: [
      {
        id: "j",
        intervalMs: 1000,
        run: async (ctx) => {
          observed = await ctx.store.get("n")
        },
      },
    ],
  }

  registerSkillJobs(scheduler, [skill], { runtime: fakeRuntime, storeFor: () => store, logger })
  assert.deepEqual(scheduler.taskNames, ["s:j"])
  await scheduler.tick()
  assert.equal(observed, 5)
})
