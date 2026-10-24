import fs from "node:fs"
import path from "node:path"
import { checkProxies, formatReport } from "./check.js"
import { failover } from "./failover.js"
import { createHttp } from "./http.js"
import { createPool } from "./pool.js"
import { loadProxyText } from "./proxies.js"
import { readSettings, settingsPath, watchKey, writeProxyFileSetting } from "./settings.js"

export function createService(root) {
  const pool = createPool()
  const http = createHttp()
  let options = {}
  let cache = null
  const logFile = path.join(root, "proxy-rotate.log")
  const reportFile = path.join(root, "proxy-check-report.json")

  function log(message) {
    const line = `${new Date().toISOString()} ${message}`
    if (cache?.settings.log !== false) {
      try {
        fs.appendFileSync(logFile, `${line}\n`)
      } catch {
        // The plugin still works when the log file is locked.
      }
    }
    console.info(`[proxy-rotate] ${message}`)
  }

  function current() {
    const file = settingsPath(root, options)
    const settingsKey = watchKey(file)
    const previousFile = cache?.settings.proxyFile
    if (cache && cache.settingsKey === settingsKey && cache.proxyKey === watchKey(previousFile)) {
      return cache.settings
    }

    const settings = readSettings(file, options)
    const chunks = [...settings.proxies]
    if (settings.proxyFile && fs.existsSync(settings.proxyFile)) {
      chunks.push(fs.readFileSync(settings.proxyFile, "utf8"))
    } else if (settings.proxyFile) {
      log(`proxy file not found: ${settings.proxyFile}`)
    }
    const resolved = { ...settings, proxies: loadProxyText(chunks.join("\n")) }
    cache = { settings: resolved, settingsKey, proxyKey: watchKey(settings.proxyFile) }
    return resolved
  }

  async function probe(url, proxy, timeoutMs) {
    return http.fetch(url, new Request(url, { method: "GET" }), proxy, timeoutMs)
  }

  return {
    log,

    setOptions(next) {
      options = next && typeof next === "object" ? next : {}
      cache = null
    },

    current,

    async failover(request, response) {
      const settings = current()
      return failover(request, response, settings, pool, http, settings.log ? log : () => {})
    },

    async check(extra = {}, onProgress) {
      const settings = current()
      if (settings.proxies.length === 0) {
        return `No proxies loaded. Set proxyFile or the proxies list in ${settingsPath(root, options)}`
      }
      const url = extra.url || settings.checkUrl
      const results = await checkProxies(settings.proxies, {
        url,
        timeoutMs: extra.timeoutMs || settings.checkTimeoutMs,
        concurrency: settings.checkConcurrency,
        limit: Number(extra.limit) || 0,
        fetch: probe,
        onProgress,
      })
      const report = formatReport(results, url)
      const safe = results.map(({ id, ok, status, ms, error }) => ({ id, ok, status, ms, error }))
      try {
        fs.writeFileSync(reportFile, JSON.stringify({ at: new Date().toISOString(), url, results: safe }, null, 2))
      } catch {
        // The report is still returned to the session when the file cannot be written.
      }
      return report
    },

    status() {
      const settings = current()
      const snap = pool.snapshot(settings.proxies)
      return [
        `enabled: ${settings.enabled}`,
        `strategy: ${settings.strategy}`,
        `proxies: ${snap.total} (${snap.ready} ready, ${snap.cooling} cooling down)`,
        `cursor: ${snap.cursor}`,
        `sticky: ${snap.sticky ?? "none"}`,
        `file: ${settings.proxyFile}`,
        `hosts: ${settings.hosts.join(", ")}`,
        `maxRotations: ${settings.maxRotations}`,
        `settings: ${settingsPath(root, options)}`,
      ].join("\n")
    },

    setProxyFile(raw, baseDir) {
      const trimmed = String(raw ?? "").trim().replace(/^["']|["']$/g, "")
      const file = settingsPath(root, options)
      if (!trimmed) {
        const settings = current()
        return `proxy file: ${settings.proxyFile}\nsettings: ${file}`
      }
      const target = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(baseDir || root, trimmed)
      if (typeof options.proxyFile === "string") {
        options = { ...options }
        delete options.proxyFile
      }
      writeProxyFileSetting(file, target)
      cache = null
      const settings = current()
      const found = fs.existsSync(target)
      return [
        `proxy file: ${settings.proxyFile}`,
        found ? `loaded ${settings.proxies.length} proxies` : `file not found: ${target}`,
        `settings: ${file}`,
      ].join("\n")
    },

    close() {
      return http.close()
    },
  }
}
