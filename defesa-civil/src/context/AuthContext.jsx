import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, supabaseAuthDisponivel } from '../operacional/supabaseClient'
import {
  closeServerSession,
  getResidentProfile,
  getServerSession,
  inviteStaff as inviteStaffRequest,
  openServerSession,
  saveResidentProfile,
} from '../services/authApi'
import { clearOfflineStorage, getPendingSyncCount, syncPendingOperations } from '../services/offlineStorage'

const AuthContext = createContext(null)

function mensagemErro(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null)
  const [perfilMorador, setPerfilMorador] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erroSessao, setErroSessao] = useState('')
  const tokenProcessado = useRef('')
  const usuarioAtual = useRef(null)

  const carregarPerfilMorador = useCallback(async (role) => {
    if (role !== 'resident') {
      setPerfilMorador(null)
      return null
    }
    const data = await getResidentProfile()
    setPerfilMorador(data.profile || null)
    return data.profile || null
  }, [])

  const estabelecerSessao = useCallback(async (session) => {
    if (!session?.access_token) return null
    if (tokenProcessado.current === session.access_token) return usuarioAtual.current

    tokenProcessado.current = session.access_token
    setCarregando(true)
    setErroSessao('')
    try {
      const data = await openServerSession(session.access_token)
      setUsuario(data.user)
      usuarioAtual.current = data.user
      await carregarPerfilMorador(data.user.role)
      if (['admin', 'staff'].includes(data.user.role)) {
        syncPendingOperations().catch((error) => {
          console.error('Falha ao sincronizar alterações pendentes:', error)
        })
      }
      return data.user
    } catch (error) {
      tokenProcessado.current = ''
      setUsuario(null)
      usuarioAtual.current = null
      setPerfilMorador(null)
      setErroSessao(mensagemErro(error, 'Não foi possível validar sua conta.'))
      throw error
    } finally {
      setCarregando(false)
    }
  }, [carregarPerfilMorador])

  useEffect(() => {
    let ativo = true
    if (!supabaseAuthDisponivel) {
      setErroSessao('A autenticação do Supabase ainda não foi configurada.')
      setCarregando(false)
      return undefined
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!ativo) return
      if (session) {
        setTimeout(() => {
          if (ativo) estabelecerSessao(session).catch(() => {})
        }, 0)
      } else if (event === 'SIGNED_OUT') {
        tokenProcessado.current = ''
        setUsuario(null)
        usuarioAtual.current = null
        setPerfilMorador(null)
        setCarregando(false)
        closeServerSession().catch(() => {})
      }
    })

    supabase.auth.getSession()
      .then(async ({ data, error }) => {
        if (error) throw error
        if (data.session) {
          await estabelecerSessao(data.session)
        } else if (ativo) {
          await closeServerSession().catch(() => {})
          setUsuario(null)
          usuarioAtual.current = null
          setCarregando(false)
        }
      })
      .catch((error) => {
        if (!ativo) return
        closeServerSession().catch(() => {})
        setErroSessao(mensagemErro(error, 'Não foi possível abrir sua sessão.'))
        setCarregando(false)
      })

    return () => {
      ativo = false
      subscription.unsubscribe()
    }
  }, [estabelecerSessao])

  const value = useMemo(() => ({
    usuario,
    perfilMorador,
    carregando,
    erroSessao,
    autenticado: Boolean(usuario),
    cadastrarConta: async (email, senha) => {
      if (!supabaseAuthDisponivel) throw new Error('A autenticação ainda não foi configurada.')
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password: senha,
        options: { emailRedirectTo: `${window.location.origin}/` },
      })
      if (error) throw error
      if (data.session) {
        await supabase.auth.signOut()
        throw new Error('Ative a confirmação de e-mail no Supabase antes de liberar novos cadastros.')
      }
      return { email: data.user?.email || email }
    },
    login: async (email, senha) => {
      if (!supabaseAuthDisponivel) throw new Error('A autenticação ainda não foi configurada.')
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: senha,
      })
      if (error) throw error
      return estabelecerSessao(data.session)
    },
    sair: async () => {
      const pendentes = usuario && ['admin', 'staff'].includes(usuario.role)
        ? await getPendingSyncCount()
        : 0
      if (pendentes > 0) {
        const sync = await syncPendingOperations()
        if (sync.pending > 0) {
          throw new Error('Há alterações offline pendentes. Conecte-se à internet e sincronize antes de sair.')
        }
      }
      await closeServerSession()
      await supabase.auth.signOut()
      await clearOfflineStorage()
      tokenProcessado.current = ''
      setUsuario(null)
      usuarioAtual.current = null
      setPerfilMorador(null)
    },
    recarregarPerfilMorador: () => carregarPerfilMorador(usuario?.role),
    salvarPerfilMorador: async (profile) => {
      const data = await saveResidentProfile(profile)
      setPerfilMorador(data.profile)
      return data.profile
    },
    enviarConviteServidor: async (email) => inviteStaffRequest(
      email.trim().toLowerCase(),
      `${window.location.origin}/setores/definir-senha`,
    ),
    solicitarRedefinicaoSenha: async (email) => {
      if (!supabaseAuthDisponivel) throw new Error('A autenticação ainda não foi configurada.')
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      })
      if (error) throw error
    },
    atualizarSenha: async (senha) => {
      if (!supabaseAuthDisponivel) throw new Error('A autenticação ainda não foi configurada.')
      const { error } = await supabase.auth.updateUser({ password: senha })
      if (error) throw error
    },
  }), [usuario, perfilMorador, carregando, erroSessao, estabelecerSessao, carregarPerfilMorador])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider.')
  return context
}
