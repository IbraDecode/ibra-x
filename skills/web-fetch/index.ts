import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { defineSkill, defineTool } from "@ibrax/sdk"

const MAX_BYTES_DEFAULT = 20_000
const MAX_REDIRECTS = 4

/** Apakah sebuah alamat IP termasuk privat/loopback/link-local (tidak boleh diakses). */
export function isPrivateIp(ip: string): boolean {
  const value = ip.trim().toLowerCase()
  if (value.includes(":")) {
    // IPv6
    if (value === "::1" || value === "::") return true
    if (value.startsWith("fe80") || value.startsWith("fc") || value.startsWith("fd")) return true
    if (value.startsWith("::ffff:")) return isPrivateIp(value.slice("::ffff:".length))
    return false
  }
  const parts = value.split(".").map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // link-local
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a >= 224) return true // multicast / reserved
  return false
}

/**
 * Memastikan host menuju alamat publik. Nama host diresolusi (DNS) dan SEMUA
 * alamat hasilnya diperiksa, sehingga mencegah trik DNS-rebinding/`127.0.0.1.nip.io`.
 */
export async function assertPublicHost(hostname: string, resolver: typeof lookup = lookup): Promise<void> {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home")) {
    throw new Error("Host lokal/internal tidak diizinkan")
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Alamat privat/localhost tidak diizinkan")
    return
  }
  const addresses = await resolver(host, { all: true })
  if (!addresses.length) throw new Error("Host tidak dapat diresolusi")
  for (const entry of addresses) {
    if (isPrivateIp(entry.address)) throw new Error("Host menuju alamat privat (ditolak)")
  }
}

/**
 * Mengambil URL dengan penjagaan SSRF berlapis: setiap hop (termasuk redirect)
 * divalidasi. Redirect TIDAK diikuti secara otomatis oleh fetch.
 */
export async function safeFetch(
  startUrl: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  resolver: typeof lookup = lookup,
): Promise<Response> {
  let current = new URL(startUrl)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new Error("Hanya http/https yang diizinkan")
    }
    await assertPublicHost(current.hostname, resolver)
    const res = await fetchImpl(current, { redirect: "manual", signal })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location")
      if (!location) return res
      current = new URL(location, current)
      continue
    }
    return res
  }
  throw new Error("Terlalu banyak pengalihan")
}

/**
 * Skill contoh: mengambil konten URL sebagai teks, dengan penjagaan SSRF berlapis
 * (validasi host + DNS + setiap redirect) dan batas ukuran.
 */
export default defineSkill({
  id: "web-fetch",
  name: "Web Fetch",
  description: "Mengambil teks dari sebuah URL untuk dirangkum.",
  systemPrompt: "Gunakan `fetch_url` untuk membaca isi halaman web sebelum merangkum atau menjawab.",
  tools: [
    defineTool<{ url: string; maxBytes?: number }, { status: number; contentType: string | null; text: string }>({
      name: "fetch_url",
      description: "Ambil konten sebuah URL (http/https publik). Hasil dipotong sesuai maxBytes.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL lengkap (http/https)." },
          maxBytes: { type: "number", description: "Batas ukuran teks (default 20000)." },
        },
        required: ["url"],
      },
      risk: "medium",
      async execute(input, ctx) {
        const res = await safeFetch(input.url, ctx.signal)
        const text = (await res.text()).slice(0, input.maxBytes ?? MAX_BYTES_DEFAULT)
        return { status: res.status, contentType: res.headers.get("content-type"), text }
      },
    }),
  ],
})
