import 'server-only'
import { createOpencodeClient } from '@opencode-ai/sdk/client'

// Only the Next.js server talks to OpenCode; the browser never sees this URL.
export const opencode = createOpencodeClient({
  baseUrl: process.env.OPENCODE_URL ?? 'http://127.0.0.1:4096',
})
