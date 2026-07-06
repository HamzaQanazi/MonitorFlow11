import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { AuthProvider, useAuth } from './auth/AuthContext'
import RequireAuth from './components/RequireAuth'
import LoginPage from './pages/LoginPage'
import DashboardShell from './pages/DashboardShell'
import DashboardPage from './pages/DashboardPage'
import RequestsPage from './pages/RequestsPage'
import EmployeesPage from './pages/EmployeesPage'
import ReportsPage from './pages/ReportsPage'
import MonitorsPage from './pages/MonitorsPage'

// Spec v4: monitor and admin share the shell but not the pages — admin is
// configuration-and-accounts only (server enforces with 403s; this just keeps
// the UI from rendering pages that would only show errors).
// eslint-disable-next-line react-refresh/only-export-components -- entrypoint file, fast refresh doesn't apply
function RoleRoute({ role, children }: { role: 'monitor' | 'admin'; children: ReactNode }) {
  const { user } = useAuth()
  if (user && user.role !== role) {
    return <Navigate to={user.role === 'admin' ? '/monitors' : '/'} replace />
  }
  return children
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
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
            <Route index element={<RoleRoute role="monitor"><DashboardPage /></RoleRoute>} />
            <Route path="requests" element={<RoleRoute role="monitor"><RequestsPage /></RoleRoute>} />
            <Route path="requests/:id" element={<RoleRoute role="monitor"><RequestsPage /></RoleRoute>} />
            <Route path="employees" element={<RoleRoute role="monitor"><EmployeesPage /></RoleRoute>} />
            <Route path="reports" element={<RoleRoute role="monitor"><ReportsPage /></RoleRoute>} />
            <Route path="monitors" element={<RoleRoute role="admin"><MonitorsPage /></RoleRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
