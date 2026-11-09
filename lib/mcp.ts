import 'server-only'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { catalogueText } from '@/lib/catalogue'
import { openai, CHAT_MODEL } from '@/lib/openai'

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? 'http://127.0.0.1:3100/mcp'

/**
 * A thin, generic MCP client for the college-catalogue server (mcp/server.py).
 *
 * Unlike the previous hand-wired implementation, this module does not
 * hard-code tool semantics. It connects once, introspects the server's tools
 * via `listTools`, and exposes a single `callTool(name, args)` helper. The
 * server is now a reusable, schema-typed tool surface — any MCP client can
 * attach, and this client relies on the contract (tool names + schemas) rather
 * than duplicating parser logic per tool.
 */

let _clientPromise: Promise<Client> | null = null

/** Lazily connect once and reuse the connection across callers. */
function getClient(): Promise<Client> {
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const client = new Client({
        name: 'chat-assistant',
        version: '1.0.0',
      })
      const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL))
      await client.connect(transport)
      return client
    })().catch((err) => {
      _clientPromise = null
      throw err
    })
  }
  return _clientPromise
}

/** List the tools the server exposes (name, description, schema). */
export async function listTools(): Promise<
  Array<{ name: string; description?: string; inputSchema?: unknown }>
> {
  const client = await getClient()
  const { tools } = await client.listTools()
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))
}

/**
 * Call a tool by name with arbitrary JSON arguments. Generic: no tool-specific
 * parsing is baked in. Returns the concatenated text content (or structured
 * content object when the server returns `structuredContent`).
 */
export async function callTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const client = await getClient()
  const result = await client.callTool({ name, arguments: args })

  // Prefer structured content (server uses structured_output=True).
  const structured = result.structuredContent
  if (structured != null && typeof structured === 'object') {
    return JSON.stringify(structured)
  }

  const content = result.content as Array<{ type: string; text?: string }>
  const text = content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n')

  if (!text) {
    throw new Error(`MCP tool ${name} returned no text content`)
  }
  return text
}

/**
 * Result of classifying a chat message into the catalogue tools' intent.
 * `tool` is the MCP tool name to call; `degree` is the resolved canonical
 * degree (when relevant) — both are strings, not bespoke flags, so adding a
 * tool to the server doesn't require editing this classifier's shape.
 *
 * `interest` and `college` are emitted in canonical Korean (the exact strings
 * from the catalogue), so the classifier — not the MCP matcher — absorbs any
 * language the user writes, keeping downstream matching language-independent.
 */
export interface DegreeQueryResult {
  tool: string
  degree: string
  interest: string
  college: string
  reason: string
}

/**
 * Classify a chat message into a catalogue tool invocation using the LLM.
 *
 * The classifier output *names the MCP tool* to call (e.g. "search_catalogue",
 * "get_department", "get_curriculum", "get_catalogue", or "" for none). This
 * keeps the dispatch table-driven and lets the server's tool surface grow
 * without a matching set of booleans here.
 */
export async function checkDegreeQuery(message: string): Promise<DegreeQueryResult> {
  const catalogue = catalogueText()

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
          '{"tool": string, "degree": string, "interest": string, "college": string, "reason": string}. ' +
          'Choose `tool` from exactly these values (empty string "" means no catalogue tool applies):\n' +
          '- "search_catalogue": the user is asking what to study, for a recommendation, or which major matches their interest. Put a concise **Korean** summary of the interest in `interest` (translate the user\'s words into Korean, using the Korean terms that appear in the catalogue above) and leave `degree` empty.\n' +
          '- "get_department": the user asks for general details or an introduction about one specific department. Resolve it to the exact canonical `degree` string (the Korean name before " — "), translating synonyms/any language (e.g. "math" -> "수학과").\n' +
          '- "get_curriculum": the user asks specifically about a department\'s curriculum, courses, 교과과정, 교육과정, 이수체계, 졸업요건, or required credits. Resolve the department to the canonical `degree` string.\n' +
          '- "get_catalogue": the user asks for department details in general without naming one (e.g. "what departments do you have", "부서 정보"). Leave `degree` empty.\n' +
          'If the named department is not in the catalogue, set `tool` to "" (empty). ' +
          'If no intent applies, `tool` is "" and `degree` is "". Work in any language the user wrote.\n' +
          '`college` is only set when the user names a specific college to filter by; otherwise "". ' +
          'When set, `college` must be the exact **Korean** college name from the catalogue lines (translate from the user\'s language, e.g. "college of science" -> "이과대학").',
      },
      { role: 'user', content: message },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0]?.message?.content ?? ''
  const parsed = JSON.parse(raw)
  return {
    tool: typeof parsed.tool === 'string' ? parsed.tool : '',
    degree: typeof parsed.degree === 'string' ? parsed.degree : '',
    interest: typeof parsed.interest === 'string' ? parsed.interest : message,
    college: typeof parsed.college === 'string' ? parsed.college : '',
    reason: String(parsed.reason ?? ''),
  }
}

/** The set of catalogue tools the chat UI knows how to present. */
export const CATALOGUE_TOOLS = [
  'search_catalogue',
  'get_department',
  'get_curriculum',
  'get_catalogue',
] as const

export type CatalogueTool = (typeof CATALOGUE_TOOLS)[number]

/**
 * Build the args for a catalogue tool call from a classifier result.
 * Table-driven: map tool name -> argument object.
 */
export function buildToolArgs(
  tool: CatalogueTool,
  gate: DegreeQueryResult,
): Record<string, unknown> {
  switch (tool) {
    case 'search_catalogue':
      return { interest: gate.interest, college: gate.college }
    case 'get_department':
    case 'get_curriculum':
      return { degree: gate.degree || gate.interest }
    case 'get_catalogue':
      return {}
  }
}

/**
 * Fetch catalogue context for a user message, returning both the raw tool
 * output and which tool produced it (so the chat route can tailor its system
 * prompt). Returns null when no catalogue tool applies.
 */
export async function fetchCatalogueContext(message: string): Promise<{
  tool: CatalogueTool
  content: string
} | null> {
  const gate = await checkDegreeQuery(message)
  if (!gate.tool || !(CATALOGUE_TOOLS as readonly string[]).includes(gate.tool)) {
    return null
  }
  const tool = gate.tool as CatalogueTool
  const args = buildToolArgs(tool, gate)
  const content = await callTool(tool, args)
  return { tool, content }
}
