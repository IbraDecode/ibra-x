import { strict as assert } from "node:assert"
import { test } from "node:test"
import { SlidingWindowLimiter, inQuietHours } from "./rate-limit.ts"

test("limiter mengizinkan sampai batas lalu menolak", () => {
  let now = 0
  const limiter = new SlidingWindowLimiter(60_000, 2, () => now)
  assert.equal(limiter.allow("a"), true)
  assert.equal(limiter.allow("a"), true)
  assert.equal(limiter.allow("a"), false, "melebihi batas")
  assert.equal(limiter.allow("b"), true, "kunci berbeda punya kuota sendiri")
})

test("limiter pulih setelah jendela berlalu", () => {
  let now = 0
  const limiter = new SlidingWindowLimiter(60_000, 1, () => now)
  assert.equal(limiter.allow("a"), true)
  assert.equal(limiter.allow("a"), false)
  now = 60_001
  assert.equal(limiter.allow("a"), true)
})

test("max 0 berarti tanpa batas", () => {
  const limiter = new SlidingWindowLimiter(60_000, 0)
  for (let i = 0; i < 100; i++) assert.equal(limiter.allow("a"), true)
})

test("inQuietHours: rentang siang", () => {
  const range = { enabled: true, from: "09:00", to: "17:00" }
  assert.equal(inQuietHours(range, new Date(2026, 0, 1, 8, 59)), false)
  assert.equal(inQuietHours(range, new Date(2026, 0, 1, 9, 0)), true)
  assert.equal(inQuietHours(range, new Date(2026, 0, 1, 16, 59)), true)
  assert.equal(inQuietHours(range, new Date(2026, 0, 1, 17, 0)), false)
})

test("inQuietHours: rentang melewati tengah malam", () => {
  const range = { enabled: true, from: "22:00", to: "07:00" }
  assert.equal(inQuietHours(range, new Date(2026, 0, 1, 23, 30)), true)
  assert.equal(inQuietHours(range, new Date(2026, 0, 1, 2, 0)), true)
  assert.equal(inQuietHours(range, new Date(2026, 0, 1, 12, 0)), false)
})

test("inQuietHours: nonaktif atau tidak valid", () => {
  assert.equal(inQuietHours({ enabled: false, from: "00:00", to: "23:59" }), false)
  assert.equal(inQuietHours({ enabled: true, from: "abc", to: "07:00" }), false)
  assert.equal(inQuietHours({ enabled: true, from: "09:00", to: "09:00" }), false)
})
