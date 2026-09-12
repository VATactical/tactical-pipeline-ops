import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import ProtectedRoute from './auth/ProtectedRoute'
import AppLayout from './components/AppLayout'
import LoadingScreen from './components/LoadingScreen'
import { LanguageProvider } from './i18n/LanguageContext'

const AccessDeniedPage = lazy(() => import('./pages/AccessDeniedPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const TeamPage = lazy(() => import('./pages/TeamPage'))
const ClientsPage = lazy(() => import('./pages/ClientsPage'))
const ClientDetailPage = lazy(() => import('./pages/ClientDetailPage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const EodReportsPage = lazy(() => import('./pages/EodReportsPage'))
const TrainingPage = lazy(() => import('./pages/TrainingPage'))
const MyAccountPage = lazy(() => import('./pages/MyAccountPage'))
const TeamDirectoryPage = lazy(() => import('./pages/TeamDirectoryPage'))
const CompanyPage = lazy(() => import('./pages/CompanyPage'))

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LanguageProvider><Suspense fallback={<LoadingScreen />}><Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="clientes" element={<ClientsPage />} />
              <Route path="clientes/:clientId" element={<ClientDetailPage />} />
              <Route path="tareas" element={<TasksPage />} />
              <Route path="calendario" element={<CalendarPage />} />
              <Route path="training" element={<TrainingPage />} />
              <Route path="mi-cuenta" element={<MyAccountPage />} />
              <Route path="mi-equipo" element={<TeamDirectoryPage />} />
              <Route path="eod-reports" element={<EodReportsPage />} />
              <Route path="sin-acceso" element={<AccessDeniedPage />} />
              <Route element={<ProtectedRoute allowedRoles={['superadmin']} />}>
                <Route path="equipo" element={<TeamPage />} />
                <Route path="mi-empresa" element={<CompanyPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes></Suspense></LanguageProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
