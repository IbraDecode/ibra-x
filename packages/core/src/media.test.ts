import { strict as assert } from "node:assert"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createTranscriber } from "./media.ts"

async function tempFile(bytes: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ibrax-media-"))
  const file = join(dir, "audio.ogg")
  await writeFile(file, new Uint8Array(bytes))
  return file
}

test("transkripsi mengirim multipart dan mem-parse hasil", async () => {
  const file = await tempFile(3)
  let captured: { url: string; method?: string; isForm: boolean } | undefined

  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    captured = { url: String(input), method: init?.method, isForm: init?.body instanceof FormData }
    return new Response(JSON.stringify({ text: "halo dunia" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  const transcriber = createTranscriber({
    baseUrl: "https://api.contoh/v1/",
    apiKey: "k",
    model: "whisper-1",
    fetchImpl: fakeFetch,
  })
  const text = await transcriber.transcribe(file, "audio/ogg")

  assert.equal(text, "halo dunia")
  assert.equal(captured?.url, "https://api.contoh/v1/audio/transcriptions")
  assert.equal(captured?.method, "POST")
  assert.equal(captured?.isForm, true)
})

test("batas ukuran audio ditegakkan", async () => {
  const file = await tempFile(100)
  const transcriber = createTranscriber({
    baseUrl: "http://x/v1",
    model: "m",
    maxBytes: 10,
    fetchImpl: (async () => new Response("{}")) as typeof fetch,
  })
  await assert.rejects(() => transcriber.transcribe(file), /melebihi batas/)
})

test("error HTTP dilempar", async () => {
  const file = await tempFile(3)
  const transcriber = createTranscriber({
    baseUrl: "http://x/v1",
    model: "m",
    fetchImpl: (async () => new Response("nope", { status: 401 })) as typeof fetch,
  })
  await assert.rejects(() => transcriber.transcribe(file), /HTTP 401/)
})
