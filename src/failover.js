import { errorText, matchesHost, scrub } from "./proxies.js"

export async function isRateLimited(response, settings) {
  if (settings.statuses.includes(response.status)) return true
  if (!settings.peekStatuses.includes(response.status)) return false
  const type = response.headers.get("content-type") ?? ""
  if (type.includes("event-stream")) return false
  const length = Number(response.headers.get("content-length"))
  if (Number.isFinite(length) && length > 1_000_000) return false
  const text = (await peek(response)).toLowerCase()
  return settings.errorBodies.some((pattern) => text.includes(pattern))
}

async function peek(response) {
  if (!response.body) return ""
  const reader = response.clone().body.getReader()
  const chunks = []
  let total = 0
  try {
    while (total < 4096) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return new TextDecoder().decode(concat(chunks))
}

function concat(chunks) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export async function failover(request, response, settings, pool, http, log) {
  if (!settings.enabled) return response
  if (!matchesHost(request.url, settings.hosts)) return response
  if (!(await isRateLimited(response, settings))) return response

  const batch = pool.take(settings.proxies, settings.maxRotations)
  if (batch.length === 0) {
    log(`rate limit ${response.status} ${hostOf(request.url)} and no proxy is ready`)
    return response
  }

  log(`rate limit ${response.status} ${hostOf(request.url)} — rotating ${batch.length} proxies, starting at ${batch[0].id}`)
  let last = response
  for (const proxy of batch) {
    const started = Date.now()
    try {
      const replayed = await http.fetch(request.url, request, proxy, settings.timeoutMs)
      if (replayed.status === 407) {
        pool.cool(proxy, settings.deadCooldownMs, settings.proxies)
        log(`DEAD ${proxy.id} HTTP 407`)
        continue
      }
      if (await isRateLimited(replayed, settings)) {
        pool.cool(proxy, settings.limitCooldownMs, settings.proxies)
        log(`LIMIT ${proxy.id} HTTP ${replayed.status} ${Date.now() - started}ms`)
        last = replayed
        continue
      }
      pool.succeed(proxy, settings.proxies)
      log(`OK ${proxy.id} HTTP ${replayed.status} ${Date.now() - started}ms`)
      return replayed
    } catch (error) {
      pool.cool(proxy, settings.deadCooldownMs, settings.proxies)
      log(`DEAD ${proxy.id} ${scrub(errorText(error), proxy)}`)
    }
  }
  return last
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
