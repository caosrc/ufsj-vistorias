import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import MonitoramentoLayout from '../components/MonitoramentoLayout'
import styles from './MonitoramentoRelatorios.module.css'
import { FiArrowLeft, FiPlus, FiFileText, FiCalendar, FiTrash2, FiEdit2 } from 'react-icons/fi'
import { API_BASE } from '../services/api'

const SENHA = '093067'

export default function MonitoramentoRelatorios() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [imovel, setImovel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [editTarget, setEditTarget] = useState(null)
  const [editPassword, setEditPassword] = useState('')
  const [toast, setToast] = useState(null)

  const showToast = (msg, type = 'info') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000) }

  const fetchImovel = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/monitoramento/${id}`)
      setImovel(await res.json())
    } catch { showToast('Erro ao carregar', 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchImovel() }, [id])

  const getTitle = (rel) => {
    const codes = (rel.fotosAnomalias || []).map(f => f.codigoTrinca).join(', ')
    const date = new Date(rel.createdAt).toLocaleDateString('pt-BR')
    return codes ? `Relatório ${codes} - ${date}` : `Relatório ${date}`
  }

  const confirmDelete = async () => {
    if (deletePassword !== SENHA) { showToast('Senha incorreta', 'error'); return }
    try {
      await fetch(`${API_BASE}/monitoramento/${id}/relatorios/${deleteTarget.id}`, { method: 'DELETE' })
      showToast('Relatório excluído')
      fetchImovel()
    } catch { showToast('Erro ao excluir', 'error') }
    finally { setDeleteTarget(null); setDeletePassword('') }
  }

  const confirmEdit = () => {
    if (editPassword !== SENHA) { showToast('Senha incorreta', 'error'); return }
    const target = editTarget
    setEditTarget(null); setEditPassword('')
    navigate(`/monitoramento/${id}/novo-relatorio?relatorioId=${target.id}`)
  }

  if (loading) return <MonitoramentoLayout><div className={styles.loading}>Carregando...</div></MonitoramentoLayout>

  const relatorios = [...(imovel?.relatoriosSalvos || [])].reverse()

  return (
    <MonitoramentoLayout>
      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.msg}</div>}

      <div className={styles.back}>
        <Link to={`/monitoramento/${id}`} className={styles.backLink}>
          <FiArrowLeft /> Voltar para {imovel?.proprietario}
        </Link>
      </div>

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {relatorios.length} {relatorios.length === 1 ? 'Relatório Registrado' : 'Relatórios Registrados'}
          </h1>
          <p className={styles.subtitle}>{imovel?.proprietario}</p>
        </div>
        <Link to={`/monitoramento/${id}/novo-relatorio`} className={styles.btnNew}>
          <FiPlus /> Novo Relatório
        </Link>
      </div>

      {relatorios.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>📭</div>
          <h3>Nenhum relatório salvo</h3>
          <p>Crie um novo relatório para ver o histórico aqui.</p>
          <Link to={`/monitoramento/${id}/novo-relatorio`} className={styles.btnNew}><FiPlus /> Criar Primeiro Relatório</Link>
        </div>
      ) : (
        <div className={styles.grid}>
          {relatorios.map(rel => (
            <div key={rel.id} className={styles.cardWrap}>
              <div className={styles.card} onClick={() => navigate(`/monitoramento/${id}/relatorio/${rel.id}`)}>
                <div className={styles.cardTop}>
                  <FiFileText className={styles.fileIcon} />
                  <div className={styles.cardBody}>
                    <h3 className={styles.cardTitle}>{getTitle(rel)}</h3>
                    <div className={styles.cardMeta}>
                      <span><FiCalendar size={12} /> {new Date(rel.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                      <span>📷 {(rel.fotosAnomalias || []).length} anomalia(s)</span>
                      {rel.updatedAt && rel.updatedAt !== rel.createdAt && (
                        <span style={{ color: '#f59e0b' }}>✏️ editado {new Date(rel.updatedAt).toLocaleDateString('pt-BR')}</span>
                      )}
                    </div>
                  </div>
                </div>
                <button className={styles.btnView}>Ver Relatório →</button>
              </div>
              <div className={styles.cardActions}>
                <button className={styles.btnAddAnomaly}
                  onClick={() => navigate(`/monitoramento/${id}/novo-relatorio?relatorioId=${rel.id}`)}>
                  <FiPlus /> Adicionar Anomalia
                </button>
                <button className={styles.btnEdit}
                  onClick={() => { setEditTarget(rel); setEditPassword('') }}>
                  <FiEdit2 /> Editar
                </button>
                <button className={styles.btnDelete}
                  onClick={() => { setDeleteTarget(rel); setDeletePassword('') }}>
                  <FiTrash2 /> Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Diálogo Editar ── */}
      {editTarget && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <h3>✏️ Editar Relatório</h3>
            <p>Para editar <strong>{getTitle(editTarget)}</strong>, insira a senha de acesso.</p>
            <input
              className={styles.dialogInput}
              type="password"
              maxLength={6}
              value={editPassword}
              onChange={e => setEditPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmEdit() }}
              placeholder="******"
              autoFocus
            />
            <div className={styles.dialogBtns}>
              <button className={styles.btnCancel} onClick={() => { setEditTarget(null); setEditPassword('') }}>Cancelar</button>
              <button className={styles.btnEditFull} onClick={confirmEdit}>Editar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Diálogo Excluir ── */}
      {deleteTarget && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <h3>Confirmar Exclusão</h3>
            <p>Para excluir <strong>{getTitle(deleteTarget)}</strong>, insira a senha.</p>
            <input
              className={styles.dialogInput}
              type="password"
              maxLength={6}
              value={deletePassword}
              onChange={e => setDeletePassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmDelete() }}
              placeholder="******"
              autoFocus
            />
            <div className={styles.dialogBtns}>
              <button className={styles.btnCancel} onClick={() => { setDeleteTarget(null); setDeletePassword('') }}>Cancelar</button>
              <button className={styles.btnDangerFull} onClick={confirmDelete}>Excluir</button>
            </div>
          </div>
        </div>
      )}
    </MonitoramentoLayout>
  )
}
