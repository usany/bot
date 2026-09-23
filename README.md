# OpenCode Chat

A Next.js chat UI backed by an [OpenCode](https://opencode.ai) server.

```
Browser ──▶ Next.js /api/chat, /api/health ──▶ opencode serve (:4096)
```

The browser only talks to the Next.js API routes. OpenCode is reached server-side
(`lib/opencode.ts`), so it never has to be exposed publicly and needs no CORS setup.

## Development

```sh
pnpm install
pnpm dev        # runs `opencode serve --port 4096` and `next dev` together
```

## Production

```sh
pnpm build
pnpm opencode   # keep this running (e.g. under systemd / pm2)
pnpm start
```

Set `OPENCODE_URL` if OpenCode is not at `http://127.0.0.1:4096`.

This needs a long-running host (VPS or container). Serverless platforms can run the
Next.js app but not OpenCode itself. OpenCode can run commands on its machine, so add
authentication to the API routes before exposing this to other people.

## MCP server

`mcp-server/` is a Python ([MCP Python SDK](https://py.sdk.modelcontextprotocol.io/)) package in the
pnpm workspace. OpenCode starts it over stdio from `opencode.json` (as the `project` MCP server), so
its tools are available to the chat agent. Add tools in `mcp-server/src/opencode_mcp/server.py`.

The agent is scoped to recruiting by `recruiting-agent.md` (listed under `instructions` in
`opencode.json`). Current date/time questions are also allowed and answered with the `current_time`
tool. For anything else it calls the `off_topic_reply` tool and returns
"I can only respond to recruiting questions."

```
Browser ──▶ Next.js ──▶ opencode serve ──stdio──▶ mcp-server (uv)
```

```sh
pnpm mcp:test                    # pytest
pnpm --filter opencode-mcp dev   # MCP Inspector
curl localhost:4096/mcp          # {"project":{"status":"connected"}} while `pnpm dev` runs
```
