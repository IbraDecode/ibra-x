import { readFile } from "node:fs/promises"
import { basename } from "node:path"

export interface Transcriber {
  transcribe(path: string, mime?: string): Promise<string>
}

export interface CreateTranscriberOptions {
  baseUrl: string
  apiKey?: string
  model: string
  maxBytes?: number
  /** Untuk pengujian: suntikkan implementasi fetch. */
  fetchImpl?: typeof fetch
}

/**
 * Transkripsi audio memakai endpoint OpenAI-compatible
 * `POST /audio/transcriptions` (multipart). Mendukung OpenAI, Groq, dst.
 */
export function createTranscriber(opts: CreateTranscriberOptions): Transcriber {
  const doFetch = opts.fetchImpl ?? fetch
  const base = opts.baseUrl.replace(/\/$/, "")

  return {
    async transcribe(path: string, mime?: string): Promise<string> {
      const buffer = await readFile(path)
      if (opts.maxBytes && buffer.byteLength > opts.maxBytes) {
        throw new Error(`audio melebihi batas (${buffer.byteLength} > ${opts.maxBytes} byte)`)
      }
      const form = new FormData()
      form.append("file", new Blob([new Uint8Array(buffer)], { type: mime ?? "audio/ogg" }), basename(path))
      form.append("model", opts.model)

      const headers: Record<string, string> = {}
      if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`

      const res = await doFetch(`${base}/audio/transcriptions`, { method: "POST", headers, body: form })
      if (!res.ok) throw new Error(`transkripsi gagal (HTTP ${res.status})`)
      const json = (await res.json()) as { text?: string }
      return json.text ?? ""
    },
  }
}
