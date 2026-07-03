import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { AuthProvider } from './auth/AuthContext'
import RequireAuth from './components/RequireAuth'
import LoginPage from './pages/LoginPage'
import DashboardShell from './pages/DashboardShell'
import DashboardPage from './pages/DashboardPage'
import RequestsPage from './pages/RequestsPage'
import ComingSoon from './pages/ComingSoon'

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
            <Route index element={<DashboardPage />} />
            <Route path="requests" element={<RequestsPage />} />
            <Route path="requests/:id" element={<RequestsPage />} />
            <Route
              path="employees"
              element={
                <ComingSoon
                  title="Employees Management"
                  note="Not built yet — employee accounts and department management arrive in Week 6."
                />
              }
            />
            <Route
              path="reports"
              element={
                <ComingSoon
                  title="Basic Reports"
                  note="Not built yet — filtered reports and CSV export arrive in Week 6."
                />
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
