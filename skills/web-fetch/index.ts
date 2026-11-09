import { defineSkill, defineTool } from "@ibrax/sdk"

const MAX_BYTES_DEFAULT = 20_000

/** Menolak alamat privat/localhost untuk mencegah SSRF sederhana. */
function assertPublicUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Hanya http/https yang diizinkan")
  }
  const host = url.hostname.toLowerCase()
  const isPrivate =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  if (isPrivate) throw new Error("Alamat privat/localhost tidak diizinkan")
  return url
}

/**
 * Skill contoh: mengambil konten URL sebagai teks. Menunjukkan penerapan
 * batas ukuran dan penjagaan SSRF pada tool jaringan (risiko medium).
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
        const url = assertPublicUrl(input.url)
        const res = await fetch(url, { signal: ctx.signal, redirect: "follow" })
        const text = (await res.text()).slice(0, input.maxBytes ?? MAX_BYTES_DEFAULT)
        return { status: res.status, contentType: res.headers.get("content-type"), text }
      },
    }),
  ],
})
