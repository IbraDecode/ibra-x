import { strict as assert } from "node:assert"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createImageDescriber, createSpeaker, createTranscriber } from "./media.ts"

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

test("deskripsi gambar mengirim data URL base64", async () => {
  const file = await tempFile(4)
  let body: any
  const fakeFetch = (async (_input: string | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: "sebuah kucing oranye" } }] }), {
      status: 200,
    })
  }) as typeof fetch

  const describer = createImageDescriber({
    baseUrl: "https://api.contoh/v1",
    apiKey: "k",
    model: "gpt-4o-mini",
    fetchImpl: fakeFetch,
  })
  const text = await describer.describe(file, "image/png")

  assert.equal(text, "sebuah kucing oranye")
  assert.equal(body.model, "gpt-4o-mini")
  assert.match(body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/)
})

test("batas ukuran gambar ditegakkan", async () => {
  const file = await tempFile(100)
  const describer = createImageDescriber({
    baseUrl: "http://x/v1",
    model: "m",
    maxBytes: 10,
    fetchImpl: (async () => new Response("{}")) as typeof fetch,
  })
  await assert.rejects(() => describer.describe(file), /melebihi batas/)
})

test("sintesis suara mengirim permintaan dan mengembalikan buffer", async () => {
  let body: any
  const fakeFetch = (async (_input: string | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body))
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
  }) as typeof fetch

  const speaker = createSpeaker({
    baseUrl: "https://api.contoh/v1/",
    apiKey: "k",
    model: "tts-1",
    voice: "nova",
    fetchImpl: fakeFetch,
  })
  const buffer = await speaker.synthesize("halo dunia")

  assert.equal(buffer.length, 4)
  assert.equal(body.voice, "nova")
  assert.equal(body.input, "halo dunia")
  assert.equal(body.model, "tts-1")
})
