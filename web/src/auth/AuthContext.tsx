/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, apiFetch, clearToken, getToken, setToken } from '../lib/api'

export interface AuthUser {
  id: number
  name: string
  email: string | null
  role: 'user' | 'employee' | 'admin'
  phone: string | null
  departmentId: number | null
  loginIdentifier: string
  // Two-gate model: the level-granted capabilities this account holds. The web
  // console shows an admin (kind) or an oversight employee (holds view_all);
  // the server still enforces every capability with 403s.
  capabilities: string[]
  // First-login gate: false for an Owner (admin) whose company hasn't run the
  // "Customize your app" wizard yet; null for accounts with no company.
  onboardingCompleted: boolean | null
}

// Who may use the web console: the admin, or an oversight employee (view_all).
// Field employees and requesters are turned away (they use the mobile apps).
export function canUseConsole(u: Pick<AuthUser, 'role' | 'capabilities'>): boolean {
  return u.role === 'admin' || u.capabilities.includes('view_all')
}

type AuthStatus = 'restoring' | 'signedOut' | 'signedIn'

interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  login: (identifier: string, password: string) => Promise<void>
  logout: () => void
  // Called by the onboarding wizard on its final save so the gate stops
  // intercepting and the console renders.
  markOnboarded: () => void
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
        if (!canUseConsole(me)) {
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
      async login(identifier, password) {
        const { token, user: signedIn } = await apiFetch<{ token: string; user: AuthUser }>(
          '/auth/login',
          { method: 'POST', body: { identifier, password }, auth: false },
        )
        if (!canUseConsole(signedIn)) {
          throw new ApiError(403, 'This dashboard is for oversight and admin accounts', 'not_console')
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
      markOnboarded() {
        setUser((u) => (u ? { ...u, onboardingCompleted: true } : u))
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
