import express from 'express'
import { createOpencode } from '@opencode-ai/sdk'
import cors from 'cors'

const app = express()
const PORT = 5000

app.use(cors())
app.use(express.json())

let client = null
let sessionId = null

// Initialize SDK
async function initializeSDK() {
  try {
    const { client: sdkClient } = await createOpencode()
    client = sdkClient

    const session = await client.session.create({
      body: { title: 'Responsive Chatbot' },
    })
    sessionId = session.id
    console.log('SDK initialized, session:', sessionId)
  } catch (err) {
    console.error('SDK initialization error:', err)
    process.exit(1)
  }
}

// Initialize on startup
initializeSDK()

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const { message } = req.body

  if (!message || !client || !sessionId) {
    return res.status(400).json({ error: 'Invalid request or SDK not initialized' })
  }

  try {
    const response = await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text: message }],
      },
    })

    const botText = response.parts?.[0]?.text || 'I received your message but could not generate a response.'
    res.json({ message: botText })
  } catch (err) {
    console.error('Chat error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to process message' })
  }
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', initialized: !!client })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
