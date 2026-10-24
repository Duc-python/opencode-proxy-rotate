import fs from "node:fs"

export function createPool(file) {
  let cursor = 0
  let sticky = null
  const cooldown = new Map()
  restore(file, (state) => {
    cursor = state.cursor
    sticky = state.sticky
    for (const [id, until] of Object.entries(state.cooldown)) cooldown.set(id, until)
  })

  function ready(list, now) {
    return list.filter((proxy) => (cooldown.get(proxy.id) ?? 0) <= now)
  }

  function remember(proxy, list) {
    const index = list.findIndex((item) => item.id === proxy.id)
    if (index >= 0) cursor = (index + 1) % list.length
    persist(file, cursor, sticky, cooldown)
  }

  return {
    snapshot(list, now = Date.now()) {
      const usable = ready(list, now)
      const active = usable.find((proxy) => proxy.id === sticky)
      return {
        total: list.length,
        ready: usable.length,
        cooling: list.length - usable.length,
        sticky: active ? active.id : null,
      }
    },

    take(list, count, now = Date.now()) {
      if (list.length === 0 || count <= 0) return []
      const batch = []
      const seen = new Set()
      const active = list.find((proxy) => proxy.id === sticky && (cooldown.get(proxy.id) ?? 0) <= now)
      if (active) {
        batch.push(active)
        seen.add(active.id)
      }
      for (let step = 0; step < list.length && batch.length < count; step++) {
        const proxy = list[(cursor + step) % list.length]
        if (seen.has(proxy.id) || (cooldown.get(proxy.id) ?? 0) > now) continue
        batch.push(proxy)
        seen.add(proxy.id)
      }
      return batch
    },

    succeed(proxy, list) {
      sticky = proxy.id
      cooldown.delete(proxy.id)
      remember(proxy, list)
    },

    cool(proxy, ms, list, now = Date.now()) {
      if (sticky === proxy.id) sticky = null
      cooldown.set(proxy.id, now + ms)
      remember(proxy, list)
    },
  }
}

function restore(file, apply) {
  if (!file) return
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"))
    const cooldown = data.cooldown && typeof data.cooldown === "object" ? data.cooldown : {}
    const now = Date.now()
    const fresh = {}
    for (const [id, until] of Object.entries(cooldown)) {
      if (Number(until) > now) fresh[id] = Number(until)
    }
    apply({
      cursor: Number.isInteger(data.cursor) && data.cursor >= 0 ? data.cursor : 0,
      sticky: typeof data.sticky === "string" ? data.sticky : null,
      cooldown: fresh,
    })
  } catch {
    // A missing or broken health file starts a fresh rotation.
  }
}

function persist(file, cursor, sticky, cooldown) {
  if (!file) return
  const live = {}
  const now = Date.now()
  for (const [id, until] of cooldown) {
    if (until > now) live[id] = until
  }
  try {
    fs.writeFileSync(file, JSON.stringify({ cursor, sticky, cooldown: live }))
  } catch {
    // Rotation continues in memory when the health file cannot be written.
  }
}
