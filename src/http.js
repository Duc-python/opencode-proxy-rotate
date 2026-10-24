import { proxyUrl, replayHeaders } from "./proxies.js"

let undiciPromise

function undici() {
  undiciPromise ??= import("undici")
  return undiciPromise
}

export function createHttp() {
  const agents = new Map()

  async function dispatcher(proxy, timeoutMs) {
    const { ProxyAgent } = await undici()
    const key = proxyUrl(proxy)
    let agent = agents.get(key)
    if (!agent) {
      agent = new ProxyAgent({
        uri: key,
        connectTimeout: Math.min(timeoutMs, 15_000),
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      })
      agents.set(key, agent)
    }
    return agent
  }

  return {
    async fetch(url, request, proxy, timeoutMs) {
      const { fetch } = await undici()
      const method = request.method || "GET"
      const hasBody = method !== "GET" && method !== "HEAD"
      const body = hasBody ? await request.clone().arrayBuffer() : undefined
      const signals = [AbortSignal.timeout(timeoutMs)]
      if (request.signal && !request.signal.aborted) signals.push(request.signal)
      return fetch(url, {
        method,
        headers: replayHeaders(request),
        body,
        redirect: "manual",
        signal: AbortSignal.any(signals),
        dispatcher: await dispatcher(proxy, timeoutMs),
      })
    },

    async close() {
      const closing = [...agents.values()].map((agent) => agent.close())
      agents.clear()
      await Promise.allSettled(closing)
    },
  }
}
