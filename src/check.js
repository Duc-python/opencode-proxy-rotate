import { errorText, scrub } from "./proxies.js"

export async function checkProxies(proxies, options) {
  const list = options.limit > 0 ? proxies.slice(0, options.limit) : proxies
  const results = new Array(list.length)
  let cursor = 0

  async function worker() {
    while (cursor < list.length) {
      const index = cursor++
      const proxy = list[index]
      const started = Date.now()
      try {
        const response = await options.fetch(options.url, proxy, options.timeoutMs)
        const status = response.status
        await response.body?.cancel().catch(() => {})
        results[index] = {
          id: proxy.id,
          ok: status !== 407,
          status,
          ms: Date.now() - started,
          error: status === 407 ? "proxy rejected the login" : "",
        }
      } catch (error) {
        results[index] = {
          id: proxy.id,
          ok: false,
          status: 0,
          ms: Date.now() - started,
          error: scrub(errorText(error), proxy),
        }
      }
      if (options.onProgress) await options.onProgress(index + 1, list.length)
    }
  }

  const workers = Math.min(options.concurrency, Math.max(list.length, 1))
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

export function formatReport(results, url) {
  const live = results.filter((item) => item.ok).length
  const lines = [`Proxy live ${live}/${results.length} via ${url}`]
  for (const item of results) {
    const mark = item.ok ? "OK  " : "DEAD"
    const status = item.status ? `HTTP ${item.status}` : "----"
    const detail = item.error ? `  ${item.error}` : ""
    lines.push(`${mark}  ${String(item.ms).padStart(5, " ")}ms  ${status.padEnd(9, " ")}  ${item.id}${detail}`)
  }
  return lines.join("\n")
}
