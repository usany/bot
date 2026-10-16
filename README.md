# Chat Assistant

A Next.js chat UI backed by Groq (via the OpenAI SDK).

```
Browser ──▶ Next.js /api/chat, /api/health ──▶ Groq
```

The browser only talks to the Next.js API routes. The model is reached server-side
(`lib/openai.ts`), so the API key never reaches the browser.

## Development

```sh
pnpm install
pnpm dev        # runs `next dev`
```

## Production

```sh
pnpm build
pnpm start
```

Set `GROQ_KEY` (and optionally `GROQ_MODEL`) in `.env`.

## Study recommendations

When the user asks what to study (e.g. "what should I study?", "recommend a major"), the
chat exposes a `recommend_study` function to the model. It matches the user's interest
against `colleges.json` (departments and their credit requirements) via
`lib/colleges.ts`. The model decides whether to call it, then turns the result into a
natural-language recommendation.
