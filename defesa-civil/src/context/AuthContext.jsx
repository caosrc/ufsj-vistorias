import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, supabaseDisponivel } from '../operacional/supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [carregando, setCarregando] = useState(supabaseDisponivel)

  useEffect(() => {
    if (!supabaseDisponivel) {
      setCarregando(false)
      return undefined
    }

    let ativo = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!ativo) return
      setSession(nextSession)
      setCarregando(false)
    })

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!ativo) return
        setSession(error ? null : data.session)
        setCarregando(false)
      })
      .catch(() => {
        if (!ativo) return
        setSession(null)
        setCarregando(false)
      })

    return () => {
      ativo = false
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(() => ({
    autenticado: supabaseDisponivel ? Boolean(session) : true,
    carregando,
    usuario: session?.user ?? null,
    login: async (email, senha) => {
      if (!supabaseDisponivel) {
        try {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, senha }),
          })
          return response.ok
        } catch {
          return false
        }
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: senha,
      })
      return !error
    },
    logout: async () => {
      if (supabaseDisponivel) await supabase.auth.signOut()
      setSession(null)
    },
  }), [carregando, session])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
