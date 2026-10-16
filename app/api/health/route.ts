export async function GET() {
  // The OpenAI SDK initializes lazily; this endpoint simply confirms the server is set up.
  if (!process.env.GROQ_KEY) {
    return Response.json({ status: 'unavailable' }, { status: 503 })
  }
  return Response.json({ status: 'ready' })
}
