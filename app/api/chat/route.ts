import { openai, CHAT_MODEL } from '@/lib/openai'
import { recommendStudy } from '@/lib/mcp'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
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
            (m.role === 'user' || m.role === 'assistant' || m.role === 'system') &&
            typeof m.content === 'string',
        )
        .map((m) => ({ role: m.role, content: m.content }))
    : []

  // Let the model decide whether the user wants a degree/major recommendation,
  // instead of matching keywords that inevitably miss cases.
  let context = ''
  try {
    const classification = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Answer with exactly one JSON object: {"wantsRecommendation": boolean}. ' +
            'True only when the user is asking what to study, for a degree/major/department ' +
            'recommendation, or which subject matches their interest.',
        },
        { role: 'user', content: message },
      ],
      response_format: { type: 'json_object' },
    })
    const raw = classification.choices[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw)
    if (parsed.wantsRecommendation === true) {
      context = await recommendStudy({ interest: message })
    }
  } catch (err) {
    console.error('MCP recommendation failed:', err)
  }

  const systemPrompt = context
    ? `You are a helpful assistant. The user asked what to study. Use the recommendations below (retrieved from the college catalogue) to answer in natural language, in the same language the user wrote. Do not invent degrees or credit numbers beyond what is listed.\n\n${context}`
    : undefined

  const messages: ChatMessage[] = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    ...prior,
    { role: 'user' as const, content: message },
  ]

  try {
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages,
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
