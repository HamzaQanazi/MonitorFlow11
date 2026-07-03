import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import './DashboardShell.css'

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/requests', label: 'Requests' },
  { to: '/employees', label: 'Employees' },
  { to: '/reports', label: 'Reports' },
]

export default function DashboardShell() {
  const { user, logout } = useAuth()

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
