import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PortalLayout from './PortalLayout'
import styles from './Portal.module.css'

export default function PasswordUpdate() {
  const { usuario, carregando, atualizarSenha } = useAuth()
  const navigate = useNavigate()
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (senha.length < 8) {
      setError('A nova senha precisa ter pelo menos 8 caracteres.')
      return
    }
    if (senha !== confirmacao) {
      setError('As senhas não coincidem. Confira os dois campos.')
      return
    }
    setBusy(true)
    try {
      await atualizarSenha(senha)
      setSuccess('Senha atualizada. Você já pode continuar com segurança.')
      setSenha('')
      setConfirmacao('')
    } catch (err) {
      setError(err.message || 'Não foi possível atualizar a senha. Solicite um novo link e tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  if (carregando) return <PortalLayout section="Segurança da conta"><div className={styles.loadingBox} role="status" data-testid="status-password-loading">Validando o link de acesso…</div></PortalLayout>

  return (
    <PortalLayout section="Segurança da conta" title="Uma senha nova, só sua." description="Escolha uma senha pessoal para concluir seu primeiro acesso ou recuperar sua conta.">
      <h2 className={styles.formHeading}>Definir senha</h2>
      <p className={styles.formIntro}>{usuario?.email ? `Conta: ${usuario.email}. ` : ''}A senha deve ter pelo menos 8 caracteres.</p>
      {!usuario && <div className={styles.notice} data-testid="status-password-link-note">Abra esta página pelo link enviado ao seu e-mail. Se o link expirou, solicite uma nova redefinição.</div>}
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="new-password">Nova senha</label>
          <input id="new-password" type="password" autoComplete="new-password" value={senha} onChange={(event) => setSenha(event.target.value)} minLength={8} required data-testid="input-new-password" />
        </div>
        <div className={styles.field}>
          <label htmlFor="new-password-confirm">Confirme a nova senha</label>
          <input id="new-password-confirm" type="password" autoComplete="new-password" value={confirmacao} onChange={(event) => setConfirmacao(event.target.value)} required data-testid="input-new-password-confirmation" />
        </div>
        {error && <div className={styles.error} role="alert" data-testid="status-password-error">{error}</div>}
        {success && <div className={styles.feedback} role="status" data-testid="status-password-success">{success}</div>}
        <button className={styles.button} type="submit" disabled={busy || !usuario} data-testid="button-update-password">{busy ? 'Atualizando…' : 'Salvar nova senha'}</button>
      </form>
      <div className={styles.switchLine} style={{ marginTop: 18 }}>
        {success && usuario?.role === 'resident' ? <Link className={styles.softLink} to="/morador/inicio" data-testid="link-continue-resident">Ir para minha área</Link> : null}
        {success && ['admin', 'staff'].includes(usuario?.role) ? <button type="button" className={styles.textButton} onClick={() => navigate('/dashboard')} data-testid="button-continue-staff">Continuar para o painel</button> : null}
        {!success && <Link className={styles.softLink} to={usuario?.role === 'resident' ? '/morador/acesso' : '/setores/login'} data-testid="link-back-to-sign-in">Voltar para entrar</Link>}
      </div>
    </PortalLayout>
  )
}
