import { useAuth } from '../auth/AuthContext'
import './DashboardShell.css'

export default function DashboardShell() {
  const { user, logout } = useAuth()

  return (
    <div className="shell">
      <header className="shell-bar">
        <p className="shell-wordmark">
          <span className="shell-pip" aria-hidden="true" />
          MonitorFlow
        </p>
        <div className="shell-session">
          <span className="shell-user">{user?.name}</span>
          <button className="shell-signout" type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="shell-main">
        <div className="shell-empty">
          <h1>Dashboard</h1>
          <p>
            Nothing to show yet — the overview is being built. You’re signed in as{' '}
            <strong>{user?.email}</strong>.
          </p>
        </div>
      </main>
    </div>
  )
}
