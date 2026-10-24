import path from "node:path"
import { fileURLToPath } from "node:url"
import { createService } from "./src/service.js"

const root = path.dirname(fileURLToPath(import.meta.url))
const service = createService(root)

const plugin = {
  id: "proxy-rotate",
  async setup(ctx) {
    service.setOptions(ctx.options)
    const settings = service.current()
    service.log(`loaded ${settings.proxies.length} proxies, strategy ${settings.strategy}`)

    if (settings.forceHttp) {
      try {
        await ctx.provider.transform((editor) => {
          for (const record of editor.list()) {
            const id = record.provider.id
            const blob = JSON.stringify(record.provider.settings ?? {})
            if (String(id) === "opencode" || blob.includes("opencode.ai")) {
              editor.update(id, (provider) => {
                provider.settings = { ...(provider.settings ?? {}), transport: "http" }
              })
            }
          }
        })
      } catch (error) {
        service.log(`forceHttp skipped: ${error instanceof Error ? error.message : error}`)
      }
    }

    await ctx.session.hook("http.response", async (event) => {
      try {
        const next = await service.failover(event.request, event.response)
        if (next !== event.response) event.response = next
      } catch (error) {
        service.log(`failover failed: ${error instanceof Error ? error.message : error}`)
      }
    })

    await ctx.command.transform((editor) => {
      editor.add({
        name: "proxy-check",
        description: "Check which proxies are live. Example: /proxy-check 10",
        execute: async ({ sessionID, prompt }) => {
          const limit = Number(String(prompt?.text ?? "").trim())
          const report = await service.check({ limit: Number.isFinite(limit) && limit > 0 ? limit : 0 })
          await ctx.session.synthetic({ sessionID, text: report })
        },
      })
      editor.add({
        name: "proxy-status",
        description: "Show the rotation state and the proxy file in use",
        execute: async ({ sessionID }) => {
          await ctx.session.synthetic({ sessionID, text: service.status() })
        },
      })
      editor.add({
        name: "proxy-file",
        description: "Show or change the proxy list file. Example: /proxy-file C:\\Users\\me\\proxys.txt",
        execute: async ({ sessionID, prompt }) => {
          const report = service.setProxyFile(prompt?.text ?? "", ctx.location.directory)
          await ctx.session.synthetic({ sessionID, text: report })
        },
      })
    })

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "proxy",
        description: "Check proxies and inspect rotation for opencode.ai",
      })
      editor.add({
        name: "check",
        description: "Check whether listed proxies can open an HTTPS connection to opencode.ai. Does not return passwords.",
        input: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Check only the first N proxies. Omit to check the full list." },
            timeoutMs: { type: "number" },
            url: { type: "string" },
          },
          additionalProperties: false,
        },
        options: { namespace: "proxy" },
        execute: async (input, context) => {
          const report = await service.check(input ?? {}, async (done, total) => {
            await context.progress({ status: `checking ${done}/${total}` })
          })
          return { content: report }
        },
      })
      editor.add({
        name: "status",
        description: "Show the rotation strategy, how many proxies are ready, and the settings file path.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: "proxy" },
        execute: async () => ({ content: service.status() }),
      })
      editor.add({
        name: "file",
        description: "Show or change the proxy list file path. The new path is saved in settings and used on the next request.",
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "New proxy list file. Omit to show the current path." },
          },
          additionalProperties: false,
        },
        options: { namespace: "proxy" },
        execute: async (input) => ({
          content: service.setProxyFile(input?.path ?? "", ctx.location.directory),
        }),
      })
    })

    return () => service.close()
  },
}

export default plugin

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli && process.argv.includes("--check")) {
  const limitFlag = process.argv.indexOf("--limit")
  const limit = limitFlag >= 0 ? Number(process.argv[limitFlag + 1]) : 0
  const report = await service.check({ limit })
  console.log(report)
  await service.close()
}
