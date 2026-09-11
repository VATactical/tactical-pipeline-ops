import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

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
      .select('id, full_name, role, avatar_url')
      .eq('id', userId)
      .single()

    if (error) throw error
    setProfile(data)
  }, [])

  useEffect(() => {
    let active = true

    const initialize = async () => {
      const { data, error } = await supabase.auth.getSession()

      if (!active) return
      if (error) console.error('No se pudo restaurar la sesión:', error.message)

      const nextSession = data?.session ?? null
      setSession(nextSession)

      try {
        await loadProfile(nextSession?.user?.id)
      } catch (profileError) {
        console.error('No se pudo cargar el perfil:', profileError.message)
        setProfile(null)
      } finally {
        if (active) setLoading(false)
      }
    }

    initialize()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
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

    return () => {
      active = false
      subscription.unsubscribe()
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
    () => ({ session, user: session?.user ?? null, profile, loading, signIn, signOut }),
    [session, profile, loading, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}
