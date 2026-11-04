import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PortalLayout from './PortalLayout'
import styles from './Portal.module.css'

const initialProfile = {
  nome_completo: '',
  telefone_whatsapp: '',
  quantidade_moradores: '',
  endereco_completo: '',
  tipo_imovel: '',
  ocupacao: '',
  tempo_residencia: '',
  quantidade_criancas: '',
  quantidade_idosos: '',
  quantidade_mobilidade_reduzida: '',
}

const requiredFields = ['nome_completo', 'telefone_whatsapp', 'endereco_completo', 'tempo_residencia']
const optionalCounts = ['quantidade_criancas', 'quantidade_idosos', 'quantidade_mobilidade_reduzida']

function valueFrom(profile, key) {
  return profile?.[key] === null || profile?.[key] === undefined ? '' : String(profile[key])
}

export default function ResidentProfile() {
  const { usuario, perfilMorador, carregando, salvarPerfilMorador } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(initialProfile)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!perfilMorador) return
    setForm((current) => Object.fromEntries(
      Object.keys(initialProfile).map((key) => [key, valueFrom(perfilMorador, key) || current[key]]),
    ))
  }, [perfilMorador])

  const update = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setError('')
    setSuccess('')
  }

  const validate = () => {
    for (const field of requiredFields) {
      if (!String(form[field]).trim()) return 'Preencha todos os campos obrigatórios.'
    }
    if (!/^\d+$/.test(String(form.quantidade_moradores)) || Number(form.quantidade_moradores) < 1) {
      return 'Informe pelo menos 1 morador na residência.'
    }
    for (const field of optionalCounts) {
      if (form[field] !== '' && (!/^\d+$/.test(String(form[field])) || Number(form[field]) < 0)) {
        return 'As quantidades de crianças, idosos e pessoas com mobilidade reduzida devem ser números inteiros iguais ou maiores que zero.'
      }
    }
    if (!['casa', 'apartamento', 'barraco', 'sitio', 'outro'].includes(form.tipo_imovel)) {
      return 'Selecione o tipo de imóvel.'
    }
    if (!['proprio', 'alugado', 'cedido', 'outro'].includes(form.ocupacao)) {
      return 'Selecione a situação de ocupação do imóvel.'
    }
    return ''
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    const validationMessage = validate()
    if (validationMessage) {
      setError(validationMessage)
      return
    }
    const profile = {
      nome_completo: form.nome_completo.trim(),
      telefone_whatsapp: form.telefone_whatsapp.trim(),
      quantidade_moradores: Number(form.quantidade_moradores),
      endereco_completo: form.endereco_completo.trim(),
      tipo_imovel: form.tipo_imovel,
      ocupacao: form.ocupacao,
      tempo_residencia: form.tempo_residencia.trim(),
    }
    optionalCounts.forEach((key) => {
      if (form[key] !== '') profile[key] = Number(form[key])
    })

    setBusy(true)
    try {
      await salvarPerfilMorador(profile)
      setSuccess('Cadastro salvo. Suas informações estão atualizadas.')
      navigate('/morador/inicio')
    } catch (err) {
      setError(err.message || 'Não foi possível salvar o cadastro. Confira os dados e tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  if (carregando) return <PortalLayout section="Cadastro familiar"><div className={styles.loadingBox} role="status" data-testid="status-profile-loading">Carregando seu cadastro…</div></PortalLayout>
  if (!usuario || usuario.role !== 'resident') {
    return (
      <PortalLayout section="Cadastro familiar" title="Acesso necessário." description="Entre com uma conta de morador confirmada para preencher ou atualizar seu cadastro.">
        <h2 className={styles.formHeading}>Entre para continuar</h2>
        <p className={styles.formIntro}>O cadastro familiar é protegido e só pode ser enviado pela própria pessoa moradora.</p>
        <Link className={styles.button} to="/morador/acesso" data-testid="link-citizen-access">Ir para o acesso do cidadão</Link>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout section="Cadastro familiar" title="Conte para nós sobre sua casa." description="Essas informações ajudam as equipes a compreender melhor cada comunidade e planejar ações de prevenção.">
      <h2 className={styles.formHeading}>{perfilMorador ? 'Atualizar cadastro' : 'Cadastro da residência'}</h2>
      <p className={styles.formIntro}>Campos com * são obrigatórios. O e-mail vem da sua conta confirmada.</p>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label htmlFor="profile-name">Nome completo *</label>
            <input id="profile-name" name="nome_completo" value={form.nome_completo} onChange={update} autoComplete="name" required data-testid="input-nome-completo" />
          </div>
          <div className={styles.field}>
            <label htmlFor="profile-phone">Telefone / WhatsApp *</label>
            <input id="profile-phone" name="telefone_whatsapp" type="tel" value={form.telefone_whatsapp} onChange={update} autoComplete="tel" placeholder="(31) 90000-0000" required data-testid="input-telefone-whatsapp" />
          </div>
          <div className={styles.field}>
            <label htmlFor="profile-email">E-mail da conta</label>
            <input id="profile-email" type="email" value={usuario.email || ''} readOnly aria-readonly="true" data-testid="input-account-email" />
          </div>
          <div className={styles.field}>
            <label htmlFor="profile-residents">Quantidade de moradores *</label>
            <input id="profile-residents" name="quantidade_moradores" type="number" min="1" step="1" value={form.quantidade_moradores} onChange={update} required data-testid="input-quantidade-moradores" />
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="profile-address">Endereço completo *</label>
          <input id="profile-address" name="endereco_completo" value={form.endereco_completo} onChange={update} autoComplete="street-address" placeholder="Rua, número, bairro, cidade e referência" required data-testid="input-endereco-completo" />
        </div>

        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label htmlFor="profile-property-type">Tipo de imóvel *</label>
            <select id="profile-property-type" name="tipo_imovel" value={form.tipo_imovel} onChange={update} required data-testid="select-tipo-imovel">
              <option value="">Selecione</option>
              <option value="casa">Casa</option>
              <option value="apartamento">Apartamento</option>
              <option value="barraco">Barraco</option>
              <option value="sitio">Sítio</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="profile-occupancy">Ocupação do imóvel *</label>
            <select id="profile-occupancy" name="ocupacao" value={form.ocupacao} onChange={update} required data-testid="select-ocupacao">
              <option value="">Selecione</option>
              <option value="proprio">Próprio</option>
              <option value="alugado">Alugado</option>
              <option value="cedido">Cedido</option>
              <option value="outro">Outro</option>
            </select>
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="profile-residence-time">Há quanto tempo mora no endereço? *</label>
          <input id="profile-residence-time" name="tempo_residencia" value={form.tempo_residencia} onChange={update} placeholder="Ex.: 3 anos e 2 meses" required data-testid="input-tempo-residencia" />
        </div>

        <h3 className={styles.sectionTitle}>Composição da residência</h3>
        <p className={styles.sectionDescription}>Preenchimento opcional. Informe zero quando não houver pessoas nessa faixa.</p>
        <div className={styles.fieldGridThree}>
          <div className={styles.field}>
            <label htmlFor="profile-children">Crianças</label>
            <input id="profile-children" name="quantidade_criancas" type="number" min="0" step="1" value={form.quantidade_criancas} onChange={update} data-testid="input-quantidade-criancas" />
          </div>
          <div className={styles.field}>
            <label htmlFor="profile-elderly">Idosos</label>
            <input id="profile-elderly" name="quantidade_idosos" type="number" min="0" step="1" value={form.quantidade_idosos} onChange={update} data-testid="input-quantidade-idosos" />
          </div>
          <div className={styles.field}>
            <label htmlFor="profile-mobility">Mobilidade reduzida</label>
            <input id="profile-mobility" name="quantidade_mobilidade_reduzida" type="number" min="0" step="1" value={form.quantidade_mobilidade_reduzida} onChange={update} data-testid="input-quantidade-mobilidade-reduzida" />
          </div>
        </div>
        {error && <div className={styles.error} role="alert" data-testid="status-error">{error}</div>}
        {success && <div className={styles.feedback} role="status" data-testid="status-success">{success}</div>}
        <div className={styles.buttonRow}>
          <button type="submit" className={styles.button} disabled={busy} data-testid="button-save-profile">{busy ? 'Salvando…' : 'Salvar cadastro'}</button>
          {perfilMorador && <Link className={`${styles.button} ${styles.buttonSecondary}`} to="/morador/inicio" data-testid="link-cancel-profile">Cancelar</Link>}
        </div>
      </form>
    </PortalLayout>
  )
}
