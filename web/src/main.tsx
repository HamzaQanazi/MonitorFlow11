import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { I18nProvider } from './i18n'
import RequireAuth from './components/RequireAuth'
import LoginPage from './pages/LoginPage'
import OnboardingWizard from './pages/OnboardingWizard'
import DashboardShell from './pages/DashboardShell'
import DashboardPage from './pages/DashboardPage'
import RequestsPage from './pages/RequestsPage'
import EmployeesPage from './pages/EmployeesPage'
import DepartmentsPage from './pages/DepartmentsPage'
import ReportsPage from './pages/ReportsPage'
import TimeClockPage from './pages/TimeClockPage'
import SchedulePage from './pages/SchedulePage'
import ChecklistsPage from './pages/ChecklistsPage'
import DirectoryPage from './pages/DirectoryPage'
import AuditPage from './pages/AuditPage'
import AddServiceWizard from './pages/AddServiceWizard'

// Two-gate routing: oversight employees and the admin share the shell but not
// the pages. Each page needs a capability (Gate 1) — or the admin kind for the
// account/config surfaces. The server enforces the same with 403s; this just
// keeps the UI from rendering pages that would only show errors.
// `orAdmin` admits the admin (Owner) into a capability-gated page too — used
// only where the backend was updated to match (requireCapabilityOrAdmin):
// Dashboard and Employees. Everywhere else stays capability-only.
// eslint-disable-next-line react-refresh/only-export-components -- entrypoint file, fast refresh doesn't apply
function Guard({
  need,
  orAdmin,
  children,
}: {
  need: 'view_all' | 'manage_employees' | 'admin'
  orAdmin?: boolean
  children: ReactNode
}) {
  const { user } = useAuth()
  if (!user) return null
  const allowed =
    need === 'admin'
      ? user.role === 'admin'
      : user.capabilities.includes(need) || (orAdmin === true && user.role === 'admin')
  if (!allowed) {
    // Send each kind to its own home rather than showing a 403 page.
    return <Navigate to={user.role === 'admin' ? '/audit' : '/'} replace />
  }
  return children
}

// First-login gate: an Owner (admin) whose company hasn't run the wizard yet
// sees it instead of the console. markOnboarded() (called on save) flips the
// flag and this stops intercepting. Only the admin kind is gated — oversight
// employees and the seeded flow never hit onboardingCompleted === false.
// eslint-disable-next-line react-refresh/only-export-components -- entrypoint file, fast refresh doesn't apply
function OnboardingGate({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.role === 'admin' && user.onboardingCompleted === false) return <OnboardingWizard />
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
                <OnboardingGate>
                  <DashboardShell />
                </OnboardingGate>
              </RequireAuth>
            }
          >
            <Route index element={<Guard need="view_all" orAdmin><DashboardPage /></Guard>} />
            <Route path="requests" element={<Guard need="view_all"><RequestsPage /></Guard>} />
            <Route path="requests/:id" element={<Guard need="view_all"><RequestsPage /></Guard>} />
            <Route path="employees" element={<Guard need="manage_employees" orAdmin><EmployeesPage /></Guard>} />
            <Route path="departments" element={<Guard need="admin"><DepartmentsPage /></Guard>} />
            <Route path="reports" element={<Guard need="view_all"><ReportsPage /></Guard>} />
            <Route path="timeclock" element={<Guard need="view_all"><TimeClockPage /></Guard>} />
            <Route path="schedule" element={<Guard need="view_all"><SchedulePage /></Guard>} />
            <Route path="checklists" element={<Guard need="view_all" orAdmin><ChecklistsPage /></Guard>} />
            <Route path="directory" element={<Guard need="view_all" orAdmin><DirectoryPage /></Guard>} />
            <Route path="audit" element={<Guard need="admin"><AuditPage /></Guard>} />
            <Route path="services/new" element={<Guard need="admin"><AddServiceWizard /></Guard>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
)
