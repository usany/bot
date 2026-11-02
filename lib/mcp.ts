import 'server-only'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { openai, CHAT_MODEL } from '@/lib/openai'

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? 'http://127.0.0.1:3001/mcp'

/**
 * Recommend degrees via the Python MCP server (mcp/server.py). The server is a
 * separate process exposing the `recommend_study` tool over Streamable HTTP;
 * this client talks to it on the Next.js server so the tool never touches the
 * browser or the OpenAI function-calling path.
 *
 * Note: this is called on every chat turn, so it can receive conversations
 * unrelated to recommendations. In that case the tool returns a brief reply
 * that stays on the user's actual topic instead of forcing a recommendation.
 */
export interface DegreeQueryResult {
  wantsRecommendation: boolean
  reason: string
}

/**
 * Classify whether a message is a degree-recommendation request using the LLM
 * (Groq/OpenAI), not keyword matching. This makes it language-agnostic: the
 * model understands intent regardless of the language the user writes in.
 *
 * Only call `recommendStudy` when `wantsRecommendation` is true.
 */
export async function checkDegreeQuery(message: string): Promise<DegreeQueryResult> {
  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You classify a single chat message. Answer with exactly one JSON object: ' +
          '{"wantsRecommendation": boolean, "reason": string}. ' +
          'Set wantsRecommendation true only when the user is asking what to study, ' +
          'for a degree/major/department recommendation, or which subject matches ' +
          'their interest. Otherwise set it false. Work in any language the user wrote.',
      },
      { role: 'user', content: message },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0]?.message?.content ?? ''
  const parsed = JSON.parse(raw)
  return {
    wantsRecommendation: parsed.wantsRecommendation === true,
    reason: String(parsed.reason ?? ''),
  }
}

export async function recommendStudy(input: {
  interest: string
  college?: string
}): Promise<string> {
  const client = new Client({
    name: 'chat-assistant',
    version: '1.0.0',
  })

  const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL))

  try {
    await client.connect(transport)
    const result = await client.callTool({
      name: 'recommend_study',
      arguments: {
        interest: input.interest,
        college: input.college ?? '',
      },
    })

    const content = result.content as Array<{ type: string; text?: string }>
    const text = content
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text as string)
      .join('\n')

    if (!text) {
      throw new Error('MCP server returned no text result')
    }
    return text
  } finally {
    await transport.close().catch(() => {})
  }
}
