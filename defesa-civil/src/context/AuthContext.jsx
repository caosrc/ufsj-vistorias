import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  API_BASE,
  AUTH_EXPIRED_EVENT,
  fetchApi,
  getAppAccessToken,
  setAppAccessToken,
  syncPendingOperations,
} from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let ativo = true
    const handleExpired = () => {
      if (!ativo) return
      setAppAccessToken(null)
      setSession(null)
      setCarregando(false)
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired)

    if (!getAppAccessToken()) {
      setCarregando(false)
      return () => {
        ativo = false
        window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired)
      }
    }

    fetchApi(`${API_BASE}/auth/session`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Sessão expirada.')
        return response.json()
      })
      .then((data) => {
        if (ativo) setSession({ user: data.user })
      })
      .catch(() => {
        setAppAccessToken(null)
        if (!ativo) return
        setSession(null)
      })
      .finally(() => {
        if (!ativo) return
        setCarregando(false)
      })

    return () => {
      ativo = false
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired)
    }
  }, [])

  const value = useMemo(() => ({
    autenticado: Boolean(session),
    carregando,
    usuario: session?.user ?? null,
    login: async (nome, senha) => {
      try {
        const response = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome, senha }),
        })
        if (!response.ok) return false
        const data = await response.json()
        setAppAccessToken(data.accessToken)
        setSession({ user: data.user })
        setTimeout(() => {
          syncPendingOperations().catch((error) => {
            console.error('Falha ao sincronizar alterações pendentes:', error)
          })
        }, 0)
        return true
      } catch {
        return false
      }
    },
    logout: async () => {
      try {
        await fetchApi(`${API_BASE}/auth/logout`, { method: 'POST' })
      } catch {}
      setAppAccessToken(null)
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
