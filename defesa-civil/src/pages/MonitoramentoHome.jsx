import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import MonitoramentoLayout from '../components/MonitoramentoLayout'
import styles from './MonitoramentoHome.module.css'
import { FiFolder, FiArrowRight, FiUpload, FiCheckCircle, FiTrash2, FiCloudRain, FiFile, FiRefreshCw } from 'react-icons/fi'
import { api } from '../services/api'

const PRECIP_KEY      = 'precipitacoes_csv'
const PRECIP_FILE_KEY = 'precipitacoes_csv_filename'

function parsePrecipCSV(text) {
  text = text.replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) throw new Error('CSV vazio ou inválido.')

  const delim = lines[0].includes(';') ? ';' : ','
  const headers = lines[0].split(delim).map(h => h.trim().replace(/^"|"$/g, ''))

  const dataCol = headers.findIndex(h => /^data$/i.test(h.trim()))
  if (dataCol === -1) throw new Error('Coluna "Data" não encontrada. Verifique o cabeçalho do CSV.')

  let chuvaCol = headers.findIndex(h => /chuva|precipita/i.test(h))
  if (chuvaCol === -1) chuvaCol = headers.length - 1

  const totals = {}
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(delim).map(c => c.trim().replace(/^"|"$/g, ''))
    if (cells.length <= Math.max(dataCol, chuvaCol)) continue
    const rawDate = cells[dataCol] || ''
    const rawVal  = cells[chuvaCol] || ''
    const m = rawDate.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (!m) continue
    const key = `${m[3]}-${m[2]}-${m[1]}`
    const val = parseFloat(rawVal.replace(',', '.'))
    if (!isNaN(val) && val >= 0) totals[key] = (totals[key] || 0) + val
  }

  if (Object.keys(totals).length === 0) throw new Error('Nenhum dado de precipitação encontrado. Verifique as colunas Data e Chuva (mm).')
  return totals
}

function getPrecipSummary(data) {
  const keys = Object.keys(data).sort()
  if (!keys.length) return null
  const fmt = k => { const [y, m, d] = k.split('-'); return `${d}/${m}/${y}` }
  const total = Object.values(data).reduce((a, b) => a + b, 0)
  return { days: keys.length, from: fmt(keys[0]), to: fmt(keys[keys.length - 1]), total: total.toFixed(1) }
}

