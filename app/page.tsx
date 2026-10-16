'use client'

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './chat.css'

interface Message {
  id: string
  text: string
  sender: 'user' | 'bot'
  timestamp: Date
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: 'Hello! How can I help you today?',
      sender: 'bot',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // OpenCode can take a few seconds to start (or restart), so keep polling until it answers.
  useEffect(() => {
    if (isConnected) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const checkConnection = async () => {
      try {
        const response = await fetch('/api/health')
        if (!response.ok) throw new Error(`Health check failed: ${response.status}`)
        if (cancelled) return
        setIsConnected(true)
        setError(null)
      } catch {
        if (cancelled) return
        setError('Waiting for the server… Please try again.')
        timer = setTimeout(checkConnection, 2000)
      }
    }

    checkConnection()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isConnected])

  const handleSend = async () => {
    if (!input.trim() || !isConnected) return

    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      sender: 'user',
      timestamp: new Date(),
    }

    const userInput = input
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userInput, history: historyRef.current }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error ?? `Server error: ${response.status}`)
      }

      // Append this turn to the shared history so the model can recall prior messages.
      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: userInput },
        { role: 'assistant', content: data.message },
      ]

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: data.message,
        sender: 'bot',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, botMessage])
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to send message'
      setError(errorMsg)
      console.error('Send error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="chatbot-container">
      <div className="chatbot-header">
        <h1>Chat Assistant</h1>
        <p>Powered by Groq · degree recommendations via MCP</p>
      </div>

      {error && (
        <div className="error-banner">
          <p>⚠️ {error}</p>
        </div>
      )}

      <div className="messages-container">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.sender === 'user' ? 'user-message' : 'bot-message'}`}
          >
            <div className="message-bubble">
              {message.sender === 'bot' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
              ) : (
                <p>{message.text}</p>
              )}
              <span className="timestamp" suppressHydrationWarning>
                {message.timestamp.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="message bot-message">
            <div className="message-bubble">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type your message..."
          disabled={isLoading || !isConnected}
          className="message-input"
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim() || !isConnected}
          className="send-button"
        >
          Send
        </button>
      </div>
    </div>
  )
}
