import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineSkill, defineTool, type SkillStore } from "@ibrax/sdk"

interface CalendarEvent {
  id: string
  title: string
  /** ISO 8601. */
  start: string
  end?: string
  location?: string
  description?: string
}

const KEY = "events"

async function load(store: SkillStore): Promise<CalendarEvent[]> {
  return (await store.get<CalendarEvent[]>(KEY)) ?? []
}

async function save(store: SkillStore, events: CalendarEvent[]): Promise<void> {
  await store.set(KEY, events)
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

/** Format tanggal ICS (UTC dasar): YYYYMMDDTHHMMSSZ. */
export function toIcsDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`tanggal tidak valid: ${iso}`)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n")
}

/** Membangun konten iCalendar (.ics) dari sebuah event (murni, dapat diuji). */
export function buildIcs(event: CalendarEvent, now: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ibra X//ibra-x//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.id}@ibra-x`,
    `DTSTAMP:${toIcsDate(now.toISOString())}`,
    `DTSTART:${toIcsDate(event.start)}`,
  ]
  if (event.end) lines.push(`DTEND:${toIcsDate(event.end)}`)
  lines.push(`SUMMARY:${escapeIcs(event.title)}`)
  if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`)
  if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`)
  lines.push("END:VEVENT", "END:VCALENDAR")
  return `${lines.join("\r\n")}\r\n`
}

/**
 * Skill: kalender. Menyimpan acara dan dapat mengirim undangan `.ics`
 * sebagai dokumen WhatsApp (dapat dibuka di kalender mana pun).
 */
export default defineSkill({
  id: "calendar",
  name: "Kalender",
  description: "Menyimpan acara dan mengirim undangan kalender (.ics).",
  systemPrompt:
    "Gunakan `create_event` untuk menyimpan acara (waktu ISO 8601), `list_events` untuk melihatnya, " +
    "dan `send_invite` untuk mengirim undangan .ics ke sebuah chat.",
  tools: [
    defineTool<{ title: string; start: string; end?: string; location?: string; description?: string }, { id: string; total: number }>({
      name: "create_event",
      description: "Simpan acara kalender.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Judul acara." },
          start: { type: "string", description: "Waktu mulai (ISO 8601)." },
          end: { type: "string", description: "Waktu selesai (ISO 8601, opsional)." },
          location: { type: "string", description: "Lokasi (opsional)." },
          description: { type: "string", description: "Keterangan (opsional)." },
        },
        required: ["title", "start"],
      },
      risk: "low",
      async execute(input, ctx) {
        const events = await load(ctx.store)
        const event: CalendarEvent = {
          id: randomUUID(),
          title: input.title,
          start: input.start,
          end: input.end,
          location: input.location,
          description: input.description,
        }
        // Validasi tanggal lebih awal agar tidak gagal saat pengiriman.
        toIcsDate(event.start)
        if (event.end) toIcsDate(event.end)
        events.push(event)
        await save(ctx.store, events)
        return { id: event.id, total: events.length }
      },
    }),
    defineTool<Record<string, never>, { events: CalendarEvent[] }>({
      name: "list_events",
      description: "Tampilkan acara kalender.",
      parameters: { type: "object", properties: {} },
      risk: "low",
      async execute(_input, ctx) {
        return { events: await load(ctx.store) }
      },
    }),
    defineTool<{ id: string; chatId?: string }, { ok: true; file: string }>({
      name: "send_invite",
      description: "Kirim undangan .ics acara ke sebuah chat.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "id acara." },
          chatId: { type: "string", description: "JID tujuan (opsional; default chat saat ini)." },
        },
        required: ["id"],
      },
      risk: "medium",
      async execute(input, ctx) {
        const events = await load(ctx.store)
        const event = events.find((e) => e.id === input.id)
        if (!event) throw new Error("acara tidak ditemukan")
        const chatId = input.chatId ?? ctx.chatId
        if (!chatId) throw new Error("chatId tidak diketahui")
        const path = join(tmpdir(), `ibra-${event.id}.ics`)
        await writeFile(path, buildIcs(event), "utf8")
        await ctx.runtime.sendMessage(
          chatId,
          { mediaPath: path, mime: "text/calendar", caption: `📅 ${event.title}` },
          { accountId: ctx.accountId },
        )
        return { ok: true as const, file: path }
      },
    }),
  ],
})
