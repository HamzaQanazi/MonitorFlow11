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
  { to: '/timeclock', labelKey: 'nav_timeclock', end: false, need: 'view_all' },
  { to: '/schedule', labelKey: 'nav_schedule', end: false, need: 'view_all' },
  { to: '/checklists', labelKey: 'nav_checklists', end: false, need: 'view_all' },
  { to: '/directory', labelKey: 'nav_directory', end: false, need: 'view_all' },
]
// Owner (admin role) surface. Dashboard + Employees admit the admin via the
// backend's requireCapabilityOrAdmin (I2: admins hold no capabilities, so this
// is a role-based allow, not a Gate-1 capability like oversightNav's items).
const adminNav = [
  { to: '/', labelKey: 'nav_dashboard', end: true },
  { to: '/employees', labelKey: 'nav_employees', end: false },
  { to: '/departments', labelKey: 'nav_departments', end: false },
  { to: '/services/new', labelKey: 'nav_add_service', end: false },
  { to: '/checklists', labelKey: 'nav_checklists', end: false },
  { to: '/directory', labelKey: 'nav_directory', end: false },
  { to: '/audit', labelKey: 'nav_audit', end: false },
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
        <Wordmark
          variant="shell"
          companyName={user?.onboardingCompleted ? user.companyName : null}
          companyLogo={user?.onboardingCompleted ? user.companyLogo : null}
        />
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
