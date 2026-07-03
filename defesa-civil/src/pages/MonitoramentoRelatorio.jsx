import { useState, useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import MonitoramentoLayout from '../components/MonitoramentoLayout'
import CrackMapper2D, { calcCorrelacao } from '../components/CrackMapper2D'
import LocalizacaoEdificacao from '../components/LocalizacaoEdificacao'
import styles from './MonitoramentoRelatorio.module.css'
import { API_BASE } from '../services/api'

export default function MonitoramentoRelatorio() {
  const { id, relId } = useParams()
  const [imovel, setImovel] = useState(null)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const printRef = useRef(null)

  const [editMode,     setEditMode]     = useState(false)
  const [editDate,     setEditDate]     = useState('')
  const [editMeasures, setEditMeasures] = useState({})
  const [editSaving,   setEditSaving]   = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/monitoramento/${id}`)
      .then(r => r.json())
      .then(data => {
        setImovel(data)
        setReport(data.relatoriosSalvos?.find(r => r.id === relId) || null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id, relId])

  const toDatetimeLocal = iso => {
    try {
      const d = new Date(iso)
      const pad = n => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    } catch { return '' }
  }

  const startEdit = () => {
    setEditDate(toDatetimeLocal(report.createdAt))
    const measures = {}
    report.fotosAnomalias?.forEach(foto => {
      foto.linhas?.forEach(line => {
        measures[`${foto.id}_${line.id}`] = [...(line.comprimentos?.length ? line.comprimentos : [0, 0, 0])]
      })
    })
    setEditMeasures(measures)
    setEditMode(true)
  }

  const setMeasureVal = (fotoId, lineId, idx, val) => {
    const key = `${fotoId}_${lineId}`
    setEditMeasures(prev => {
      const arr = [...(prev[key] || [0, 0, 0])]
      arr[idx] = parseFloat(val) || 0
      return { ...prev, [key]: arr }
    })
  }

  const getEditAvg = (fotoId, lineId) => {
    const vals = editMeasures[`${fotoId}_${lineId}`] || []
    const valid = vals.filter(v => typeof v === 'number' && !isNaN(v) && v > 0)
    if (!valid.length) return '—'
    return (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2).replace('.', ',')
  }

  const saveEdit = async () => {
    setEditSaving(true)
    try {
      const newDate = editDate ? new Date(editDate).toISOString() : report.createdAt
      const res = await fetch(`${API_BASE}/monitoramento/${id}/relatorio/${relId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createdAt: newDate, medicoes: editMeasures }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Erro ${res.status}`)
      }
      // Aplica as mudanças localmente, preservando todas as fotos do estado atual
      // (evita depender do response do servidor que pode ter fotos grandes em base64)
      setReport(prev => ({
        ...prev,
        createdAt: newDate,
        fotosAnomalias: (prev.fotosAnomalias || []).map(foto => ({
          ...foto,
          linhas: (foto.linhas || []).map(line => {
            const key = `${foto.id}_${line.id}`
            return editMeasures[key] !== undefined
              ? { ...line, comprimentos: editMeasures[key] }
              : line
          })
        }))
      }))
      setEditMode(false)
    } catch (err) {
      alert('Erro ao salvar: ' + (err.message || 'Tente novamente.'))
    } finally {
      setEditSaving(false)
    }
  }

  const handlePrint = () => {
    const orig = document.title
    document.title = `Relatório - ${imovel?.proprietario}`
    window.print()
    document.title = orig
  }

  if (loading) return <MonitoramentoLayout><div className={styles.loading}>Carregando...</div></MonitoramentoLayout>

  if (!imovel || !report) return (
    <MonitoramentoLayout>
      <div className={styles.notFound}>
        <h2>Relatório não encontrado</h2>
        <Link to={`/monitoramento/${id}/relatorios`}>← Voltar</Link>
      </div>
    </MonitoramentoLayout>
  )

  const getPointById = (foto, pid) => foto.pontos?.find(p => p.id === pid)

  // Acumula trincas de todos os relatórios até a data do atual (inclusive)
  const allReports = [...(imovel.relatoriosSalvos || [])].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  )
  const currentDate = new Date(report.createdAt)
  const reportsAteCurrent = allReports.filter(r => new Date(r.createdAt) <= currentDate)
  const trincasMap = new Map()
  reportsAteCurrent.forEach(r => {
    ;(r.trincasPlanta || []).forEach(t => {
      trincasMap.set(t.codigo, t)
    })
  })
  const trincasPlanta = Array.from(trincasMap.values())

  const direcaoEncosta = report.direcaoEncosta ?? null
  const analise = calcCorrelacao(trincasPlanta, direcaoEncosta)

  const edificacaoGps = (() => {
    try {
      const raw = imovel?.edificacaoPlanta
      if (!raw) return null
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (Array.isArray(parsed?.gpsVerts) && parsed.gpsVerts.length >= 3) return parsed.gpsVerts
      return null
    } catch { return null }
  })()

  const TIPOS_CRINCA = [
    { id: 'vertical',   icon: '↕', label: 'Vertical' },
    { id: 'diagonal',   icon: '↗', label: 'Diagonal' },
    { id: 'horizontal', icon: '↔', label: 'Horizontal' },
    { id: 'escalonada', icon: '⌐', label: 'Escalonada' },
  ]

  const fotos = report.fotosAnomalias || []

  // Agrupa as fotos em pares de 2 para o layout de impressão
  const fotoPairs = []
  for (let i = 0; i < fotos.length; i += 2) {
    fotoPairs.push(fotos.slice(i, i + 2))
  }

  const metodo = report.metodo || 1
  const M2_COLORS = { a: '#22c55e', b: '#3b82f6', c: '#f97316' }

  const linhaLabel = (linha, p1, p2) => {
    if (linha.nome) return `Medida ${linha.nome.toUpperCase()}`
    return `Fissura ${p1?.codigo || '?'}-${p2?.codigo || '?'}`
  }

  const renderFotoCard = (foto, inPair = false) => {
    const getPonto = pid => getPointById(foto, pid)
    const hasLinhas = foto.linhas && foto.linhas.length > 0

    return (
      <div key={foto.id} className={`${styles.anomalyCard} ${inPair ? styles.pairCard : ''}`}>
        <div className={styles.anomalyCardHeader}>
          <strong>{foto.codigoTrinca}</strong>
          {metodo === 2 && <span style={{ marginLeft: 8, fontSize: 11, background: '#16a34a', color: '#fff', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>Triângulo</span>}
        </div>

        {/* A imagem já tem as anotações queimadas (rasterizePhoto).
            O SVG overlay só aparece no modo de edição para refletir
            os valores novos enquanto o usuário edita. */}
        <div className={styles.anomalyImgWrap}>
          {foto.url ? (
            <img src={foto.url} alt={`Anomalia ${foto.codigoTrinca}`} className={styles.anomalyImg} />
          ) : (
            <div className={styles.anomalyImg} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: '#f1f5f9', color: '#64748b', fontSize: 13, gap: 6, minHeight: 140,
            }}>
              <span style={{ fontSize: 32 }}>📷</span>
              <span style={{ fontWeight: 600 }}>Imagem não disponível</span>
              <span style={{ fontSize: 11, textAlign: 'center', padding: '0 8px' }}>
                Foto removida automaticamente por limite de armazenamento.<br />
                As medições abaixo foram preservadas.
              </span>
            </div>
          )}
          {editMode && foto.pontos?.map(point => (
            <div
              key={point.id}
              className={styles.pointOverlay}
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            >
              {point.codigo}
            </div>
          ))}
          {editMode && (
            <svg className={styles.svgOverlay}>
              {foto.linhas?.map(line => {
                const p1 = getPonto(line.ponto1Id)
                const p2 = getPonto(line.ponto2Id)
                if (!p1 || !p2) return null
                const midX = (p1.x + p2.x) / 2
                const midY = (p1.y + p2.y) / 2
                const vals = editMeasures[`${foto.id}_${line.id}`] || line.comprimentos
                const valid = (vals || []).filter(c => typeof c === 'number' && c > 0)
                const avg = valid.length
                  ? (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2).replace('.', ',')
                  : null
                const lineColor = (metodo === 2 && line.nome) ? (M2_COLORS[line.nome] || '#000') : '#000'
                const svgLabel = metodo === 2 && line.nome
                  ? (avg ? `${line.nome}: Ø ${avg} mm` : line.nome)
                  : (avg ? `Ø ${avg} mm` : '—')
                return (
                  <g key={line.id}>
                    <line
                      x1={`${p1.x}%`} y1={`${p1.y}%`}
                      x2={`${p2.x}%`} y2={`${p2.y}%`}
                      stroke={lineColor} strokeWidth="2.5"
                      strokeDasharray={metodo === 2 ? '8,4' : undefined}
                    />
                    <text
                      x={`${midX}%`} y={`${midY}%`} dy="-8"
                      fill="white" fontSize="12" fontWeight="bold" textAnchor="middle"
                      style={{ paintOrder: 'stroke', stroke: lineColor, strokeWidth: '3px' }}
                    >
                      {svgLabel}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>

        {/* Tabela de medições — aparece limpa abaixo da foto */}
        {hasLinhas && (
          editMode ? (
            <div className={styles.editMeasBlock}>
              {foto.linhas.map(linha => {
                if (!linha.comprimentos?.length) return null
                const p1 = getPonto(linha.ponto1Id)
                const p2 = getPonto(linha.ponto2Id)
                const key = `${foto.id}_${linha.id}`
                const vals = editMeasures[key] || [0, 0, 0]
                return (
                  <div key={linha.id} className={styles.editMeasRow}>
                    <span className={styles.editMeasLabel} style={{ color: (metodo === 2 && linha.nome) ? M2_COLORS[linha.nome] : undefined, fontWeight: 700 }}>{linhaLabel(linha, p1, p2)}</span>
                    <div className={styles.editMeasInputs}>
                      {[0, 1, 2].map(i => (
                        <label key={i} className={styles.editMeasField}>
                          <span>M{i + 1}</span>
                          <input
                            type="number" min="0" step="0.01"
                            className={styles.editMeasInput}
                            value={vals[i] || ''}
                            onChange={e => setMeasureVal(foto.id, linha.id, i, e.target.value)}
                          />
                        </label>
                      ))}
                      <div className={styles.editMeasAvg}>
                        Média: <strong>{getEditAvg(foto.id, linha.id)} mm</strong>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <table className={styles.measTable}>
              <thead>
                <tr>
                  <th>{metodo === 2 ? 'Medida' : 'Fissura'}</th>
                  <th>M1 (mm)</th>
                  <th>M2 (mm)</th>
                  <th>M3 (mm)</th>
                  <th>Média (mm)</th>
                </tr>
              </thead>
              <tbody>
                {foto.linhas.map(linha => {
                  if (!linha.comprimentos?.length) return null
                  const p1 = getPonto(linha.ponto1Id)
                  const p2 = getPonto(linha.ponto2Id)
                  const comprimentos = linha.comprimentos
                  const valid = comprimentos.filter(c => typeof c === 'number' && c > 0)
                  const avg = valid.length
                    ? (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2).replace('.', ',')
                    : '—'
                  const fmt = v => (typeof v === 'number' && v > 0) ? v.toFixed(2).replace('.', ',') : '—'
                  return (
                    <tr key={linha.id}>
                      <td style={{ color: (metodo === 2 && linha.nome) ? M2_COLORS[linha.nome] : undefined, fontWeight: linha.nome ? 700 : undefined }}>{linhaLabel(linha, p1, p2)}</td>
                      <td>{fmt(comprimentos[0])}</td>
                      <td>{fmt(comprimentos[1])}</td>
                      <td>{fmt(comprimentos[2])}</td>
                      <td><strong>{avg}</strong></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        )}

        {foto.observacao && (
          <div className={styles.obs}><strong>Observações:</strong><br />{foto.observacao}</div>
        )}
      </div>
    )
  }

  return (
    <MonitoramentoLayout>
      <div className={styles.toolbar}>
        <Link to={`/monitoramento/${id}/relatorios`} className={styles.backLink}>← Voltar para Relatórios</Link>
        <div style={{ display: 'flex', gap: 8 }}>
          {editMode ? (
            <>
              <button className={styles.btnCancel} onClick={() => setEditMode(false)} disabled={editSaving}>✕ Cancelar</button>
              <button className={styles.btnSave}   onClick={saveEdit}                disabled={editSaving}>
                {editSaving ? '⏳ Salvando…' : '💾 Salvar'}
              </button>
            </>
          ) : (
            <>
              <button className={styles.btnEdit}  onClick={startEdit}>✏️ Editar</button>
              <button className={styles.btnPrint} onClick={handlePrint}>🖨️ Imprimir / Salvar PDF</button>
            </>
          )}
        </div>
      </div>

      <div className={styles.reportWrap} ref={printRef}>

        {/* ── Cabeçalho técnico — só visível na impressão/PDF ── */}
        <div className={styles.printHeader}>
          <div className={styles.printHeaderTop}>
            <div className={styles.printOrgBlock}>
              <div className={styles.printOrgName}>GEO-Vistorias</div>
              <div className={styles.printOrgSub}>Sistema de Monitoramento Geotécnico — Defesa Civil Municipal</div>
            </div>
            <div className={styles.printMetaBlock}>
              <div><strong>Nº Documento:</strong> MON-{(report.id || '').slice(-8).toUpperCase()}</div>
              <div><strong>Data de Emissão:</strong> {new Date(report.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
              <div><strong>Hora:</strong> {new Date(report.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
              <div><strong>Cidade:</strong> {imovel.cidade || '—'}</div>
            </div>
          </div>
          <div className={styles.printDocTitleBlock}>
            <div className={styles.printDocTitle}>Relatório de Vistoria de Imóvel</div>
          </div>
          <hr className={styles.printHeaderDivider} />
        </div>

        {/* ── Cabeçalho de tela ── */}
        <div className={styles.reportHeader}>
          <div>
            <h1 className={styles.reportTitle}>Relatório de Vistoria de Imóvel</h1>
            <p className={styles.reportSub}>Monitoramento Geotécnico — GEO-Vistorias</p>
          </div>
          <div className={styles.reportDate}>
            {editMode ? (
              <input
                type="datetime-local"
                className={styles.editDateInput}
                value={editDate}
                onChange={e => setEditDate(e.target.value)}
              />
            ) : (
              new Date(report.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
            )}
          </div>
        </div>

        {/* ── Dados do Imóvel ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Dados do Imóvel</h2>
          <div className={styles.dataGrid}>
            <div><strong>Proprietário:</strong> {imovel.proprietario}</div>
            <div><strong>Cidade:</strong> {imovel.cidade || '—'}</div>
            <div className={styles.fullRow}><strong>Endereço:</strong> {imovel.endereco || '—'}</div>
            {imovel.celular && <div><strong>Celular:</strong> {imovel.celular}</div>}
            <div className={styles.fullRow}>
              <strong>Data do Relatório:</strong>{' '}
              {editMode ? (
                <input
                  type="datetime-local"
                  className={styles.editDateInput}
                  value={editDate}
                  onChange={e => setEditDate(e.target.value)}
                />
              ) : (
                new Date(report.createdAt).toLocaleString('pt-BR')
              )}
            </div>
          </div>
        </section>

        {/* ── Planta Baixa da Edificação ── */}
        {imovel.edificacaoPlanta?.vertices?.length >= 3 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Planta Baixa da Edificação</h2>
            <p style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>
              Planta esquemática registrada na Vistoria Residencial. Anomalias de parede marcadas em vermelho.
            </p>
            <LocalizacaoEdificacao value={imovel.edificacaoPlanta} readonly />
          </section>
        )}


        {/* ── Análise de Anomalias por Foto ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Análise de Anomalias por Foto</h2>

          {fotos.length === 0 ? (
            <p className={styles.noData}>Nenhuma foto de anomalia registrada neste relatório.</p>
          ) : (
            <>
              {/* Layout de TELA: grid normal */}
              <div className={`${styles.anomalyGrid} ${fotos.length === 1 ? styles.single : ''} ${styles.screenOnly}`}>
                {fotos.map(foto => renderFotoCard(foto, false))}
              </div>

              {/* Layout de IMPRESSÃO: pares com quebra de página */}
              <div className={styles.printOnly}>
                {fotoPairs.map((par, pi) => (
                  <div key={pi} className={styles.fotoPair}>
                    {par.map(foto => renderFotoCard(foto, true))}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* ── Rodapé do relatório ── */}
        <div className={styles.reportFooter}>
          <div className={styles.footerLine} />
          <div className={styles.footerText}>
            <span>GEO-Vistorias — Sistema de Monitoramento Geotécnico</span>
            <span>Documento gerado em {new Date().toLocaleString('pt-BR')}</span>
          </div>
        </div>

      </div>
    </MonitoramentoLayout>
  )
}
