import { openai, CHAT_MODEL } from '@/lib/openai'

interface ChatRequest {
  message?: unknown
  sessionId?: unknown
}

export async function POST(request: Request) {
  const { message } = (await request.json().catch(() => ({}))) as ChatRequest

  if (typeof message !== 'string' || !message.trim()) {
    return Response.json({ error: 'Message is required' }, { status: 400 })
  }

  try {
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{ role: 'user', content: message }],
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
