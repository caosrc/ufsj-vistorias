import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import MonitoramentoLayout from '../components/MonitoramentoLayout'
import styles from './Monitoramento.module.css'
import { FiArrowRight, FiTrash2, FiEdit2 } from 'react-icons/fi'
import { API_BASE } from '../services/api'

export default function Monitoramento() {
  const [imoveis, setImoveis] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [toast, setToast] = useState(null)
  const navigate = useNavigate()

  const showToast = (msg, type = 'info') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000) }

  const fetchImoveis = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/monitoramento`)
      const data = await res.json()
      setImoveis(Array.isArray(data) ? data : [])
    } catch { showToast('Erro ao carregar imóveis', 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchImoveis() }, [])

  const confirmDelete = async () => {
    if (deletePassword !== '093067') { showToast('Senha incorreta', 'error'); return }
    try {
      await fetch(`${API_BASE}/monitoramento/${deleteTarget.id}`, { method: 'DELETE' })
      setImoveis(prev => prev.filter(i => i.id !== deleteTarget.id))
      showToast('Imóvel excluído')
    } catch { showToast('Erro ao excluir', 'error') }
    finally { setDeleteTarget(null); setDeletePassword('') }
  }

  const filtered = imoveis.filter(i =>
    i.proprietario?.toLowerCase().includes(search.toLowerCase()) ||
    i.endereco?.toLowerCase().includes(search.toLowerCase()) ||
    i.cidade?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <MonitoramentoLayout>
      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.msg}</div>}

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Imóveis Cadastrados</h1>
          <p className={styles.subtitle}>Imóveis cadastrados via Vistoria Residencial para monitoramento contínuo.</p>
        </div>
      </div>

      <div className={styles.searchBar}>
        <input className={styles.searchInput} value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por proprietário, endereço ou cidade..." />
      </div>

      {loading ? (
        <div className={styles.loading}>Carregando imóveis...</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>🏠</div>
          <h3>Nenhum imóvel encontrado</h3>
          <p>Cadastre imóveis clicando em "Participar do Monitoramento" na seção de Vistorias Realizadas.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map(imovel => {
            const numRel = imovel.relatoriosSalvos?.length || 0
            return (
              <div key={imovel.id} className={styles.cardWrap}>
                <Link to={`/monitoramento/${imovel.id}`} className={styles.card}>
                  <div className={styles.cardTop}>
                    <div>
                      <h3 className={styles.cardTitle}>{imovel.proprietario}</h3>
                      <p className={styles.cardAddr}>{imovel.endereco}</p>
                      <p className={styles.cardCity}>{imovel.cidade}</p>
                      {imovel.celular && <p className={styles.cardPhone}>📞 {imovel.celular}</p>}
                    </div>
                    <span className={styles.badge}>{numRel} {numRel === 1 ? 'relatório' : 'relatórios'}</span>
                  </div>
                  <div className={styles.cardDate}>{new Date(imovel.createdAt).toLocaleDateString('pt-BR')}</div>
                  <div className={styles.cardArrow}>Ver detalhes <FiArrowRight className={styles.arrowIcon} /></div>
                </Link>
                <div className={styles.cardActions}>
                  <Link to={`/monitoramento/${imovel.id}/editar`} className={styles.btnEdit}>
                    <FiEdit2 /> Editar
                  </Link>
                  <button className={styles.btnDelete} onClick={() => { setDeleteTarget(imovel); setDeletePassword('') }}>
                    <FiTrash2 /> Excluir
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {deleteTarget && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <h3>Confirmar Exclusão</h3>
            <p>Para excluir o imóvel de <strong>{deleteTarget.proprietario}</strong>, insira a senha de exclusão.</p>
            <input className={styles.dialogInput} type="password" maxLength={6} value={deletePassword}
              onChange={e => setDeletePassword(e.target.value)} placeholder="******" />
            <div className={styles.dialogBtns}>
              <button className={styles.btnCancel} onClick={() => { setDeleteTarget(null); setDeletePassword('') }}>Cancelar</button>
              <button className={styles.btnDanger} onClick={confirmDelete}>Excluir</button>
            </div>
          </div>
        </div>
      )}
    </MonitoramentoLayout>
  )
}
