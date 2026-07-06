import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import NotificationBell from '../components/NotificationBell'
import './DashboardShell.css'

const monitorNav = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/requests', label: 'Requests' },
  { to: '/employees', label: 'Employees' },
  { to: '/reports', label: 'Reports' },
]
// Spec v4: admin manages accounts/configuration only. Audit Log and Services
// pages join this list in the Week 4 slice.
const adminNav = [{ to: '/monitors', label: 'Monitors', end: false }]

export default function DashboardShell() {
  const { user, logout } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navItems = isAdmin ? adminNav : monitorNav

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
