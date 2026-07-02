import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'restoring') {
    return (
      <div className="app-restoring" role="status" aria-label="Restoring your session">
        <span className="spinner" />
      </div>
    )
  }

  if (status === 'signedOut') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}
