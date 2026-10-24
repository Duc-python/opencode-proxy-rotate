import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createService } from "./service.js"
import { failover } from "./failover.js"
import { createPool } from "./pool.js"
import { loadProxyText, matchesHost, parseProxyLine, proxyUrl, scrub } from "./proxies.js"
import { normalizeSettings, parseJsonc } from "./settings.js"

test("parse host:port:user:pass and keep colons in the password", () => {
  const proxy = parseProxyLine("edge.example:8080:alice:p:ss!")
  assert.equal(proxy.host, "edge.example")
  assert.equal(proxy.port, 8080)
  assert.equal(proxy.user, "alice")
  assert.equal(proxy.pass, "p:ss!")
  assert.equal(proxyUrl(proxy), "http://alice:p%3Ass%21@edge.example:8080")
  assert.equal(proxy.id.includes("alice"), false)
})

test("parse url form and skip comments", () => {
  const list = loadProxyText("# note\n\nhttp://bob:secret@10.0.0.8:3128\nhost.test:1:bob:secret\n")
  assert.equal(list.length, 2)
  assert.equal(list[0].pass, "secret")
  assert.equal(list[1].host, "host.test")
})

test("settings keep comments and ignore removed check options", () => {
  const settings = normalizeSettings(parseJsonc(`{
    // file
    "checkUrl": "https://opencode.ai/",
    "maxRotations": 2,
  }`))
  assert.equal(settings.maxRotations, 2)
  assert.equal(settings.hosts[0], "opencode.ai")
  assert.equal(settings.checkUrl, undefined)
})

test("a working proxy stays first and a skipped proxy is not retried", () => {
  const pool = createPool()
  const proxies = loadProxyText("a.test:1:u:p\nb.test:1:u:p\nc.test:1:u:p")
  const [first] = pool.take(proxies, 1)
  pool.succeed(first, proxies)
  assert.deepEqual(pool.take(proxies, 2).map((item) => item.host), ["a.test", "b.test"])
  pool.cool(first, 60_000, proxies)
  assert.equal(pool.take(proxies, 1)[0].host, "b.test")
})

test("failover replays a 429 through the next live proxy and leaves other hosts alone", async () => {
  const pool = createPool()
  const proxies = loadProxyText("dead.test:1:u:pw\nlive.test:1:u:pw")
  const calls = []
  const http = {
    async fetch(_url, _request, proxy) {
      calls.push(proxy.host)
      if (proxy.host === "dead.test") throw new Error("connect ECONNREFUSED pw")
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } })
    },
  }
  const settings = {
    ...normalizeSettings({ maxRotations: 2 }),
    proxies,
  }
  const logs = []
  const limited = new Response("rate limit", { status: 429 })
  const request = new Request("https://opencode.ai/zen/v1/responses", { method: "POST", body: "{\"a\":1}" })
  const replaced = await failover(request, limited, settings, pool, http, (line) => logs.push(line))
  assert.equal(replaced.status, 200)
  assert.deepEqual(calls, ["dead.test", "live.test"])
  assert.equal(logs.join("\n").includes("pw"), false)

  const other = new Response("nope", { status: 429 })
  const kept = await failover(
    new Request("https://example.com/v1"),
    other,
    settings,
    pool,
    http,
    () => {},
  )
  assert.equal(kept, other)
  assert.equal(matchesHost("https://api.opencode.ai/zen", ["opencode.ai"]), true)
})

test("a 403 body that names the usage limit rotates too", async () => {
  const pool = createPool()
  const proxies = loadProxyText("ok.test:1:u:pw")
  const http = {
    async fetch() {
      return new Response("served", { status: 200 })
    },
  }
  const settings = { ...normalizeSettings({}), proxies }
  const response = new Response(JSON.stringify({ name: "FreeUsageLimitError" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  })
  const replaced = await failover(
    new Request("https://opencode.ai/zen/v1/chat/completions", { method: "POST", body: "{}" }),
    response,
    settings,
    pool,
    http,
    () => {},
  )
  assert.equal(replaced.status, 200)
})

test("scrub removes proxy credentials", () => {
  const [proxy] = loadProxyText("edge.example:8080:alice:super-secret")
  const text = scrub("tunnel failed for alice:super-secret@edge.example", proxy)
  assert.equal(text.includes("super-secret"), false)
  assert.equal(text.includes("alice"), false)
})

test("proxy-file saves the path and keeps the rest of settings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-rotate-"))
  const settings = path.join(dir, "settings.jsonc")
  fs.writeFileSync(settings, `{
    // keep this comment
    "proxyFile": "C:\\\\old\\\\proxys.txt",
    "checkUrl": "https://opencode.ai/",
  }\n`)
  try {
    const service = createService(dir)
    const report = service.setProxyFile("\"D:\\\\lists\\\\next.txt\"", dir)
    const text = fs.readFileSync(settings, "utf8")
    assert.match(text, /keep this comment/)
    assert.match(text, /https:\/\/opencode\.ai\//)
    assert.match(report, /D:\\lists\\next\.txt/)
    assert.match(report, /file not found/)
    assert.match(service.setProxyFile("", dir), /D:\\lists\\next\.txt/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
