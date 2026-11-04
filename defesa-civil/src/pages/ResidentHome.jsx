import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PortalLayout from './PortalLayout'
import styles from './Portal.module.css'

const fieldLabels = {
  telefone_whatsapp: 'Telefone / WhatsApp',
  quantidade_moradores: 'Pessoas na residência',
  endereco_completo: 'Endereço',
  tipo_imovel: 'Tipo de imóvel',
  ocupacao: 'Ocupação',
  tempo_residencia: 'Tempo no endereço',
  quantidade_criancas: 'Crianças',
  quantidade_idosos: 'Idosos',
  quantidade_mobilidade_reduzida: 'Pessoas com mobilidade reduzida',
}

const labelValues = {
  casa: 'Casa', apartamento: 'Apartamento', barraco: 'Barraco', sitio: 'Sítio', outro: 'Outro',
  proprio: 'Próprio', alugado: 'Alugado', cedido: 'Cedido',
}

function displayValue(key, value) {
  if (value === null || value === undefined || value === '') return 'Não informado'
  return labelValues[value] || String(value)
}

export default function ResidentHome() {
  const { usuario, perfilMorador, carregando, erroSessao, recarregarPerfilMorador, sair } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleSignOut = async () => {
    setBusy(true)
    setError('')
    try {
      await sair()
      navigate('/morador/acesso')
    } catch (err) {
      setError(err.message || 'Não foi possível encerrar sua sessão.')
    } finally {
      setBusy(false)
    }
  }

  const handleReload = async () => {
    setError('')
    try {
      await recarregarPerfilMorador()
    } catch (err) {
      setError(err.message || 'Não foi possível atualizar as informações.')
    }
  }

  if (carregando) return <PortalLayout section="Minha área"><div className={styles.loadingBox} role="status" data-testid="status-home-loading">Carregando sua área…</div></PortalLayout>
  if (!usuario || usuario.role !== 'resident') {
    return (
      <PortalLayout section="Minha área" title="Entre para acessar seu cadastro." description="Suas informações familiares ficam disponíveis apenas na sua área protegida.">
        <h2 className={styles.formHeading}>Acesso do cidadão</h2>
        <p className={styles.formIntro}>Entre com seu e-mail confirmado para consultar o cadastro.</p>
        <Link className={styles.button} to="/morador/acesso" data-testid="link-citizen-access">Entrar no portal</Link>
      </PortalLayout>
    )
  }

  const populated = perfilMorador && Object.keys(perfilMorador).length > 0
  const rows = populated ? Object.entries(fieldLabels).filter(([key]) => Object.hasOwn(perfilMorador, key)) : []

  return (
    <PortalLayout section="Minha área" title="Sua família, sempre em foco." description="Consulte suas informações e mantenha o cadastro atualizado para apoiar o trabalho preventivo da Defesa Civil.">
      <div className={styles.inlineActions}>
        <div>
          <h2 className={styles.formHeading}>Olá, {perfilMorador?.nome_completo?.split(' ')[0] || 'morador'}.</h2>
          <p className={styles.formIntro}>Área do cidadão · {usuario.email}</p>
        </div>
        <button type="button" className={styles.textButton} onClick={handleReload} data-testid="button-refresh-profile">Atualizar dados</button>
      </div>
      {erroSessao && <div className={styles.error} role="alert" data-testid="status-session-error">{erroSessao}</div>}
      {error && <div className={styles.error} role="alert" data-testid="status-error">{error}</div>}

      {!populated ? (
        <div className={styles.notice} data-testid="status-profile-empty">
          <h3 className={styles.sectionTitle}>Seu cadastro ainda não foi preenchido</h3>
          <p>Conte um pouco sobre sua residência. Leva poucos minutos e ajuda a Defesa Civil a conhecer as necessidades da comunidade.</p>
          <div className={styles.spacer} />
          <Link className={styles.button} to="/morador/perfil" data-testid="link-create-profile">Preencher cadastro familiar</Link>
        </div>
      ) : (
        <>
          <div className={styles.profileWelcome}>
            <strong>Cadastro familiar</strong>
            <span>Últimas informações salvas na sua conta.</span>
          </div>
          <div className={styles.profileSummary} data-testid="profile-summary">
            <div className={styles.summaryGroup}>Contato e residência</div>
            <div className={styles.summaryRow}><span className={styles.summaryLabel}>E-mail</span><span className={styles.summaryValue} data-testid="text-account-email">{usuario.email}</span></div>
            <div className={styles.summaryRow}><span className={styles.summaryLabel}>Nome completo</span><span className={styles.summaryValue} data-testid="text-profile-name">{perfilMorador.nome_completo || 'Não informado'}</span></div>
            {rows.slice(0, 5).map(([key, label]) => (
              <div className={styles.summaryRow} key={key} data-testid={`row-profile-${key}`}>
                <span className={styles.summaryLabel}>{label}</span>
                <span className={styles.summaryValue}>{displayValue(key, perfilMorador[key])}</span>
              </div>
            ))}
            <div className={styles.summaryGroup}>Composição familiar</div>
            {rows.slice(5).map(([key, label]) => (
              <div className={styles.summaryRow} key={key} data-testid={`row-profile-${key}`}>
                <span className={styles.summaryLabel}>{label}</span>
                <span className={styles.summaryValue}>{displayValue(key, perfilMorador[key])}</span>
              </div>
            ))}
          </div>
          <div className={styles.buttonRow}>
            <Link className={styles.button} to="/morador/perfil" data-testid="link-edit-profile">Editar cadastro</Link>
            <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={handleSignOut} disabled={busy} data-testid="button-sign-out">{busy ? 'Saindo…' : 'Sair da conta'}</button>
          </div>
        </>
      )}
      {!populated && <div className={styles.formBottom} style={{ marginTop: 18 }}><button type="button" className={styles.textButton} onClick={handleSignOut} disabled={busy} data-testid="button-sign-out">{busy ? 'Saindo…' : 'Sair da conta'}</button></div>}
    </PortalLayout>
  )
}
