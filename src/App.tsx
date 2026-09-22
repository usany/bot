import { useState, useRef, useEffect } from 'react'
import './App.css'

interface Message {
  id: string
  text: string
  sender: 'user' | 'bot'
  timestamp: Date
}

const API_BASE_URL = 'http://localhost:5000/api'

function App() {
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
  const [isConnected, setIsConnected] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`)
        if (response.ok) {
          setIsConnected(true)
        }
      } catch (err) {
        setError('Could not connect to server. Make sure the backend is running on port 3001.')
        console.error('Connection error:', err)
      }
    }

    checkConnection()
  }, [])

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
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userInput }),
      })

      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`)
      }

      const data = await response.json()
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
        <p>Powered by OpenCode SDK</p>
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
              <p>{message.text}</p>
              <span className="timestamp">
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

export default App
