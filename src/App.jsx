import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import ProtectedRoute from './auth/ProtectedRoute'
import AppLayout from './components/AppLayout'
import AccessDeniedPage from './pages/AccessDeniedPage'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import TeamPage from './pages/TeamPage'
import ClientsPage from './pages/ClientsPage'
import ClientDetailPage from './pages/ClientDetailPage'
import TasksPage from './pages/TasksPage'
import ClientCreatePage from './pages/ClientCreatePage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="clientes" element={<ClientsPage />} />
              <Route path="clientes/nuevo" element={<ClientCreatePage />} />
              <Route path="clientes/:clientId" element={<ClientDetailPage />} />
              <Route path="tareas" element={<TasksPage />} />
              <Route path="sin-acceso" element={<AccessDeniedPage />} />
              <Route element={<ProtectedRoute allowedRoles={['superadmin']} />}>
                <Route path="equipo" element={<TeamPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
