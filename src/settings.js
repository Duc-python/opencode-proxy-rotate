import fs from "node:fs"
import path from "node:path"

export const DEFAULTS = {
  enabled: true,
  proxyFile: "C:\\Users\\ducar\\Downloads\\proxys.txt",
  proxies: [],
  hosts: ["opencode.ai"],
  statuses: [429],
  peekStatuses: [400, 402, 403],
  errorBodies: ["rate limit", "freeusagelimiterror", "too many requests", "usage limit"],
  strategy: "rotate",
  maxRotations: 5,
  timeoutMs: 60_000,
  deadCooldownMs: 180_000,
  limitCooldownMs: 30_000,
  checkUrl: "https://opencode.ai/",
  checkTimeoutMs: 8_000,
  checkConcurrency: 10,
  forceHttp: true,
  log: true,
}

export function parseJsonc(text) {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1")
  return JSON.parse(stripped)
}

function asNumber(value, fallback, min) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, number)
}

function asStringList(value, fallback) {
  if (!Array.isArray(value)) return fallback
  const items = value.map((item) => String(item).trim()).filter(Boolean)
  return items.length > 0 ? items : fallback
}

export function normalizeSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {}
  const strategy = input.strategy === "sticky" ? "sticky" : "rotate"
  return {
    enabled: input.enabled !== false,
    proxyFile: typeof input.proxyFile === "string" && input.proxyFile.trim() ? input.proxyFile.trim() : DEFAULTS.proxyFile,
    proxies: Array.isArray(input.proxies) ? input.proxies.map((item) => String(item)) : [],
    hosts: asStringList(input.hosts, DEFAULTS.hosts),
    statuses: asNumberList(input.statuses, DEFAULTS.statuses),
    peekStatuses: asNumberList(input.peekStatuses, DEFAULTS.peekStatuses),
    errorBodies: asStringList(input.errorBodies, DEFAULTS.errorBodies).map((item) => item.toLowerCase()),
    strategy,
    maxRotations: asNumber(input.maxRotations, DEFAULTS.maxRotations, 1),
    timeoutMs: asNumber(input.timeoutMs, DEFAULTS.timeoutMs, 1000),
    deadCooldownMs: asNumber(input.deadCooldownMs, DEFAULTS.deadCooldownMs, 0),
    limitCooldownMs: asNumber(input.limitCooldownMs, DEFAULTS.limitCooldownMs, 0),
    checkUrl: typeof input.checkUrl === "string" && input.checkUrl.trim() ? input.checkUrl.trim() : DEFAULTS.checkUrl,
    checkTimeoutMs: asNumber(input.checkTimeoutMs, DEFAULTS.checkTimeoutMs, 500),
    checkConcurrency: asNumber(input.checkConcurrency, DEFAULTS.checkConcurrency, 1),
    forceHttp: input.forceHttp !== false,
    log: input.log !== false,
  }
}

function asNumberList(value, fallback) {
  if (!Array.isArray(value)) return fallback
  const items = value.map((item) => Number(item)).filter((item) => Number.isInteger(item))
  return items.length > 0 ? items : fallback
}

export function settingsPath(root, options) {
  const custom = options && typeof options.settingsFile === "string" ? options.settingsFile.trim() : ""
  return custom || path.join(root, "settings.jsonc")
}

export function readSettings(file, options) {
  let parsed = {}
  if (fs.existsSync(file)) parsed = parseJsonc(fs.readFileSync(file, "utf8"))
  const overlay = options && typeof options === "object" ? { ...options } : {}
  delete overlay.settingsFile
  return normalizeSettings({ ...parsed, ...overlay })
}

export function writeProxyFileSetting(file, proxyFile) {
  const literal = JSON.stringify(path.normalize(proxyFile))
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  const pattern = /("proxyFile"\s*:\s*)"(?:\\.|[^"\\])*"/
  if (pattern.test(text)) {
    text = text.replace(pattern, `$1${literal}`)
  } else if (text.trim()) {
    text = text.replace(/\}\s*$/, `  "proxyFile": ${literal},\n}\n`)
  } else {
    text = `{\n  "proxyFile": ${literal}\n}\n`
  }
  fs.writeFileSync(file, text)
  return JSON.parse(literal)
}

export function watchKey(file) {
  try {
    const stat = fs.statSync(file)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return "missing"
  }
}
