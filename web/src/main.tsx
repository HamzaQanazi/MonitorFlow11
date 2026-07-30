import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { I18nProvider } from './i18n'
import RequireAuth from './components/RequireAuth'
import LoginPage from './pages/LoginPage'
import DashboardShell from './pages/DashboardShell'
import DashboardPage from './pages/DashboardPage'
import RequestsPage from './pages/RequestsPage'
import EmployeesPage from './pages/EmployeesPage'
import ReportsPage from './pages/ReportsPage'
import AuditPage from './pages/AuditPage'

// Two-gate routing: oversight employees and the admin share the shell but not
// the pages. Each page needs a capability (Gate 1) — or the admin kind for the
// account/config surfaces. The server enforces the same with 403s; this just
// keeps the UI from rendering pages that would only show errors.
// eslint-disable-next-line react-refresh/only-export-components -- entrypoint file, fast refresh doesn't apply
function Guard({ need, children }: { need: 'view_all' | 'manage_employees' | 'admin'; children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return null
  const allowed = need === 'admin' ? user.role === 'admin' : user.capabilities.includes(need)
  if (!allowed) {
    // Send each kind to its own home rather than showing a 403 page.
    return <Navigate to={user.role === 'admin' ? '/audit' : '/'} replace />
  }
  return children
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <DashboardShell />
              </RequireAuth>
            }
          >
            <Route index element={<Guard need="view_all"><DashboardPage /></Guard>} />
            <Route path="requests" element={<Guard need="view_all"><RequestsPage /></Guard>} />
            <Route path="requests/:id" element={<Guard need="view_all"><RequestsPage /></Guard>} />
            <Route path="employees" element={<Guard need="manage_employees"><EmployeesPage /></Guard>} />
            <Route path="reports" element={<Guard need="view_all"><ReportsPage /></Guard>} />
            <Route path="audit" element={<Guard need="admin"><AuditPage /></Guard>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
)
