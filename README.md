# proxy-rotate

OpenCode 2.1.4 plugin. When the `opencode.ai` API is rate limited, that request is sent again through the next proxy in the list. A dead proxy is skipped until its cooldown ends.

## Settings

Edit `D:\PluginOCProxys\settings.jsonc`.

- `proxyFile`: proxy list file. The default is `C:\Users\ducar\Downloads\proxys.txt`
- `proxies`: extra lines in the same `host:port:user:pass` format
- `strategy`: `rotate` (default, each limit uses the next proxy) or `sticky` (keep a working proxy)
- `maxRotations`: how many proxies to try for one request
- `hosts`, `statuses`, `timeoutMs`, `checkUrl`, `checkConcurrency`

The next request picks up a saved change. `forceHttp` is the exception and needs an OpenCode restart.

## Commands

The plugin loads from `%USERPROFILE%\.config\opencode\plugins\proxy-rotate.js`.

- `/proxy-check` checks the whole list
- `/proxy-check 10` checks the first 10 proxies
- `/proxy-status` shows the count, cursor, and current file
- `/proxy-file` shows the current proxy file
- `/proxy-file C:\path\proxys.txt` saves a new proxy file and reloads it

The agent tools are `proxy_check`, `proxy_status`, and `proxy_file`. Reports show host, port, a masked username, and the HTTP status. Passwords are not written to the log or the report.

A proxy is live when it opens HTTPS to `checkUrl` and does not return 407. An HTTP 429 from opencode.ai still counts as a live proxy.

## Check from the shell

```powershell
node index.js --check --limit 10
```

The full report is written to `proxy-check-report.json`.

## License

MIT. See [LICENSE](LICENSE).
