import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import NotificationBell from '../components/NotificationBell'
import './DashboardShell.css'

// Oversight nav, each item gated by the capability its page needs (Gate 1).
// A lead with every capability sees them all; a narrower level sees a subset.
const oversightNav = [
  { to: '/', label: 'Dashboard', end: true, need: 'view_all' },
  { to: '/requests', label: 'Requests', end: false, need: 'view_all' },
  { to: '/employees', label: 'Employees', end: false, need: 'manage_employees' },
  { to: '/reports', label: 'Reports', end: false, need: 'view_all' },
]
// Admin manages accounts/configuration only. The Services page joins this list
// once the JSON-import slice lands.
const adminNav = [{ to: '/audit', label: 'Audit Log', end: false }]

export default function DashboardShell() {
  const { user, logout } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navItems = isAdmin
    ? adminNav
    : oversightNav.filter((item) => user?.capabilities.includes(item.need))

  return (
    <div className="shell">
      <header className="shell-bar">
        <p className="shell-wordmark">
          <span className="shell-pip" aria-hidden="true" />
          MonitorFlow
        </p>
        <nav className="shell-nav" aria-label="Primary">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="shell-session">
          {/* No notification triggers target the admin — an always-empty bell is noise. */}
          {!isAdmin && <NotificationBell />}
          <span className="shell-user">{user?.name}</span>
          <button className="shell-signout" type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  )
}
