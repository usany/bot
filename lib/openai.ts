import 'server-only'
import OpenAI from 'openai'

// Only the Next.js server talks to Groq; the browser never sees this key.
export const openai = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_KEY,
})

export const CHAT_MODEL = process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b'
