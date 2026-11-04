
import { createClient } from '@supabase/supabase-js'

type DisabledSupabaseClient = {
  from: (...args: unknown[]) => any
  channel: (...args: unknown[]) => any
  removeChannel: (...args: unknown[]) => any
  functions: { invoke: (...args: unknown[]) => any }
  storage: { from: (...args: unknown[]) => any }
  auth: {
    getSession: (...args: unknown[]) => any
    onAuthStateChange: (...args: unknown[]) => any
    signInWithPassword: (...args: unknown[]) => any
    signUp: (...args: unknown[]) => any
    resetPasswordForEmail: (...args: unknown[]) => any
    updateUser: (...args: unknown[]) => any
    signOut: (...args: unknown[]) => any
  }
}

const supabaseDisabled = (): never => {
  throw new Error('Supabase está desativado nesta cópia do aplicativo.')
}

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
const supabaseAnonKey = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  '',
).trim()
const usarSupabase = String(import.meta.env.VITE_USE_SUPABASE || '').toLowerCase() === 'true'
const clienteSupabaseConfigurado = Boolean(supabaseUrl && supabaseAnonKey)

// O build do Netlify injeta essas variáveis VITE_* no frontend. No Replit,
// a autenticação usa o Supabase, mas as operações de dados continuam no Express.
export const supabaseAuthDisponivel = clienteSupabaseConfigurado
export const supabaseDisponivel = usarSupabase && clienteSupabaseConfigurado

export const supabase = clienteSupabaseConfigurado
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : ({
      from: supabaseDisabled,
      channel: supabaseDisabled,
      removeChannel: supabaseDisabled,
      functions: { invoke: supabaseDisabled },
      storage: { from: supabaseDisabled },
      auth: {
        getSession: supabaseDisabled,
        onAuthStateChange: supabaseDisabled,
        signInWithPassword: supabaseDisabled,
        signUp: supabaseDisabled,
        resetPasswordForEmail: supabaseDisabled,
        updateUser: supabaseDisabled,
        signOut: supabaseDisabled,
      },
    } as DisabledSupabaseClient)

