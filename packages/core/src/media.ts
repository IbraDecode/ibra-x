import { readFile } from "node:fs/promises"
import { basename } from "node:path"

export interface Transcriber {
  transcribe(path: string, mime?: string): Promise<string>
}

export interface ImageDescriber {
  describe(path: string, mime?: string): Promise<string>
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

export interface CreateImageDescriberOptions {
  baseUrl: string
  apiKey?: string
  model: string
  prompt?: string
  maxBytes?: number
  maxTokens?: number
  fetchImpl?: typeof fetch
}

const DEFAULT_IMAGE_PROMPT =
  "Jelaskan isi gambar ini secara singkat, faktual, dan netral. Sebutkan teks penting bila ada. " +
  "Jawab dalam bahasa yang sama dengan konteks percakapan (default Bahasa Indonesia)."

/**
 * Deskripsi gambar memakai chat completion multimodal (image_url data base64).
 * Mendukung penyedia OpenAI-compatible yang menerima input gambar.
 */
export function createImageDescriber(opts: CreateImageDescriberOptions): ImageDescriber {
  const doFetch = opts.fetchImpl ?? fetch
  const base = opts.baseUrl.replace(/\/$/, "")

  return {
    async describe(path: string, mime?: string): Promise<string> {
      const buffer = await readFile(path)
      if (opts.maxBytes && buffer.byteLength > opts.maxBytes) {
        throw new Error(`gambar melebihi batas (${buffer.byteLength} > ${opts.maxBytes} byte)`)
      }
      const dataUrl = `data:${mime ?? "image/jpeg"};base64,${buffer.toString("base64")}`
      const body = {
        model: opts.model,
        max_tokens: opts.maxTokens ?? 300,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: opts.prompt ?? DEFAULT_IMAGE_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }

      const headers: Record<string, string> = { "content-type": "application/json" }
      if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`

      const res = await doFetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`deskripsi gambar gagal (HTTP ${res.status})`)
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      return json.choices?.[0]?.message?.content ?? ""
    },
  }
}
