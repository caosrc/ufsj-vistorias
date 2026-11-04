import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PortalLayout from './PortalLayout'
import styles from './Portal.module.css'

export default function StaffLogin() {
  const { login, sair, carregando, usuario } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('socrates.resende@gmail.com')
  const [senha, setSenha] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    if (!email.trim() || !senha) {
      setError('Informe seu e-mail institucional e sua senha.')
      return
    }
    setBusy(true)
    try {
      const user = await login(email.trim(), senha)
      if (!['admin', 'staff'].includes(user?.role)) {
        try { await sair() } catch {}
        setError('Esta conta é de morador e não está autorizada para acesso da equipe. Entre pelo portal do cidadão ou solicite um convite administrativo.')
        return
      }
      navigate('/dashboard')
    } catch (err) {
      setError(err.message || 'Não foi possível entrar. Confira seus dados e tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  if (carregando) return <PortalLayout section="Acesso administrativo"><div className={styles.loadingBox} role="status" data-testid="status-session-loading">Verificando sua sessão…</div></PortalLayout>
  if (usuario && ['admin', 'staff'].includes(usuario.role)) {
    return (
      <PortalLayout section="Acesso administrativo" title="Acesso autorizado." description="Sua sessão está pronta para continuar no ambiente municipal.">
        <h2 className={styles.formHeading}>Sessão já iniciada</h2>
        <p className={styles.formIntro}>Você está conectado como {usuario.email}.</p>
        <Link className={styles.button} to="/dashboard" data-testid="link-staff-dashboard">Ir para o painel</Link>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout section="Acesso administrativo" title="Entre no ambiente SISMAR." description="Acesso reservado ao administrador e à equipe autorizada da Defesa Civil municipal.">
      <h2 className={styles.formHeading}>Entrar como administrador ou equipe</h2>
      <p className={styles.formIntro}>Use o e-mail e a senha da sua conta autorizada.</p>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="staff-email">E-mail</label>
          <input id="staff-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@prefeitura.gov.br" required data-testid="input-staff-email" />
        </div>
        <div className={styles.field}>
          <label htmlFor="staff-password">Senha</label>
          <input id="staff-password" type="password" autoComplete="current-password" value={senha} onChange={(event) => setSenha(event.target.value)} required data-testid="input-staff-password" />
        </div>
        {error && <div className={styles.error} role="alert" data-testid="status-staff-error">{error}</div>}
        <button className={styles.button} type="submit" disabled={busy} data-testid="button-staff-sign-in">{busy ? 'Validando acesso…' : 'Entrar no ambiente da equipe'}</button>
        <div className={styles.inlineActions}>
          <Link className={styles.softLink} to="/redefinir-senha" data-testid="link-staff-reset-password">Redefinir senha</Link>
          <Link className={styles.softLink} to="/morador/acesso" data-testid="link-citizen-portal">Portal do cidadão</Link>
        </div>
      </form>
    </PortalLayout>
  )
}
