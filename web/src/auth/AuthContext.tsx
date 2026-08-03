/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, apiFetch, clearToken, getToken, setToken } from '../lib/api'
import type { Loc } from '../i18n'

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
  // The company's bilingual name (CLAUDE.md §6 — shown to every console/mobile
  // user regardless of their language, via the wordmark). NULL until the
  // onboarding wizard's save writes it.
  companyName: Loc | null
  // The uploaded company logo as a data URI (auth.js inlines the file so the
  // wordmark never needs its own authenticated fetch). NULL if none uploaded.
  companyLogo: string | null
}

// Every capability that grants at least one console route (see main.tsx's
// Guard usage) — kept in sync with it by hand since this list is small and
// changes rarely. A level holding only e.g. manage_knowledge_base (no
// view_all) still needs to log in to reach its one page (capabilities.js:
// manage_events/manage_knowledge_base/manage_training exist specifically so a
// level can author one module without also holding view_all's oversight).
const CONSOLE_CAPABILITIES = [
  'view_all',
  'manage_employees',
  'manage_knowledge_base',
  'manage_events',
  'manage_training',
]

// Who may use the web console: the admin, or an oversight/module-author
// employee. Field employees and requesters are turned away (they use the
// mobile apps).
export function canUseConsole(u: Pick<AuthUser, 'role' | 'capabilities'>): boolean {
  return u.role === 'admin' || u.capabilities.some((c) => CONSOLE_CAPABILITIES.includes(c))
}

type AuthStatus = 'restoring' | 'signedOut' | 'signedIn'

interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  login: (identifier: string, password: string) => Promise<void>
  logout: () => void
  // Called by the onboarding wizard on its final save so the gate stops
  // intercepting and the console renders. Takes the company name (and a data
  // URI preview of the logo, if one was picked) the Owner just entered so the
  // shell wordmark switches immediately, without waiting on a fresh /auth/me
  // round-trip — the real, server-inlined logo replaces this preview on the
  // next login/restore anyway, so it doesn't need to be exact.
  markOnboarded: (companyName: Loc, companyLogo: string | null) => void
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
      markOnboarded(companyName, companyLogo) {
        setUser((u) => (u ? { ...u, onboardingCompleted: true, companyName, companyLogo } : u))
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
