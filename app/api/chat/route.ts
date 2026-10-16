import { openai, CHAT_MODEL } from '@/lib/openai'
import { recommendStudy } from '@/lib/colleges'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequest {
  message?: unknown
  history?: unknown
}

// The "recommend_study" function the model can call when the user asks what to
// study (recommend a major/department) using the colleges file.
const STUDY_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'recommend_study',
      description:
        'Recommend what to study (majors/departments) from the colleges catalogue. ' +
        'Call this when the user asks for a study/major recommendation, e.g. "what should I study?", ' +
        '"recommend a major", "recommend what to study".',
      parameters: {
        type: 'object' as const,
        properties: {
          interest: {
            type: 'string',
            description:
              "The user's interest, field or keyword to match majors against (e.g. '컴퓨터', 'AI', '데이터').",
          },
          college: {
            type: 'string',
            description:
              'Optional college name to restrict recommendations to (e.g. "이과대학").',
          },
        },
        required: ['interest'],
        additionalProperties: false,
      },
    },
  },
]

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

  const messages = [...prior, { role: 'user' as const, content: message }]

  try {
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages,
      tools: STUDY_TOOLS,
      tool_choice: 'auto',
    })

    const choice = completion.choices[0]?.message
    const toolCalls = choice?.tool_calls ?? []
    let text = choice?.content?.trim() ?? ''

    // If the model asked to recommend a major, run the function and give the
    // model its result so it can produce a natural-language answer.
    if (toolCalls.length > 0) {
      const toolMessages = await Promise.all(
        toolCalls.map(async (call) => {
          if (!('function' in call)) {
            return {
              role: 'tool' as const,
              tool_call_id: call.id,
              content: JSON.stringify({ error: 'Unsupported tool call' }),
            }
          }
          if (call.function.name !== 'recommend_study') {
            return {
              role: 'tool' as const,
              tool_call_id: call.id,
              content: JSON.stringify({ error: `Unknown function ${call.function.name}` }),
            }
          }
          try {
            const args = JSON.parse(call.function.arguments ?? '{}')
            const result = await recommendStudy({
              interest: args.interest ?? '',
              college: args.college,
            })
            return {
              role: 'tool' as const,
              tool_call_id: call.id,
              content: JSON.stringify(result),
            }
          } catch (err) {
            return {
              role: 'tool' as const,
              tool_call_id: call.id,
              content: JSON.stringify({
                error: err instanceof Error ? err.message : 'Failed to load colleges',
              }),
            }
          }
        }),
      )

      const followUp = await openai.chat.completions.create({
        model: CHAT_MODEL,
        messages: [...messages, choice, ...toolMessages],
      })
      text = followUp.choices[0]?.message?.content?.trim() || text
    }

    return Response.json({
      message: text || 'I received your message but could not generate a response.',
    })
  } catch (err) {
    console.error('Chat error:', err)
    return Response.json({ error: 'Failed to process message' }, { status: 500 })
  }
}
