import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PortalLayout from './PortalLayout'
import styles from './Portal.module.css'

export default function StaffInvites() {
  const { usuario, carregando, enviarConviteServidor } = useAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    const cleanEmail = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Informe um e-mail válido para o convite.')
      return
    }
    setBusy(true)
    try {
      const result = await enviarConviteServidor(cleanEmail)
      setSuccess(`Convite enviado para ${result.email || cleanEmail}. A pessoa receberá um link para definir a primeira senha.`)
      setEmail('')
    } catch (err) {
      setError(err.message || 'Não foi possível enviar o convite. Verifique sua permissão e tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  if (carregando) return <PortalLayout section="Convites da equipe"><div className={styles.loadingBox} role="status" data-testid="status-invites-loading">Verificando permissões…</div></PortalLayout>
  if (!usuario || usuario.role !== 'admin') {
    return (
      <PortalLayout section="Convites da equipe" title="Acesso reservado à administração." description="A inclusão de profissionais é feita por uma pessoa administradora autorizada.">
        <div className={styles.error} role="alert" data-testid="status-admin-required">Esta tela é exclusiva para contas com perfil de administração.</div>
        <div className={styles.spacer} />
        <p className={styles.formIntro}>Se você precisa de acesso à equipe, solicite um convite à administração municipal.</p>
        <Link className={styles.button} to="/setores/login" data-testid="link-staff-login">Ir para acesso da equipe</Link>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout section="Convites da equipe" title="Convide quem cuida do território." description="O acesso à equipe deve ser pessoal e destinado a profissionais autorizados.">
      <h2 className={styles.formHeading}>Convidar profissional</h2>
      <p className={styles.formIntro}>Enviaremos um link seguro para definir a primeira senha. O convite deve usar o e-mail da própria pessoa.</p>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="invite-email">E-mail do profissional</label>
          <input id="invite-email" type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(''); setSuccess('') }} placeholder="nome@prefeitura.gov.br" required data-testid="input-invite-email" />
        </div>
        <div className={styles.notice}>O link de definição de senha é enviado pelo sistema. Não compartilhe credenciais entre profissionais.</div>
        {error && <div className={styles.error} role="alert" data-testid="status-invite-error">{error}</div>}
        {success && <div className={styles.feedback} role="status" data-testid="status-invite-success">{success}</div>}
        <button className={styles.button} type="submit" disabled={busy} data-testid="button-send-invite">{busy ? 'Enviando convite…' : 'Enviar convite'}</button>
      </form>
      <div className={styles.switchLine} style={{ marginTop: 18 }}>Conta administrativa: {usuario.email}</div>
    </PortalLayout>
  )
}
