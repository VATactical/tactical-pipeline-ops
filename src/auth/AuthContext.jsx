import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ensureFreshSession, runWithSessionRetry, supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const profileRef = useRef(null)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      profileRef.current = null
      return
    }

    const { data, error } = await runWithSessionRetry(() => supabase
      .from('profiles')
      .select('id, full_name, role, avatar_url, last_task_seen_at, permissions, active, timezone, slack_contact, whatsapp_contact')
      .eq('id', userId)
      .single())

    if (error) throw error
    if (!data.active) {
      await supabase.auth.signOut({ scope: 'local' })
      throw new Error('Este usuario está desactivado.')
    }
    profileRef.current = data
    setProfile(data)
  }, [])

  const loadProfileResilient = useCallback(async (userId) => {
    try { await loadProfile(userId) }
    catch (firstError) {
      await new Promise((resolve) => window.setTimeout(resolve, 350))
      try { await loadProfile(userId) }
      catch { throw firstError }
    }
  }, [loadProfile])

  useEffect(() => {
    let active = true

    const clearAuthState = () => {
      setSession(null)
      setProfile(null)
      profileRef.current = null
    }

    const initialize = async () => {
      try {
        const nextSession = await ensureFreshSession()
        if (!active) return
        setSession(nextSession)
        await loadProfileResilient(nextSession?.user?.id)
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
      if (event === 'INITIAL_SESSION') return
      if (!nextSession) {
        clearAuthState()
        setLoading(false)
        return
      }

      setSession(nextSession)
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return
      const blockingLoad = !profileRef.current || profileRef.current.id !== nextSession.user.id
      if (blockingLoad) setLoading(true)

      window.setTimeout(async () => {
        try {
          await loadProfileResilient(nextSession?.user?.id)
        } catch (profileError) {
          console.error('No se pudo actualizar el perfil:', profileError.message)
          if (blockingLoad) clearAuthState()
        } finally {
          if (active && blockingLoad) setLoading(false)
        }
      }, 0)
    })

    const restoreActiveSession = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const nextSession = await ensureFreshSession()
        if (active && nextSession) {
          setSession(nextSession)
          if (!profileRef.current) {
            setLoading(true)
            await loadProfileResilient(nextSession.user.id)
            if (active) setLoading(false)
          }
        }
      } catch (sessionError) {
        console.error('La sesión ya no se pudo renovar:', sessionError.message)
        if (active) clearAuthState()
      } finally {
        if (active) setLoading(false)
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
  }, [loadProfileResilient])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, profile, loading, signIn, signOut, refreshProfile: () => loadProfileResilient(session?.user?.id) }),
    [session, profile, loading, signIn, signOut, loadProfileResilient],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}
