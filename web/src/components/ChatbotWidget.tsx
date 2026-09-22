import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { useI18n } from '../i18n'
import './ChatbotWidget.css'

// In-app help/FAQ assistant (CLAUDE.md §13, chatbot exception — reuses the
// Gemini proxy already approved for bilingual auto-fill). Stateless: history
// lives only in this component's state and is round-tripped to the server on
// every call — nothing persists across a page reload, same as this file
// having no backing table (backend/src/lib/chatbot.js).
type Role = 'user' | 'assistant'
interface Message {
  role: Role
  text: string
}

// Route → nav label key, for telling the backend which screen the caller has
// open (backend/src/lib/chatbot.js's `page`) so ambiguous questions ("how
// does this work") get an answer about the actual current screen. Mirrors
// DashboardShell.tsx's nav arrays; kept as its own small map rather than
// importing those (they're admin/oversight-specific arrays, this just needs
// the label).
const PATH_LABEL_KEYS: [string, string][] = [
  ['/requests', 'nav_requests'],
  ['/employees', 'nav_employees'],
  ['/evaluations', 'nav_evaluations'],
  ['/departments', 'nav_departments'],
  ['/reports', 'nav_reports'],
  ['/timeclock', 'nav_timeclock'],
  ['/schedule', 'nav_schedule'],
  ['/checklists', 'nav_checklists'],
  ['/knowledge-base', 'nav_knowledge_base'],
  ['/events', 'nav_events'],
  ['/levels', 'nav_levels'],
  ['/audit', 'nav_audit'],
  ['/services', 'nav_services'],
  ['/settings', 'nav_settings'],
  ['/profile', 'profile_title'],
]

// Starter prompts for the empty state — distinct from the mobile apps' own
// suggestions. "Set up my company" is Admin-only work (onboarding/Settings/
// Departments/Levels/Services), so an oversight employee — who can range from
// a fresh hire to a manager, but never gets that screen — sees a relevant
// swap instead, not a question whose honest answer is "you can't do this."
const ADMIN_STARTER_KEYS = ['chatbot_suggest_setup', 'chatbot_suggest_what', 'chatbot_suggest_employee']
const EMPLOYEE_STARTER_KEYS = ['chatbot_suggest_assign', 'chatbot_suggest_what', 'chatbot_suggest_employee']

export default function ChatbotWidget() {
  const { t } = useI18n()
  const { user } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const starterKeys = user?.role === 'admin' ? ADMIN_STARTER_KEYS : EMPLOYEE_STARTER_KEYS

  const currentPage = (() => {
    const match = PATH_LABEL_KEYS.find(([path]) => location.pathname.startsWith(path))
    return match ? t(match[1]) : t('nav_dashboard')
  })()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, open])

  async function sendText(text: string) {
    if (!text || sending) return
    setError(null)
    setMessages((cur) => [...cur, { role: 'user', text }])
    setInput('')
    setSending(true)
    try {
      const res = await apiFetch<{ reply: string }>('/chatbot/message', {
        method: 'POST',
        body: {
          message: text,
          history: messages.slice(-20),
          page: currentPage,
          capabilities: user?.capabilities ?? [],
          features: user?.companyFeatures ?? [],
        },
      })
      setMessages((cur) => [...cur, { role: 'assistant', text: res.reply }])
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t('chatbot_rate_limited') : t('chatbot_error'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="chatbot" ref={rootRef}>
      {open && (
        <div className="chatbot-panel" role="dialog" aria-label={t('chatbot_title')}>
          <div className="chatbot-head">
            <h4>{t('chatbot_title')}</h4>
            <button type="button" className="chatbot-icon-btn" aria-label={t('chatbot_close')} onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <div className="chatbot-list" ref={listRef}>
            {messages.length === 0 && (
              <div className="chatbot-empty">
                <p>{t('chatbot_empty')}</p>
                <div className="chatbot-suggestions">
                  {starterKeys.map((key) => (
                    <button key={key} type="button" onClick={() => void sendText(t(key))}>
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chatbot-msg chatbot-msg-${m.role}`}>
                {m.text}
              </div>
            ))}
            {sending && <div className="chatbot-msg chatbot-msg-assistant chatbot-typing">…</div>}
          </div>
          {error && <p className="chatbot-error">{error}</p>}
          <form
            className="chatbot-input"
            onSubmit={(e) => {
              e.preventDefault()
              void sendText(input.trim())
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('chatbot_placeholder')}
              disabled={sending}
            />
            <button type="submit" disabled={sending || !input.trim()}>
              {t('chatbot_send')}
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        className="chatbot-fab"
        aria-label={t('chatbot_open')}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 5h16v11H8l-4 4V5Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
