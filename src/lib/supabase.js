import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en las variables de entorno.',
  )
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})

const SESSION_MARGIN_MS = 2 * 60 * 1000

export function isAuthTokenError(error) {
  if (!error) return false
  const message = String(error.message || error).toLowerCase()
  return error.status === 401
    || error.code === 'PGRST301'
    || message.includes('jwt expired')
    || message.includes('invalid jwt')
    || message.includes('invalid refresh token')
}

export async function refreshSessionOrSignOut() {
  const { data, error } = await supabase.auth.refreshSession()

  if (error || !data?.session) {
    await supabase.auth.signOut({ scope: 'local' })
    throw new Error('Tu sesión venció. Inicia sesión nuevamente para continuar.')
  }

  return data.session
}

export async function ensureFreshSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  const session = data?.session
  if (!session) return null

  const expiresAt = Number(session.expires_at || 0) * 1000
  if (!expiresAt || expiresAt <= Date.now() + SESSION_MARGIN_MS) {
    return refreshSessionOrSignOut()
  }

  return session
}

function resultHasAuthError(result) {
  const responses = Array.isArray(result) ? result : [result]
  return responses.some((response) => isAuthTokenError(response?.error))
}

export async function runWithSessionRetry(operation) {
  await ensureFreshSession()
  let result = await operation()

  if (resultHasAuthError(result)) {
    await refreshSessionOrSignOut()
    result = await operation()
  }

  return result
}
