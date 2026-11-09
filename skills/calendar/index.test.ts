import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildIcs, toIcsDate } from "./index.ts"

test("toIcsDate memformat ISO menjadi UTC dasar", () => {
  assert.equal(toIcsDate("2026-11-10T09:00:00Z"), "20261110T090000Z")
  assert.throws(() => toIcsDate("bukan-tanggal"), /tidak valid/)
})

test("buildIcs menghasilkan VEVENT lengkap", () => {
  const ics = buildIcs(
    { id: "e1", title: "Rapat mingguan", start: "2026-11-10T09:00:00Z", end: "2026-11-10T10:00:00Z", location: "Kantor" },
    new Date("2026-11-09T00:00:00Z"),
  )
  assert.match(ics, /BEGIN:VCALENDAR/)
  assert.match(ics, /BEGIN:VEVENT/)
  assert.match(ics, /UID:e1@ibra-x/)
  assert.match(ics, /DTSTART:20261110T090000Z/)
  assert.match(ics, /DTEND:20261110T100000Z/)
  assert.match(ics, /SUMMARY:Rapat mingguan/)
  assert.match(ics, /LOCATION:Kantor/)
  assert.match(ics, /END:VCALENDAR/)
  assert.ok(ics.endsWith("\r\n"))
})

test("buildIcs meng-escape karakter khusus", () => {
  const ics = buildIcs({ id: "e2", title: "A;B,C", start: "2026-01-01T00:00:00Z" }, new Date("2026-01-01T00:00:00Z"))
  assert.match(ics, /SUMMARY:A\\;B\\,C/)
})
