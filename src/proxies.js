const HOP = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
])

export function encodeUserInfo(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function parseProxyLine(line) {
  const text = String(line ?? "").trim()
  if (!text || text.startsWith("#") || text.startsWith("//")) return null

  if (text.includes("://")) {
    let url
    try {
      url = new URL(text)
    } catch {
      return null
    }
    const port = Number(url.port)
    if (!url.hostname || !Number.isInteger(port)) return null
    return entry(url.hostname, port, decodeURIComponent(url.username), decodeURIComponent(url.password))
  }

  const at = text.lastIndexOf("@")
  if (at > 0 && text.slice(0, at).includes(":")) {
    const credentials = text.slice(0, at)
    const hostport = text.slice(at + 1)
    const split = credentials.indexOf(":")
    const colon = hostport.lastIndexOf(":")
    const port = Number(hostport.slice(colon + 1))
    if (colon <= 0 || !Number.isInteger(port)) return null
    return entry(hostport.slice(0, colon), port, credentials.slice(0, split), credentials.slice(split + 1))
  }

  const parts = text.split(":")
  if (parts.length >= 4) {
    const port = Number(parts[1])
    if (!parts[0] || !Number.isInteger(port)) return null
    return entry(parts[0], port, parts[2], parts.slice(3).join(":"))
  }
  if (parts.length === 2) {
    const port = Number(parts[1])
    if (!parts[0] || !Number.isInteger(port)) return null
    return entry(parts[0], port, "", "")
  }
  return null
}

function entry(host, port, user, pass) {
  return {
    host,
    port,
    user,
    pass,
    id: `${host}:${port}${user ? `#${maskUser(user)}` : ""}`,
  }
}

export function maskUser(user) {
  if (!user) return ""
  if (user.length <= 2) return `${user[0]}***`
  return `${user.slice(0, 2)}***`
}

export function proxyUrl(proxy) {
  const auth = proxy.user ? `${encodeUserInfo(proxy.user)}:${encodeUserInfo(proxy.pass)}@` : ""
  return `http://${auth}${proxy.host}:${proxy.port}`
}

export function loadProxyText(text) {
  const list = []
  const seen = new Set()
  for (const line of String(text).split(/\r?\n/)) {
    const proxy = parseProxyLine(line)
    if (!proxy) continue
    const key = `${proxy.host}:${proxy.port}:${proxy.user}:${proxy.pass}`
    if (seen.has(key)) continue
    seen.add(key)
    list.push(proxy)
  }
  return list
}

export function matchesHost(url, hosts) {
  let hostname
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return hosts.some((host) => {
    const needle = String(host).trim().toLowerCase().replace(/^\*\./, "")
    return needle && (hostname === needle || hostname.endsWith(`.${needle}`))
  })
}

export function errorText(error) {
  const parts = []
  const seen = new Set()
  let current = error
  while (current && !seen.has(current)) {
    seen.add(current)
    const message = current instanceof Error ? current.message : String(current)
    if (message && !parts.includes(message)) parts.push(message)
    if (current.code && !parts.includes(String(current.code))) parts.push(String(current.code))
    current = current.cause
  }
  return parts.join(": ") || "proxy error"
}

export function scrub(message, proxy) {
  let text = String(message)
  for (const secret of [proxy.pass, proxy.user, encodeUserInfo(proxy.pass), encodeUserInfo(proxy.user)]) {
    if (secret) text = text.split(secret).join("***")
  }
  return text
}

export function replayHeaders(request) {
  const headers = new Headers()
  request.headers.forEach((value, name) => {
    if (!HOP.has(name.toLowerCase())) headers.append(name, value)
  })
  return headers
}
