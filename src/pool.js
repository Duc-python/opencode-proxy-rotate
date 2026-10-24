export function createPool() {
  let cursor = 0
  let sticky = null
  const cooldown = new Map()

  function available(list, now) {
    return list.filter((proxy) => (cooldown.get(proxy.id) ?? 0) <= now)
  }

  return {
    snapshot(list, now = Date.now()) {
      const usable = available(list, now)
      return {
        total: list.length,
        ready: usable.length,
        cooling: list.length - usable.length,
        cursor,
        sticky: sticky && (cooldown.get(sticky) ?? 0) <= now ? sticky : null,
      }
    },

    take(list, count, strategy, now = Date.now()) {
      const usable = available(list, now)
      if (usable.length === 0) return []
      const size = Math.min(count, usable.length)
      let start = cursor % usable.length
      if (strategy === "sticky" && sticky) {
        const stickyIndex = usable.findIndex((proxy) => proxy.id === sticky)
        if (stickyIndex >= 0) start = stickyIndex
      }
      const batch = []
      for (let index = 0; index < size; index++) batch.push(usable[(start + index) % usable.length])
      cursor = (start + 1) % usable.length
      return batch
    },

    succeed(proxy, strategy) {
      sticky = strategy === "sticky" ? proxy.id : null
      cooldown.delete(proxy.id)
    },

    cool(proxy, ms, now = Date.now()) {
      if (sticky === proxy.id) sticky = null
      cooldown.set(proxy.id, now + ms)
    },
  }
}
