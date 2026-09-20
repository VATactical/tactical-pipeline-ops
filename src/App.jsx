import React, { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import ProtectedRoute from './auth/ProtectedRoute'
import AppLayout from './components/AppLayout'
import LoadingScreen from './components/LoadingScreen'
import { LanguageProvider } from './i18n/LanguageContext'

const lazyWithRetry = (importer, key) => lazy(() => {
  const retryKey = `tp-ops-chunk-retry:${key}`
  return importer()
    .then((module) => {
      window.sessionStorage.removeItem(retryKey)
      return module
    })
    .catch((error) => {
      if (!window.sessionStorage.getItem(retryKey)) {
        window.sessionStorage.setItem(retryKey, '1')
        window.location.reload()
        return new Promise(() => {})
      }
      window.sessionStorage.removeItem(retryKey)
      throw error
    })
})

const AccessDeniedPage = lazyWithRetry(() => import('./pages/AccessDeniedPage'), 'access-denied')
const DashboardPage = lazyWithRetry(() => import('./pages/DashboardPage'), 'dashboard')
const LoginPage = lazyWithRetry(() => import('./pages/LoginPage'), 'login')
const TeamPage = lazyWithRetry(() => import('./pages/TeamPage'), 'team')
const ClientsPage = lazyWithRetry(() => import('./pages/ClientsPage'), 'clients')
const ClientDetailPage = lazyWithRetry(() => import('./pages/ClientDetailPage'), 'client-detail')
const TasksPage = lazyWithRetry(() => import('./pages/TasksPage'), 'tasks')
const CalendarPage = lazyWithRetry(() => import('./pages/CalendarPage'), 'calendar')
const EodReportsPage = lazyWithRetry(() => import('./pages/EodReportsPage'), 'eod-reports')
const TrainingPage = lazyWithRetry(() => import('./pages/TrainingPage'), 'training')
const MyAccountPage = lazyWithRetry(() => import('./pages/MyAccountPage'), 'my-account')
const TeamDirectoryPage = lazyWithRetry(() => import('./pages/TeamDirectoryPage'), 'team-directory')
const CompanyPage = lazyWithRetry(() => import('./pages/CompanyPage'), 'company')
const CommunicationsPage = lazyWithRetry(() => import('./pages/CommunicationsPage'), 'communications')

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) { return { error } }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="centered-page"><div className="brand-mark large">TP</div><h2>No se pudo cargar esta página</h2><p>Actualiza una vez para sincronizar la versión más reciente.</p><button className="primary-button" type="button" onClick={() => window.location.reload()}>Reintentar</button></main>
  }
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LanguageProvider><AppErrorBoundary><Suspense fallback={<LoadingScreen />}><Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="clientes" element={<ClientsPage />} />
              <Route path="clientes/:clientId" element={<ClientDetailPage />} />
              <Route path="tareas" element={<TasksPage />} />
              <Route path="calendario" element={<CalendarPage />} />
              <Route path="comunicaciones" element={<CommunicationsPage />} />
              <Route path="training" element={<TrainingPage />} />
              <Route path="mi-cuenta" element={<MyAccountPage />} />
              <Route path="mi-equipo" element={<TeamDirectoryPage />} />
              <Route path="eod-reports" element={<EodReportsPage />} />
              <Route path="sin-acceso" element={<AccessDeniedPage />} />
              <Route element={<ProtectedRoute allowedRoles={['superadmin']} />}>
                <Route path="equipo" element={<TeamPage />} />
              </Route>
              <Route element={<ProtectedRoute allowedPermissions={['operations_admin']} />}>
                <Route path="mi-empresa" element={<CompanyPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes></Suspense></AppErrorBoundary></LanguageProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
