import 'server-only'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? 'http://127.0.0.1:3001/mcp'

/**
 * Recommend degrees via the Python MCP server (mcp/server.py). The server is a
 * separate process exposing the `recommend_study` tool over Streamable HTTP;
 * this client talks to it on the Next.js server so the tool never touches the
 * browser or the OpenAI function-calling path.
 */
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
