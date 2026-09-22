import { opencode } from '@/lib/opencode'

export async function GET() {
  try {
    await opencode.config.get({ throwOnError: true })
    return Response.json({ status: 'ready' })
  } catch (err) {
    // Expected while OpenCode is still starting, so log one line instead of a stack trace.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : String(err)
    console.warn(`OpenCode not reachable: ${cause}`)
    return Response.json({ status: 'unavailable' }, { status: 503 })
  }
}
