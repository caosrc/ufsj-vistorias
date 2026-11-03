import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import MonitoramentoLayout from '../components/MonitoramentoLayout'
import styles from './Monitoramento.module.css'
import { FiArrowRight, FiTrash2, FiEdit2, FiDownload, FiFileText, FiUpload } from 'react-icons/fi'
import { api } from '../services/api'
import { exportMonitoramentosPdf } from '../services/monitoramentoExports'
import { exportMonitoramentosExcel, readMonitoramentosWorkbook } from '../services/monitoramentoSpreadsheet'
import { importMonitoramentosWorkbook } from '../services/monitoramentoImport'

export default function Monitoramento() {
  const [imoveis, setImoveis] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [toast, setToast] = useState(null)
  const [exporting, setExporting] = useState('')
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const importInputRef = useRef(null)
  const navigate = useNavigate()

  const showToast = (msg, type = 'info', duration = 3000) => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), duration)
  }

  const fetchImoveis = async () => {
    setLoading(true)
    try {
      const data = await api.getMonitoramentos()
      setImoveis(Array.isArray(data) ? data : [])
    } catch { showToast('Erro ao carregar imóveis', 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchImoveis() }, [])

  const confirmDelete = async () => {
    if (deletePassword !== '093067') { showToast('Senha incorreta', 'error'); return }
    try {
      const result = await api.deleteMonitoramento(deleteTarget.id)
      setImoveis(prev => prev.filter(i => i.id !== deleteTarget.id))
      showToast(result.offline ? 'Exclusão salva no aparelho; será sincronizada quando houver conexão.' : 'Imóvel excluído')
    } catch { showToast('Erro ao excluir', 'error') }
    finally { setDeleteTarget(null); setDeletePassword('') }
  }

  const handleExport = async format => {
    if (!imoveis.length && format !== 'excel') {
      showToast('Não há imóveis para exportar.', 'error')
      return
    }
    setExporting(format)
    await new Promise(resolve => setTimeout(resolve, 0))
    try {
      if (format === 'excel') {
        await exportMonitoramentosExcel(imoveis)
        showToast(imoveis.length
          ? 'Planilha com imóveis, relatórios, fotos e medições baixada.'
          : 'Planilha modelo baixada. Preencha os imóveis e importe o arquivo.')
      } else {
        exportMonitoramentosPdf(imoveis)
        showToast('PDF geral do monitoramento baixado.')
      }
    } catch (error) {
      console.error('[Monitoramento] Falha ao exportar:', error)
      showToast(`Não foi possível gerar o ${format === 'excel' ? 'Excel' : 'PDF'}.`, 'error')
    } finally {
      setExporting('')
    }
  }

  const handleImportFile = async event => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    setImporting(true)
    setImportProgress('Lendo planilha…')
    try {
      const workbookData = await readMonitoramentosWorkbook(file)
      const result = await importMonitoramentosWorkbook(
        workbookData,
        imoveis,
        api,
        setImportProgress
      )
      await fetchImoveis()

      const summary = `${result.created} novo(s), ${result.updated} atualizado(s), ${result.reports} relatório(s) e ${result.photos} foto(s)/medição(ões).`
      const syncNotice = result.offline
        ? ' Os dados foram guardados neste aparelho e serão sincronizados quando a conexão voltar.'
        : ''
      if (result.errors.length) {
        console.warn('[Monitoramento] Importação parcial:', result.errors)
        showToast(`Importação parcial: ${summary} ${result.errors.length} item(ns) precisam de atenção.${syncNotice}`, 'error', 8000)
      } else {
        showToast(`Importação concluída: ${summary}${syncNotice}`, 'info', 7000)
      }
    } catch (error) {
      console.error('[Monitoramento] Falha ao importar planilha:', error)
      showToast(error.message || 'Não foi possível ler a planilha.', 'error', 6000)
    } finally {
      setImporting(false)
      setImportProgress('')
    }
  }

  const filtered = imoveis.filter(i =>
    i.proprietario?.toLowerCase().includes(search.toLowerCase()) ||
    i.endereco?.toLowerCase().includes(search.toLowerCase()) ||
    i.cidade?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <MonitoramentoLayout>
      {toast && <div role="status" aria-live="polite" className={`${styles.toast} ${styles[toast.type]}`}>{toast.msg}</div>}

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Imóveis Cadastrados</h1>
          <p className={styles.subtitle}>Exporte ou importe imóveis, medidas, relatórios e fotos em uma planilha Excel.</p>
        </div>
        <div className={styles.exportActions}>
          <input
            ref={importInputRef}
            className={styles.fileInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleImportFile}
            aria-label="Selecionar planilha Excel para importar"
          />
          <button
            type="button"
            className={`${styles.exportButton} ${styles.importButton}`}
            onClick={() => importInputRef.current?.click()}
            disabled={loading || importing || Boolean(exporting)}
            title="Importa novos imóveis ou acrescenta dados aos cadastros existentes."
          >
            <FiUpload size={16}/>
            {importing ? (importProgress || 'Importando…') : 'Importar Excel'}
          </button>
          <button
            type="button"
            className={`${styles.exportButton} ${styles.exportExcel}`}
            onClick={() => handleExport('excel')}
            disabled={loading || importing || Boolean(exporting)}
          >
            <FiFileText size={16}/>
            {exporting === 'excel' ? 'Gerando Excel…' : 'Exportar Excel'}
          </button>
          <button
            type="button"
            className={`${styles.exportButton} ${styles.exportPdf}`}
            onClick={() => handleExport('pdf')}
            disabled={loading || !imoveis.length || importing || Boolean(exporting)}
          >
            <FiDownload size={16}/>
            {exporting === 'pdf' ? 'Gerando PDF…' : 'Exportar PDF'}
          </button>
        </div>
      </div>
      <p className={styles.importHint}>
        Escolha um arquivo .xlsx. As fotos ficam incorporadas; cadastros são reconhecidos pelo ID ou por proprietário e endereço, e células vazias não apagam dados. Sem imóveis, exporte para baixar o modelo.
      </p>

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
