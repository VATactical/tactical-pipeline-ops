import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ensureFreshSession, refreshSessionOrSignOut, supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, avatar_url, last_task_seen_at, permissions, active, timezone, slack_contact, whatsapp_contact')
      .eq('id', userId)
      .single()

    if (error) throw error
    if (!data.active) {
      await supabase.auth.signOut({ scope: 'local' })
      throw new Error('Este usuario está desactivado.')
    }
    setProfile(data)
  }, [])

  useEffect(() => {
    let active = true

    const clearAuthState = () => {
      setSession(null)
      setProfile(null)
    }

    const validateSession = async () => {
      let nextSession = await ensureFreshSession()
      if (!nextSession) return null

      let { data, error } = await supabase.auth.getClaims()
      if (error || !data?.claims?.sub) {
        nextSession = await refreshSessionOrSignOut()
        ;({ data, error } = await supabase.auth.getClaims())
      }

      if (error || !data?.claims?.sub) {
        await supabase.auth.signOut({ scope: 'local' })
        throw new Error('No se pudo validar la sesión.')
      }

      return nextSession
    }

    const initialize = async () => {
      try {
        const nextSession = await validateSession()
        if (!active) return
        setSession(nextSession)
        await loadProfile(nextSession?.user?.id)
      } catch (sessionError) {
        console.error('No se pudo restaurar la sesión:', sessionError.message)
        if (active) clearAuthState()
      } finally {
        if (active) setLoading(false)
      }
    }

    initialize()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!nextSession) {
        clearAuthState()
        setLoading(false)
        return
      }

      setSession(nextSession)
      if (event === 'TOKEN_REFRESHED') return
      setLoading(true)

      window.setTimeout(async () => {
        try {
          await loadProfile(nextSession?.user?.id)
        } catch (profileError) {
          console.error('No se pudo actualizar el perfil:', profileError.message)
          setProfile(null)
        } finally {
          if (active) setLoading(false)
        }
      }, 0)
    })

    const restoreActiveSession = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const nextSession = await ensureFreshSession()
        if (active && nextSession) setSession(nextSession)
      } catch (sessionError) {
        console.error('La sesión ya no se pudo renovar:', sessionError.message)
        if (active) clearAuthState()
      }
    }

    window.addEventListener('focus', restoreActiveSession)
    document.addEventListener('visibilitychange', restoreActiveSession)

    return () => {
      active = false
      subscription.unsubscribe()
      window.removeEventListener('focus', restoreActiveSession)
      document.removeEventListener('visibilitychange', restoreActiveSession)
    }
  }, [loadProfile])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, profile, loading, signIn, signOut, refreshProfile: () => loadProfile(session?.user?.id) }),
    [session, profile, loading, signIn, signOut, loadProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}
