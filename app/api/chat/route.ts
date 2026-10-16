import { openai, CHAT_MODEL } from '@/lib/openai'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequest {
  message?: unknown
  history?: unknown
}

export async function POST(request: Request) {
  const { message, history } = (await request.json().catch(() => ({}))) as ChatRequest

  if (typeof message !== 'string' || !message.trim()) {
    return Response.json({ error: 'Message is required' }, { status: 400 })
  }

  const prior: ChatMessage[] = Array.isArray(history)
    ? history
        .filter(
          (m): m is ChatMessage =>
            !!m &&
            typeof m.role === 'string' &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string',
        )
        .map((m) => ({ role: m.role, content: m.content }))
    : []

  try {
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [...prior, { role: 'user', content: message }],
    })

    const text = completion.choices[0]?.message?.content?.trim() ?? ''

    return Response.json({
      message: text || 'I received your message but could not generate a response.',
    })
  } catch (err) {
    console.error('Chat error:', err)
    return Response.json({ error: 'Failed to process message' }, { status: 500 })
  }
}
