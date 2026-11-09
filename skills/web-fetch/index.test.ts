import { strict as assert } from "node:assert"
import { test } from "node:test"
import { assertPublicHost, isPrivateIp, safeFetch } from "./index.ts"

test("isPrivateIp mengenali seluruh rentang privat/reserved", () => {
  const privateIps = [
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12::1",
    "::ffff:127.0.0.1",
  ]
  for (const ip of privateIps) assert.equal(isPrivateIp(ip), true, `harus privat: ${ip}`)

  const publicIps = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111", "142.250.0.1"]
  for (const ip of publicIps) assert.equal(isPrivateIp(ip), false, `harus publik: ${ip}`)
})

test("assertPublicHost menolak host internal & alamat privat", async () => {
  await assert.rejects(() => assertPublicHost("localhost"))
  await assert.rejects(() => assertPublicHost("router.local"))
  await assert.rejects(() => assertPublicHost("127.0.0.1"))
  await assert.rejects(() => assertPublicHost("evil.example", (async () => [{ address: "10.0.0.5", family: 4 }]) as never))
  await assert.doesNotReject(() =>
    assertPublicHost("example.com", (async () => [{ address: "93.184.216.34", family: 4 }]) as never),
  )
})

test("safeFetch memblokir redirect menuju alamat privat", async () => {
  const fetchImpl = (async (url: string | URL | Request) => {
    const target = String(url)
    if (target.includes("public.example")) {
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } })
    }
    return new Response("ok", { status: 200 })
  }) as unknown as typeof fetch
  const resolver = (async () => [{ address: "93.184.216.34", family: 4 }]) as never

  await assert.rejects(() => safeFetch("http://public.example/x", undefined, fetchImpl, resolver))
})

test("safeFetch mengikuti redirect publik yang sah", async () => {
  const fetchImpl = (async (url: string | URL | Request) => {
    const target = String(url)
    if (target.includes("a.example")) {
      return new Response(null, { status: 302, headers: { location: "http://b.example/page" } })
    }
    return new Response("isi halaman", { status: 200 })
  }) as unknown as typeof fetch
  const resolver = (async () => [{ address: "93.184.216.34", family: 4 }]) as never

  const res = await safeFetch("http://a.example/start", undefined, fetchImpl, resolver)
  assert.equal(res.status, 200)
  assert.equal(await res.text(), "isi halaman")
})
