import { opencode } from '@/lib/opencode'

interface ChatRequest {
  message?: unknown
  sessionId?: unknown
}

export async function POST(request: Request) {
  const { message, sessionId } = (await request.json().catch(() => ({}))) as ChatRequest

  if (typeof message !== 'string' || !message.trim()) {
    return Response.json({ error: 'Message is required' }, { status: 400 })
  }

  try {
    let id = typeof sessionId === 'string' && sessionId ? sessionId : null
    if (!id) {
      const { data: session } = await opencode.session.create({
        body: { title: 'Responsive Chatbot' },
        throwOnError: true,
      })
      id = session.id
    }

    const { data } = await opencode.session.prompt({
      path: { id },
      body: { parts: [{ type: 'text', text: message }] },
      throwOnError: true,
    })

    const text = data.parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n')
      .trim()

    return Response.json({
      message: text || 'I received your message but could not generate a response.',
      sessionId: id,
    })
  } catch (err) {
    console.error('Chat error:', err)
    return Response.json({ error: 'Failed to process message' }, { status: 500 })
  }
}
