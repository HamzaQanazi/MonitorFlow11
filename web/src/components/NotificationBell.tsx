import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import './NotificationBell.css'

// Shell notification bell — the web sibling of the mobile apps' shared
// Notifications component. Monitors receive task_rejected and comment
// notifications (Section 7 trigger table); the bell polls every 30s like
// every other live surface, and clicking an item deep-links to the
// request's detail pane.

interface Notification {
  id: number
  type: string
  message: string
  requestId: number | null
  isRead: boolean
  createdAt: string
}

interface ListResponse {
  notifications: Notification[]
  unread: number
}

const POLL_MS = 30_000

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const load = useCallback(() => {
    apiFetch<ListResponse>('/notifications?userId=me&pageSize=20')
      .then((res) => {
        setItems(res.notifications)
        setUnread(res.unread)
      })
      .catch(() => {}) // silent — the badge just keeps its last value
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  // Outside click / Escape close the panel.
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

  async function openItem(n: Notification) {
    setOpen(false)
    if (!n.isRead) {
      try {
        await apiFetch(`/notifications/${n.id}/read`, { method: 'PATCH' })
      } catch {
        // best-effort; still navigate
      }
      load()
    }
    if (n.requestId !== null) void navigate(`/requests/${n.requestId}`)
  }

  async function readAll() {
    try {
      await apiFetch('/notifications/read-all', { method: 'PATCH' })
      load()
    } catch {
      // next poll will reconcile
    }
  }

  return (
    <div className="bell" ref={rootRef}>
      <button
        type="button"
        className="bell-button"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3a6 6 0 0 0-6 6v3.2l-1.7 3.1a1 1 0 0 0 .88 1.48h13.64a1 1 0 0 0 .88-1.48L18 12.2V9a6 6 0 0 0-6-6Zm-2 15a2 2 0 1 0 4 0"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <h4>Notifications</h4>
            {unread > 0 && (
              <button type="button" className="bell-readall" onClick={() => void readAll()}>
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="bell-empty">Nothing here — updates about requests will appear.</p>
          ) : (
            <ul className="bell-list">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`bell-item${n.isRead ? '' : ' is-unread'}`}
                    onClick={() => void openItem(n)}
                  >
                    <span className="bell-item-msg">{n.message}</span>
                    <span className="bell-item-time">{timeAgo(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
