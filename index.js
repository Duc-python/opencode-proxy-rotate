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
    service.log(`loaded ${settings.proxies.length} proxies`)

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
        description: "Inspect proxy rotation for opencode.ai",
      })
      editor.add({
        name: "status",
        description: "Show which proxy is active, how many are skipped, and the settings file path.",
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
