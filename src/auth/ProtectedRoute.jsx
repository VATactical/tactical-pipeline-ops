import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import LoadingScreen from '../components/LoadingScreen'

export default function ProtectedRoute({ allowedRoles, allowedPermissions }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <LoadingScreen label="Verificando acceso…" />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />

  const hasPermissionAccess = !allowedPermissions
    || profile?.role === 'superadmin'
    || allowedPermissions.some((permission) => Boolean(profile?.permissions?.[permission]))

  if ((allowedRoles && (!profile || !allowedRoles.includes(profile.role))) || !hasPermissionAccess) {
    return <Navigate to="/sin-acceso" replace />
  }

  return <Outlet />
}
