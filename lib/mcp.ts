import 'server-only'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { openai, CHAT_MODEL } from '@/lib/openai'
import { degreeCatalogueText } from '@/lib/catalogue'

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? 'http://127.0.0.1:3100/mcp'

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
  wantsDetails: boolean
  degree: string
  reason: string
}

/**
 * Classify a message using the LLM (Groq/OpenAI), not keyword matching.
 * This makes it language-agnostic: the model understands intent regardless of
 * the language the user writes in.
 *
 * The result distinguishes two intents:
 * - `wantsRecommendation` — the user asks what to study / which major matches
 *   their interest. Call `recommendStudy`.
 * - `wantsDetails` — the user asks for details about a specific degree
 *   (curriculum, admissions, what it studies). Call `getDegreeDetails`.
 */
export async function checkDegreeQuery(message: string): Promise<DegreeQueryResult> {
  const catalogue = degreeCatalogueText()

  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You classify a single chat message about university study. ' +
          'Here is the canonical catalogue of degrees ("degree — college"), ' +
          'one per line; every line is a valid department you may name:\n' +
          catalogue +
          '\n\nAnswer with exactly one JSON object: ' +
          '{"wantsRecommendation": boolean, "wantsDetails": boolean, "degree": string, "reason": string}. ' +
          'Set wantsRecommendation true only when the user is asking what to study, ' +
          'for a degree/major/department recommendation, or which subject matches ' +
          'their interest. Set wantsDetails true only when the user asks for details ' +
          'about one specific degree/department (e.g. its curriculum, introduction, ' +
          'admissions requirements, or what it studies), typically naming a single ' +
          'department. The two are mutually exclusive; at most one may be true. ' +
          'When wantsDetails is true, resolve the department the user named to its ' +
          'exact canonical degree string from the catalogue above (the Korean name ' +
          'before the " — "), translating synonyms and any language (e.g. "math ' +
          'department", "mathematics", "수학" all resolve to "수학과"). ' +
          'Set degree to that exact canonical string. Do NOT invent a department ' +
          'not in the catalogue; if the named department is not present, set ' +
          'wantsDetails false. Otherwise set degree to "". If neither intent ' +
          'applies, both are false and degree is "". Work in any language the user wrote.',
      },
      { role: 'user', content: message },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0]?.message?.content ?? ''
  const parsed = JSON.parse(raw)
  return {
    wantsRecommendation: parsed.wantsRecommendation === true,
    wantsDetails: parsed.wantsDetails === true,
    degree: typeof parsed.degree === 'string' ? parsed.degree : '',
    reason: String(parsed.reason ?? ''),
  }
}

export async function recommendStudy(input: {
  interest: string
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

/**
 * Fetch detailed info about a specific degree via the Python MCP server's
 * `get_degree_details` tool, which scrapes the degree's official homepage from
 * the URL recorded in colleges.json. Returns the raw catalogue/homepage text.
 */
export async function getDegreeDetails(degree: string): Promise<string> {
  const client = new Client({
    name: 'chat-assistant',
    version: '1.0.0',
  })

  const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL))

  try {
    await client.connect(transport)
    const result = await client.callTool({
      name: 'get_degree_details',
      arguments: { degree },
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
