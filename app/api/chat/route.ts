import { openai, CHAT_MODEL } from '@/lib/openai'
import { fetchCatalogueContext } from '@/lib/mcp'

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

  // The LLM decides (in any language) which catalogue tool applies, then we
  // dispatch to the reusable MCP server via a single generic callTool helper.
  let context = ''
  let tool: string | null = null
  try {
    const result = await fetchCatalogueContext(message, prior)
    if (result) {
      context = result.content
      tool = result.tool
    }
  } catch (err) {
    console.error('MCP tool call failed:', err)
  }

  const systemPrompt = !context
    ? undefined
    : tool === 'get_curriculum'
      ? `You are a helpful assistant. The user asked about a specific degree's curriculum or courses. Use the curriculum/course information below (retrieved from the department's official website) to answer in natural language, in the same language the user wrote. Do not invent courses, credits, or requirements beyond what is provided.\n\n${context}`
      : tool === 'get_lectures'
        ? `You are a helpful assistant. The user asked what lectures/courses a department offers (its timetable). Use the data below (the university's course offerings read from the college catalogue) to answer in natural language, in the same language the user wrote. Each lecture has a Korean title (name_ko) plus its English category (category_en), subject code, credits, grade/year level, campus, and note. When the user writes in English, translate each name_ko into clear English and present the subject code, English title, credits, category, and grade. Do not invent lectures beyond what is listed.\n\n${context}`
      : tool === 'get_department'
        ? `You are a helpful assistant. The user asked about a specific degree/department. Use the details below (retrieved from the department's official homepage) to answer in natural language, in the same language the user wrote. Do not invent facts, requirements, or numbers beyond what is provided.\n\n${context}`
        : tool === 'get_catalogue'
          ? `You are a helpful assistant. The user asked for department details in general. Below is a directory of available departments with their colleges and official homepage URLs (retrieved from the college catalogue). Present it clearly in the same language the user wrote, and invite the user to name a specific department if they want its full introduction. Do not invent departments or facts beyond what is listed.\n\n${context}`
          : `You are a helpful assistant. The user asked for a degree recommendation (what to study). You have two pieces of catalogue context below: "Direct matches" (departments that directly match the stated interest, which may be empty or have fewer than three entries) and "Full catalogue" (every available department with its college and credit requirements). Recommend at least three degrees, in priority order. Lead with the direct matches when they fit, then fill the remaining spots up to at least three with related departments from the full catalogue. Briefly explain how each recommendation fits the user's interest. Answer in the same language the user wrote. Do not invent degrees, colleges, or credit numbers beyond what is listed.\n\n${context}`

  const messages: ChatMessage[] = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    // Always-instruct the model to reply in whatever language the user wrote,
    // even when no MCP context was fetched above.
    {
      role: 'system',
      content:
        'Always respond in the same language the user wrote their message in. ' +
        'If the user writes in Korean, answer in Korean; if in English, answer in ' +
        'English; mirror any other language exactly.',
    },
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
    const detail = err instanceof Error ? err.message : 'Unknown error'
    return Response.json(
      { error: 'Failed to process message', detail },
      { status: 500 },
    )
  }
}
