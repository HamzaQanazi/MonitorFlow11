import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useI18n } from '../i18n'
import NotificationBell from '../components/NotificationBell'
import { Wordmark } from '../components/Wordmark'
import './DashboardShell.css'

// Oversight nav, each item gated by the capability its page needs (Gate 1).
// A lead with every capability sees them all; a narrower level sees a subset.
// `labelKey` resolves through t() so the nav flips language with the console.
const oversightNav = [
  { to: '/', labelKey: 'nav_dashboard', end: true, need: 'view_all' },
  { to: '/requests', labelKey: 'nav_requests', end: false, need: 'view_all' },
  { to: '/employees', labelKey: 'nav_employees', end: false, need: 'manage_employees' },
  { to: '/reports', labelKey: 'nav_reports', end: false, need: 'view_all' },
]
// Admin manages accounts/configuration only.
const adminNav = [
  { to: '/services', labelKey: 'nav_services', end: false },
  { to: '/org', labelKey: 'nav_org', end: false },
  { to: '/levels', labelKey: 'nav_levels', end: false },
  { to: '/audit', labelKey: 'nav_audit', end: false },
  { to: '/webhooks', labelKey: 'nav_webhooks', end: false },
]

export default function DashboardShell() {
  const { user, logout } = useAuth()
  const { t, lang, setLang } = useI18n()
  const isAdmin = user?.role === 'admin'
  const navItems = isAdmin
    ? adminNav
    : oversightNav.filter((item) => user?.capabilities.includes(item.need))

  return (
    <div className="shell">
      <header className="shell-bar">
        <Wordmark variant="shell" />
        <nav className="shell-nav" aria-label="Primary">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="shell-session">
          {/* No notification triggers target the admin — an always-empty bell is noise. */}
          {!isAdmin && <NotificationBell />}
          <button
            className="shell-signout"
            type="button"
            onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
          >
            {t('lang_toggle')}
          </button>
          <span className="shell-user">{user?.name}</span>
          <button className="shell-signout" type="button" onClick={logout}>
            {t('sign_out')}
          </button>
        </div>
      </header>

      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  )
}
