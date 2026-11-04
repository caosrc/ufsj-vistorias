import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PortalLayout from './PortalLayout'
import styles from './Portal.module.css'

export default function CitizenAccess() {
  const { usuario, carregando, cadastrarConta, login, solicitarRedefinicaoSenha } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mode, setMode] = useState(location.pathname === '/morador/cadastro' ? 'register' : 'login')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [confirmationEmail, setConfirmationEmail] = useState('')

  const setPageMode = (nextMode) => {
    setMode(nextMode)
    setError('')
    setSuccess('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    const cleanEmail = email.trim()
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Informe um endereço de e-mail válido.')
      return
    }
    if (mode === 'reset') {
      setBusy(true)
      try {
        await solicitarRedefinicaoSenha(cleanEmail)
        setSuccess('Se houver uma conta com este endereço, enviaremos um link para redefinir a senha.')
      } catch (err) {
        setError(err.message || 'Não foi possível solicitar a redefinição agora.')
      } finally {
        setBusy(false)
      }
      return
    }
    if (senha.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }
    if (mode === 'register' && senha !== confirmacao) {
      setError('As senhas não coincidem. Confira os dois campos.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'register') {
        const result = await cadastrarConta(cleanEmail, senha)
        setConfirmationEmail(result.email || cleanEmail)
        setSenha('')
        setConfirmacao('')
        setMode('confirmation')
      } else {
        const user = await login(cleanEmail, senha)
        if (user?.role !== 'resident') {
          setError('Esta conta não tem acesso ao portal do cidadão. Use o acesso de servidores.')
          return
        }
        navigate('/morador/inicio')
      }
    } catch (err) {
      setError(err.message || 'Não foi possível concluir o acesso. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  if (carregando) {
    return <PortalLayout section="Portal do cidadão"><div className={styles.loadingBox} role="status" data-testid="status-session-loading">Verificando sua sessão com segurança…</div></PortalLayout>
  }

  if (usuario?.role === 'resident') {
    return (
      <PortalLayout section="Portal do cidadão" title="Que bom ter você por aqui." description="Sua área de morador está pronta para continuar.">
        <h2 className={styles.formHeading}>Acesso à sua área</h2>
        <p className={styles.formIntro}>Você já está conectado como {usuario.email}.</p>
        <div className={styles.buttonRow}>
          <Link className={styles.button} to="/morador/inicio" data-testid="link-resident-home">Ir para minha área</Link>
          <Link className={`${styles.button} ${styles.buttonSecondary}`} to="/morador/perfil" data-testid="link-resident-profile">Cadastro familiar</Link>
        </div>
      </PortalLayout>
    )
  }

  if (mode === 'confirmation') {
    return (
      <PortalLayout section="Confirmação de e-mail" title="Um passo simples para começar." description="Confirme seu endereço para que possamos manter seu cadastro protegido.">
        <div className={styles.notice} role="status" data-testid="status-email-confirmation">
          <h2 className={styles.formHeading}>Confira sua caixa de entrada</h2>
          <p>Enviamos um link de confirmação para <strong>{confirmationEmail}</strong>. Abra a mensagem e confirme o endereço antes de entrar e preencher seu cadastro familiar.</p>
        </div>
        <p className={styles.formIntro} style={{ marginTop: 18 }}>Não encontrou? Confira também a pasta de spam. Depois da confirmação, volte para entrar.</p>
        <button type="button" className={styles.button} onClick={() => setPageMode('login')} data-testid="button-back-to-login">Voltar para entrar</button>
      </PortalLayout>
    )
  }

  const isRegister = mode === 'register'
  const isReset = mode === 'reset'

  return (
    <PortalLayout
      section={isReset ? 'Recuperação de acesso' : 'Portal do cidadão'}
      title={isRegister ? 'Sua realidade ajuda a proteger a comunidade.' : 'Cuidado público começa com confiança.'}
      description={isRegister ? 'Crie seu acesso para compartilhar informações da sua família com a Defesa Civil.' : 'Entre para consultar e manter atualizadas as informações da sua residência.'}
    >
      <h2 className={styles.formHeading}>{isReset ? 'Redefinir senha' : isRegister ? 'Criar acesso de morador' : 'Entrar na minha área'}</h2>
      <p className={styles.formIntro}>{isReset ? 'Enviaremos as orientações para o e-mail cadastrado.' : 'Use seu e-mail pessoal. Seus dados ficam vinculados à sua conta.'}</p>

      {!isReset && (
        <div className={styles.authTabs} role="tablist" aria-label="Tipo de acesso">
          <button type="button" role="tab" aria-selected={!isRegister} className={`${styles.tab} ${!isRegister ? styles.tabActive : ''}`} onClick={() => setPageMode('login')} data-testid="tab-sign-in">Entrar</button>
          <button type="button" role="tab" aria-selected={isRegister} className={`${styles.tab} ${isRegister ? styles.tabActive : ''}`} onClick={() => setPageMode('register')} data-testid="tab-register">Criar conta</button>
        </div>
      )}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="citizen-email">E-mail</label>
          <input id="citizen-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@exemplo.com.br" required data-testid="input-email" />
        </div>
        {!isReset && (
          <div className={styles.field}>
            <label htmlFor="citizen-password">Senha</label>
            <input id="citizen-password" type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} value={senha} onChange={(event) => setSenha(event.target.value)} placeholder="Pelo menos 8 caracteres" required minLength={8} data-testid="input-password" />
            {isRegister && <span className={styles.fieldHint}>Use pelo menos 8 caracteres.</span>}
          </div>
        )}
        {isRegister && (
          <div className={styles.field}>
            <label htmlFor="citizen-password-confirm">Confirme a senha</label>
            <input id="citizen-password-confirm" type="password" autoComplete="new-password" value={confirmacao} onChange={(event) => setConfirmacao(event.target.value)} placeholder="Digite a senha novamente" required data-testid="input-password-confirmation" />
          </div>
        )}
        {error && <div className={styles.error} role="alert" data-testid="status-error">{error}</div>}
        {success && <div className={styles.feedback} role="status" data-testid="status-success">{success}</div>}
        <button className={styles.button} type="submit" disabled={busy} data-testid="button-submit">
          {busy ? 'Aguarde…' : isReset ? 'Enviar instruções' : isRegister ? 'Criar minha conta' : 'Entrar'}
        </button>
        {isReset ? (
          <div className={styles.switchLine}><button type="button" className={styles.textButton} onClick={() => setPageMode('login')} data-testid="button-reset-back">Voltar para entrar</button></div>
        ) : (
          <div className={styles.inlineActions}>
            {!isRegister && <button type="button" className={styles.textButton} onClick={() => setPageMode('reset')} data-testid="button-forgot-password">Esqueci minha senha</button>}
            {isRegister && <span className={styles.fieldHint}>Após criar a conta, você receberá um e-mail de confirmação.</span>}
          </div>
        )}
      </form>
      <div className={styles.switchLine} style={{ marginTop: 18 }}>
        Acesso de servidor?
        <Link className={styles.softLink} to="/setores/login" data-testid="link-staff-login">Entrar como equipe municipal</Link>
      </div>
    </PortalLayout>
  )
}
