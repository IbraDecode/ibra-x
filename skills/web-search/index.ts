import { defineSkill, defineTool } from "@ibrax/sdk"

export type SearchProvider = "brave" | "tavily" | "serper"

export interface SearchHit {
  title: string
  url: string
  snippet: string
}

export interface SearchRequest {
  method: "GET" | "POST"
  url: string
  headers: Record<string, string>
  body?: string
}

const PROVIDER_ENV: Array<[SearchProvider, string]> = [
  ["brave", "BRAVE_API_KEY"],
  ["tavily", "TAVILY_API_KEY"],
  ["serper", "SERPER_API_KEY"],
]

/** Memilih penyedia pertama yang kuncinya tersedia. */
export function resolveSearchProvider(env: NodeJS.ProcessEnv = process.env): { provider: SearchProvider; key: string } | undefined {
  for (const [provider, name] of PROVIDER_ENV) {
    const key = env[name]
    if (key) return { provider, key }
  }
  return undefined
}

/** Membangun permintaan HTTP untuk sebuah penyedia (murni, mudah diuji). */
export function describeRequest(provider: SearchProvider, key: string, query: string, count = 5): SearchRequest {
  const n = Math.max(1, Math.min(count, 20))
  switch (provider) {
    case "brave":
      return {
        method: "GET",
        url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${n}`,
        headers: { accept: "application/json", "X-Subscription-Token": key },
      }
    case "tavily":
      return {
        method: "POST",
        url: "https://api.tavily.com/search",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: key, query, max_results: n }),
      }
    case "serper":
      return {
        method: "POST",
        url: "https://google.serper.dev/search",
        headers: { "content-type": "application/json", "X-API-KEY": key },
        body: JSON.stringify({ q: query, num: n }),
      }
  }
}

/** Menormalkan respons penyedia menjadi daftar hasil yang seragam. */
export function parseResults(provider: SearchProvider, json: any): SearchHit[] {
  try {
    if (provider === "brave") {
      return (json?.web?.results ?? []).map((r: any) => ({
        title: String(r.title ?? ""),
        url: String(r.url ?? ""),
        snippet: String(r.description ?? ""),
      }))
    }
    if (provider === "tavily") {
      return (json?.results ?? []).map((r: any) => ({
        title: String(r.title ?? ""),
        url: String(r.url ?? ""),
        snippet: String(r.content ?? ""),
      }))
    }
    return (json?.organic ?? []).map((r: any) => ({
      title: String(r.title ?? ""),
      url: String(r.link ?? ""),
      snippet: String(r.snippet ?? ""),
    }))
  } catch {
    return []
  }
}

export interface SearchOptions {
  fetchImpl?: typeof fetch
  env?: NodeJS.ProcessEnv
}

/** Menjalankan pencarian web memakai penyedia yang terdeteksi. */
export async function webSearch(query: string, count = 5, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const resolved = resolveSearchProvider(opts.env ?? process.env)
  if (!resolved) {
    throw new Error(
      "Tidak ada API key pencarian. Set salah satu: BRAVE_API_KEY, TAVILY_API_KEY, atau SERPER_API_KEY.",
    )
  }
  const req = describeRequest(resolved.provider, resolved.key, query, count)
  const doFetch = opts.fetchImpl ?? fetch
  const res = await doFetch(req.url, { method: req.method, headers: req.headers, body: req.body })
  if (!res.ok) throw new Error(`pencarian gagal (HTTP ${res.status})`)
  return parseResults(resolved.provider, await res.json())
}

/**
 * Skill: pencarian web. Penyedia dipilih otomatis dari API key yang tersedia.
 */
export default defineSkill({
  id: "web-search",
  name: "Web Search",
  description: "Mencari informasi terkini di web.",
  systemPrompt:
    "Gunakan `web_search` untuk informasi terkini atau fakta yang mungkin berubah. " +
    "Sertakan sumber (URL) saat mengutip.",
  tools: [
    defineTool<{ query: string; count?: number }, { results: SearchHit[] }>({
      name: "web_search",
      description: "Cari di web dan kembalikan beberapa hasil (judul, URL, cuplikan).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Kata kunci pencarian." },
          count: { type: "number", description: "Jumlah hasil (default 5, maks 20)." },
        },
        required: ["query"],
      },
      risk: "low",
      async execute(input) {
        return { results: await webSearch(input.query, input.count ?? 5) }
      },
    }),
  ],
})