export default function MonitoramentoHome() {
  const fileRef = useRef(null)
  const [importing, setImporting]   = useState(false)
  const [importMsg, setImportMsg]   = useState(null)
  const [syncing,   setSyncing]     = useState(true)

  const savedRaw  = (() => { try { return JSON.parse(localStorage.getItem(PRECIP_KEY) || 'null') } catch { return null } })()
  const savedFile = localStorage.getItem(PRECIP_FILE_KEY) || null
  const [precipData, setPrecipData] = useState(savedRaw)
  const [fileName,   setFileName]   = useState(savedFile)

  // ── Carrega do banco ao montar ──────────────────────────────
  useEffect(() => {
    setSyncing(true)
    api.getPrecipitacoes()
      .then(rec => {
        if (rec && rec.dados && Object.keys(rec.dados).length > 0) {
          setPrecipData(rec.dados)
          setFileName(rec.filename || null)
          localStorage.setItem(PRECIP_KEY, JSON.stringify(rec.dados))
          if (rec.filename) localStorage.setItem(PRECIP_FILE_KEY, rec.filename)
        }
      })
      .catch(() => { /* usa localStorage como fallback */ })
      .finally(() => setSyncing(false))
  }, [])

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    setImportMsg(null)
    try {
      const text = await file.text()
      const data = parsePrecipCSV(text)

      // 1. Salva no banco de dados
      await api.savePrecipitacoes(file.name, data)

      // 2. Atualiza localStorage como cache local
      localStorage.setItem(PRECIP_KEY, JSON.stringify(data))
      localStorage.setItem(PRECIP_FILE_KEY, file.name)

      setPrecipData(data)
      setFileName(file.name)
      const s = getPrecipSummary(data)
      setImportMsg({ type: 'ok', text: `✅ ${s.days} dias salvos no banco (${s.from} a ${s.to}) — ${s.total} mm acumulado.` })
    } catch (err) {
      setImportMsg({ type: 'erro', text: `❌ ${err.message}` })
    } finally {
      setImporting(false)
    }
  }

  const handleClear = async () => {
    try {
      await api.deletePrecipitacoes()
    } catch (_) {}
    localStorage.removeItem(PRECIP_KEY)
    localStorage.removeItem(PRECIP_FILE_KEY)
    setPrecipData(null)
    setFileName(null)
    setImportMsg({ type: 'ok', text: '🗑️ Dados de precipitação removidos.' })
  }

  const summary = precipData ? getPrecipSummary(precipData) : null

  return (
    <MonitoramentoLayout>
      <div className={styles.container}>
        <div className={styles.intro}>
          <h1 className={styles.title}>Bem-vindo ao Monitoramento</h1>
          <p className={styles.sub}>Seu painel de controle de vistorias.</p>
        </div>

        <div className={styles.grid}>
          <Link to="/monitoramento/imoveis" className={styles.card}>
            <div className={styles.cardContent}>
              <div>
                <h2 className={styles.cardTitle}>Imóveis Cadastrados</h2>
                <p className={styles.cardDesc}>Acesse e gerencie os imóveis vindos das vistorias residenciais.</p>
              </div>
              <FiFolder className={styles.cardIcon} />
            </div>
            <div className={styles.cardFooter}>
              <span className={styles.cardLink}>Ver todos <FiArrowRight className={styles.arrow} /></span>
            </div>
          </Link>

          {/* ── Card de Precipitação ── */}
          <div className={styles.precipCard}>
            <div className={styles.cardContent}>
              <div>
                <h2 className={styles.cardTitle}>
                  Precipitação (CSV)
                  {syncing && (
                    <FiRefreshCw size={12} style={{ marginLeft: 8, color: '#64748b', animation: 'spin 1s linear infinite' }} />
                  )}
                </h2>
                <p className={styles.cardDesc}>
                  Importe dados de chuva para exibir no Gráfico de Evolução das Anomalias.
                </p>
              </div>
              <FiCloudRain className={`${styles.cardIcon} ${styles.rainIcon}`} />
            </div>

            {fileName && (
              <div className={styles.precipFile}>
                <FiFile size={13} color="#0369a1" />
                <span style={{ fontSize: 12, color: '#0369a1', fontWeight: 600 }}>{fileName}</span>
                <span style={{ fontSize: 10, color: '#64748b', marginLeft: 6 }}>salvo no banco</span>
              </div>
            )}

            {summary && (
              <div className={styles.precipStatus}>
                <FiCheckCircle size={14} color="#16a34a" />
                <span>
                  <strong>{summary.days} dias</strong> importados &nbsp;·&nbsp;
                  {summary.from} a {summary.to} &nbsp;·&nbsp;
                  <strong>{summary.total} mm</strong> acumulado
                </span>
              </div>
            )}

            {importMsg && (
              <div className={`${styles.importMsg} ${importMsg.type === 'erro' ? styles.importMsgErr : styles.importMsgOk}`}>
                {importMsg.text}
              </div>
            )}

            <div className={styles.precipActions}>
              <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleFile} />
              <button
                className={styles.btnImport}
                onClick={() => { setImportMsg(null); fileRef.current?.click() }}
                disabled={importing || syncing}
              >
                <FiUpload size={13} />
                {importing ? 'Salvando...' : summary ? 'Reimportar CSV' : 'Importar CSV'}
              </button>
              {summary && (
                <button className={styles.btnClear} onClick={handleClear} title="Remover dados">
                  <FiTrash2 size={13} />
                </button>
              )}
            </div>

            <p className={styles.precipHint}>
              O CSV deve ter colunas <strong>Data</strong> (DD/MM/AAAA) e <strong>Chuva (mm)</strong>.
              Os dados são salvos no banco e ficam disponíveis em qualquer dispositivo.
            </p>
          </div>
        </div>
      </div>
    </MonitoramentoLayout>
  )
}
