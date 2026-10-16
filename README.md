# Chat Assistant

A Next.js chat UI backed by Groq (via the OpenAI SDK), with degree
recommendations served by a separate Python MCP server.

```
Browser ──▶ Next.js /api/chat ──▶ Groq
                         │
                         └──▶ MCP client ──▶ Python MCP server (recommend_study)
                                                  └──▶ colleges.json
```

The browser only talks to the Next.js API routes. The model is reached
server-side (`lib/openai.ts`), so the API key never reaches the browser.
Degree recommendations are exposed as an MCP **tool** (not OpenAI
function-calling): the Next.js server is an MCP *client* that calls the Python
server over Streamable HTTP.

## Development

```sh
pnpm install
```

Start the MCP server (uses `uv`, no venv, no requirements.txt — dependencies
are declared inline in `mcp/server.py`):

```sh
uv run mcp/server.py      # serves http://127.0.0.1:3001/mcp
```

Start the app:

```sh
pnpm dev                  # runs `next dev`
```

## Production

```sh
uv run mcp/server.py
pnpm build
pnpm start
```

Set `GROQ_KEY` (and optionally `GROQ_MODEL`), plus `MCP_SERVER_URL`, in `.env`.

## Study recommendations

When the user asks what to study (e.g. "what should I study?", "recommend a
major"), the chat calls the `recommend_study` MCP tool (`mcp/server.py`), which
matches the user's interest against `colleges.json` and returns ranked
departments with their credit requirements. The Next.js server feeds that
result to the model as system context so it can answer in natural language.
