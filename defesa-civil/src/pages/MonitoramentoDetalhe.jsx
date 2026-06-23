import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import MonitoramentoLayout from '../components/MonitoramentoLayout'
import styles from './MonitoramentoDetalhe.module.css'
import { FiClock, FiFilePlus, FiTrendingUp, FiPhone, FiArrowRight } from 'react-icons/fi'
import { API_BASE } from '../services/api'

export default function MonitoramentoDetalhe() {
  const { id } = useParams()
  const [imovel, setImovel] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_BASE}/monitoramento/${id}`)
      .then(r => r.json())
      .then(data => { setImovel(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  if (loading) return (
    <MonitoramentoLayout>
      <div className={styles.loading}>Carregando...</div>
    </MonitoramentoLayout>
  )

  if (!imovel) return (
    <MonitoramentoLayout>
      <div className={styles.notFound}>
        <h2>Imóvel não encontrado</h2>
        <Link to="/monitoramento/imoveis">← Voltar para Imóveis</Link>
      </div>
    </MonitoramentoLayout>
  )

  const numRel = imovel.relatoriosSalvos?.length || 0
  const labelRel = numRel === 1 ? 'Relatório Registrado' : 'Relatórios Registrados'

  return (
    <MonitoramentoLayout>
      <div className={styles.back}>
        <Link to="/monitoramento/imoveis" className={styles.backLink}>← Imóveis Cadastrados</Link>
      </div>

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{imovel.proprietario}</h1>
          <p className={styles.addr}>{imovel.endereco}{imovel.cidade ? `, ${imovel.cidade}` : ''}</p>
          {imovel.celular && (
            <div className={styles.phone}><FiPhone size={14} /> {imovel.celular}</div>
          )}
        </div>
        <Link to={`/monitoramento/${id}/editar`} className={styles.btnEdit}>✏️ Editar</Link>
      </div>

      <div className={styles.grid}>
        <Link to={`/monitoramento/${id}/relatorios`} className={styles.card}>
          <div className={styles.cardTop}>
            <div>
              <h2 className={styles.cardTitle}>{numRel} {labelRel}</h2>
              <p className={styles.cardDesc}>Acesse o histórico de relatórios gerados.</p>
            </div>
            <FiClock className={styles.cardIcon} />
          </div>
          <div className={styles.cardFooter}>
            <span className={styles.cardLink}>Ver Histórico <FiArrowRight className={styles.arrow} /></span>
          </div>
        </Link>

        <Link to={`/monitoramento/${id}/novo-relatorio`} className={styles.card}>
          <div className={styles.cardTop}>
            <div>
              <h2 className={styles.cardTitle}>Novo Relatório</h2>
              <p className={styles.cardDesc}>Adicione fotos e anomalias para gerar um novo laudo.</p>
            </div>
            <FiFilePlus className={styles.cardIcon} />
          </div>
          <div className={styles.cardFooter}>
            <span className={styles.cardLink}>Iniciar Novo <FiArrowRight className={styles.arrow} /></span>
          </div>
        </Link>

        <Link to={`/monitoramento/${id}/evolucao`} className={styles.card}>
          <div className={styles.cardTop}>
            <div>
              <h2 className={styles.cardTitle}>Gráfico de Evolução</h2>
              <p className={styles.cardDesc}>Visualize a evolução das anomalias ao longo do tempo.</p>
            </div>
            <FiTrendingUp className={styles.cardIcon} />
          </div>
          <div className={styles.cardFooter}>
            <span className={styles.cardLink}>Ver Gráfico <FiArrowRight className={styles.arrow} /></span>
          </div>
        </Link>
      </div>
    </MonitoramentoLayout>
  )
}
