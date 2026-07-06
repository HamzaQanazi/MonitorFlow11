/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, apiFetch, clearToken, getToken, setToken } from '../lib/api'

export interface AuthUser {
  id: number
  name: string
  email: string
  role: 'user' | 'employee' | 'monitor' | 'admin'
  phone: string | null
  departmentId: number | null
}

type AuthStatus = 'restoring' | 'signedOut' | 'signedIn'

interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() => (getToken() ? 'restoring' : 'signedOut'))
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    if (status !== 'restoring') return
    let cancelled = false
    apiFetch<{ user: AuthUser }>('/auth/me')
      .then(({ user: me }) => {
        if (cancelled) return
        // Spec v4: the web console serves monitors AND the admin.
        if (me.role !== 'monitor' && me.role !== 'admin') {
          clearToken()
          setStatus('signedOut')
          return
        }
        setUser(me)
        setStatus('signedIn')
      })
      .catch(() => {
        if (cancelled) return
        clearToken()
        setStatus('signedOut')
      })
    return () => {
      cancelled = true
    }
  }, [status])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      async login(email, password) {
        const { token, user: signedIn } = await apiFetch<{ token: string; user: AuthUser }>(
          '/auth/login',
          { method: 'POST', body: { email, password }, auth: false },
        )
        if (signedIn.role !== 'monitor' && signedIn.role !== 'admin') {
          throw new ApiError(403, 'This dashboard is for monitor and admin accounts', 'not_monitor')
        }
        setToken(token)
        setUser(signedIn)
        setStatus('signedIn')
      },
      logout() {
        clearToken()
        setUser(null)
        setStatus('signedOut')
      },
    }),
    [status, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
