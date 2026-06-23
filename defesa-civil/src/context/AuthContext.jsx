import { createContext, useContext } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  return (
    <AuthContext.Provider value={{ autenticado: true, login: async () => true, logout: () => {} }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
