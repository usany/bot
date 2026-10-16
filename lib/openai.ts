import 'server-only'
import OpenAI from 'openai'

// Only the Next.js server talks to OpenAI (via OpenRouter); the browser never sees this key.
export const openai = new OpenAI({
  baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
})

export const CHAT_MODEL = process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free'
