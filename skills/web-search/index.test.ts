import { strict as assert } from "node:assert"
import { test } from "node:test"
import { describeRequest, parseResults, resolveSearchProvider, webSearch } from "./index.ts"

test("resolveSearchProvider memilih penyedia sesuai urutan prioritas", () => {
  assert.equal(resolveSearchProvider({}), undefined)
  assert.equal(resolveSearchProvider({ SERPER_API_KEY: "s" })?.provider, "serper")
  assert.equal(resolveSearchProvider({ TAVILY_API_KEY: "t" })?.provider, "tavily")
  assert.equal(resolveSearchProvider({ BRAVE_API_KEY: "b", TAVILY_API_KEY: "t" })?.provider, "brave")
})

test("describeRequest membangun permintaan per penyedia", () => {
  const brave = describeRequest("brave", "k", "cuaca jakarta", 3)
  assert.equal(brave.method, "GET")
  assert.match(brave.url, /q=cuaca%20jakarta/)
  assert.match(brave.url, /count=3/)
  assert.equal(brave.headers["X-Subscription-Token"], "k")

  const tavily = describeRequest("tavily", "k", "x", 2)
  assert.equal(tavily.method, "POST")
  assert.equal(JSON.parse(tavily.body!).api_key, "k")

  const serper = describeRequest("serper", "k", "x", 2)
  assert.equal(serper.headers["X-API-KEY"], "k")
  assert.equal(JSON.parse(serper.body!).q, "x")
})

test("describeRequest membatasi jumlah hasil", () => {
  assert.match(describeRequest("brave", "k", "x", 999).url, /count=20/)
  assert.match(describeRequest("brave", "k", "x", 0).url, /count=1/)
})

test("parseResults menormalkan tiap penyedia", () => {
  assert.deepEqual(parseResults("brave", { web: { results: [{ title: "T", url: "u", description: "d" }] } }), [
    { title: "T", url: "u", snippet: "d" },
  ])
  assert.deepEqual(parseResults("tavily", { results: [{ title: "T", url: "u", content: "c" }] }), [
    { title: "T", url: "u", snippet: "c" },
  ])
  assert.deepEqual(parseResults("serper", { organic: [{ title: "T", link: "u", snippet: "s" }] }), [
    { title: "T", url: "u", snippet: "s" },
  ])
})

test("webSearch memakai fetch dan menyelesaikan hasil", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ web: { results: [{ title: "A", url: "https://a", description: "aa" }] } }), {
      status: 200,
    })) as typeof fetch

  const hits = await webSearch("apa pun", 5, { fetchImpl: fakeFetch, env: { BRAVE_API_KEY: "b" } })
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.url, "https://a")
})

test("webSearch melempar bila tidak ada kunci", async () => {
  await assert.rejects(() => webSearch("x", 5, { env: {} }), /Tidak ada API key/)
})
