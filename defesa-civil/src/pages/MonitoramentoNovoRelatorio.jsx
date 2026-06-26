import { useState, useEffect, useCallback } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import MonitoramentoLayout from '../components/MonitoramentoLayout'
import PhotoAnnotator from '../components/PhotoAnnotator'
import Edificio3D from '../components/Edificio3D'
import LocalizacaoEdificacao from '../components/LocalizacaoEdificacao'
import styles from './MonitoramentoNovoRelatorio.module.css'
import { API_BASE } from '../services/api'

const naturalSort = (a, b) => {
  const numA = parseInt((a.codigoTrinca || '').replace(/\D/g, '') || '0', 10)
  const numB = parseInt((b.codigoTrinca || '').replace(/\D/g, '') || '0', 10)
  return (isNaN(numA) ? 0 : numA) - (isNaN(numB) ? 0 : numB)
}

const M2_COLORS = { a: '#22c55e', b: '#3b82f6', c: '#f97316' }

export default function MonitoramentoNovoRelatorio() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const relatorioId = searchParams.get('relatorioId')
  const isEditing = !!relatorioId

  const [imovel, setImovel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activePhotoId, setActivePhotoId] = useState(null)
  const [toast, setToast] = useState(null)
  const [showNextPrompt, setShowNextPrompt] = useState(false)

  const [anomalias3D, setAnomalias3D] = useState([])
  const [pendingCrackCode, setPendingCrackCode] = useState('')
  const [trincasPlanta, setTrincasPlanta] = useState([])

  const [metodo, setMetodo] = useState(null)
  const [showMetodoDialog, setShowMetodoDialog] = useState(false)

  const showToast = (msg, type = 'info') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500) }

  useEffect(() => {
    fetch(`${API_BASE}/monitoramento/${id}`)
      .then(r => r.json())
      .then(data => {
        if (isEditing) {
          const report = data.relatoriosSalvos?.find(r => r.id === relatorioId)
          data.fotosAnomalias = report ? JSON.parse(JSON.stringify(report.fotosAnomalias || [])) : []
          if (report?.anomalias3D) setAnomalias3D(report.anomalias3D)
          if (report?.trincasPlanta) setTrincasPlanta(report.trincasPlanta)
          setMetodo(report?.metodo || 1)
        } else {
          data.fotosAnomalias = []
          const existingReports = data.relatoriosSalvos || []
          if (existingReports.length === 0) {
            setShowMetodoDialog(true)
          } else {
            setMetodo(existingReports[0]?.metodo || 1)
          }
        }
        setImovel(data); setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id, relatorioId, isEditing])

  const handleVistoriaChange = useCallback((updated) => {
    if (updated.fotosAnomalias) updated.fotosAnomalias.sort(naturalSort)
    setImovel(updated)
  }, [])

  const handleAddAnomalia = (a) => setAnomalias3D(prev => [...prev, a])
  const handleRemoveAnomalia = (aid) => setAnomalias3D(prev => prev.filter(a => a.id !== aid))

  const handleCrackComplete = (nome) => {
    setPendingCrackCode(nome)
    setActivePhotoId('new')
  }

  // Calcula o próximo código automático (T1, T2, T3...)
  const nextCode = (() => {
    const existing = new Set((imovel?.fotosAnomalias || []).map(f => f.codigoTrinca.toUpperCase()))
    let n = 1
    while (existing.has(`T${n}`)) n++
    return `T${n}`
  })()

  const handleAddFoto = (code) => {
    setPendingCrackCode(code || nextCode)
    setActivePhotoId('new')
    setShowNextPrompt(false)
  }

  const handleBackFromAnnotator = () => {
    setActivePhotoId(null)
    setPendingCrackCode('')
    // Após salvar uma anomalia, mostra prompt para adicionar a próxima
    setShowNextPrompt(true)
  }

  const rasterizePhoto = async (foto, fotoMetodo = 1) => {
    if (!foto.url) return foto.url
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image()
        const url = foto.url || ''
        if (!url.startsWith('data:') && !url.startsWith('blob:')) i.crossOrigin = 'Anonymous'
        i.onload = () => resolve(i); i.onerror = reject; i.src = url
      })
      const MAX_DIM = 2000
      const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth || 800, img.naturalHeight || 600))
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round((img.naturalWidth  || 800) * scale)
      canvas.height = Math.round((img.naturalHeight || 600) * scale)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const lw = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * 0.006))
      const pr = Math.max(6, Math.round(Math.min(canvas.width, canvas.height) * 0.01))
      const fontSize = Math.max(12, Math.round(Math.min(canvas.width, canvas.height) * 0.02))
      if (foto.linhas && foto.pontos) {
        for (const line of foto.linhas) {
          const p1 = foto.pontos.find(p => p.id === line.ponto1Id)
          const p2 = foto.pontos.find(p => p.id === line.ponto2Id)
          if (!p1 || !p2) continue
          const x1 = (p1.x / 100) * canvas.width, y1 = (p1.y / 100) * canvas.height
          const x2 = (p2.x / 100) * canvas.width, y2 = (p2.y / 100) * canvas.height
          const lineColor = (fotoMetodo === 2 && line.nome) ? (M2_COLORS[line.nome] || '#000') : '#000'
          ctx.strokeStyle = 'white'; ctx.lineWidth = lw + 2
          ctx.setLineDash(fotoMetodo === 2 ? [10, 5] : [])
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
          ctx.strokeStyle = lineColor; ctx.lineWidth = lw
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
          ctx.setLineDash([])
          const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2
          const valid = (line.comprimentos || []).filter(c => typeof c === 'number' && c > 0)
          if (valid.length) {
            const avg = valid.reduce((a, b) => a + b, 0) / valid.length
            const prefix = (fotoMetodo === 2 && line.nome) ? `${line.nome}: ` : 'Ø '
            const text = `${prefix}${avg.toFixed(2).replace('.', ',')} mm`
            ctx.font = `bold ${fontSize}px sans-serif`
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
            ctx.lineWidth = 4
            ctx.strokeStyle = 'rgba(255,255,255,0.95)'
            ctx.strokeText(text, midX, midY - 8)
            ctx.fillStyle = fotoMetodo === 2 ? lineColor : '#000'
            ctx.fillText(text, midX, midY - 8)
          }
        }
      }
      if (foto.pontos) {
        for (const point of foto.pontos) {
          const cx = (point.x / 100) * canvas.width, cy = (point.y / 100) * canvas.height
          ctx.beginPath(); ctx.fillStyle = 'black'; ctx.arc(cx, cy, pr, 0, Math.PI * 2); ctx.fill()
          ctx.lineWidth = 3; ctx.strokeStyle = 'white'; ctx.stroke()
          ctx.fillStyle = 'white'
          ctx.font = `${Math.max(10, Math.round(pr * 0.9))}px sans-serif`
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(point.codigo, cx, cy)
        }
      }
      return canvas.toDataURL('image/jpeg', 0.92)
    } catch {
      // Não retorna blob: inválido — apenas retorna null; foto será ignorada ao salvar
      if (foto.url && foto.url.startsWith('data:')) return foto.url
      return null
    }
  }

  const handleSave = async () => {
    if (!imovel?.fotosAnomalias?.length && !anomalias3D.length) {
      showToast('Adicione pelo menos uma foto ou marque anomalias no modelo 3D antes de salvar', 'error')
      return
    }
    setSaving(true); showToast('Processando...')
    try {
      const fotosCopy = JSON.parse(JSON.stringify(imovel?.fotosAnomalias || []))
      fotosCopy.sort(naturalSort)
      const metodoAtual = metodo || 1
      for (let i = 0; i < fotosCopy.length; i++) {
        const rasterized = await rasterizePhoto(fotosCopy[i], metodoAtual)
        if (rasterized !== null) fotosCopy[i].url = rasterized
      }
      const fotoCodes = fotosCopy.map(f => f.codigoTrinca).join(', ')
      const anomaliaCodes = anomalias3D.map(a => a.nome).join(', ')
      const allCodes = [fotoCodes, anomaliaCodes].filter(Boolean).join(' + ')
      const date = new Date().toLocaleDateString('pt-BR')
      const report = {
        id: isEditing ? relatorioId : `rel-${Date.now()}`,
        nome: allCodes ? `Relatório ${allCodes} ${date}` : `Relatório ${date}`,
        createdAt: isEditing
          ? (imovel.relatoriosSalvos?.find(r => r.id === relatorioId)?.createdAt || new Date().toISOString())
          : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fotosAnomalias: fotosCopy,
        anomalias3D: anomalias3D,
        trincasPlanta: trincasPlanta,
        metodo: metodoAtual,
      }
      const url = isEditing
        ? `${API_BASE}/monitoramento/${id}/relatorios/${relatorioId}`
        : `${API_BASE}/monitoramento/${id}/relatorios`
      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      })
      if (!res.ok) {
        let msg = 'Erro ao salvar relatório'
        try { const json = await res.json(); msg = json.error || msg } catch {}
        throw new Error(msg)
      }
      showToast('Relatório salvo!')
      setTimeout(() => navigate(`/monitoramento/${id}/relatorios`), 800)
    } catch (err) {
      console.error('[Relatório] Erro ao salvar:', err)
      showToast(err.message || 'Erro desconhecido ao salvar relatório', 'error')
    }
    finally { setSaving(false) }
  }

  if (loading) return <MonitoramentoLayout><div className={styles.loading}>Carregando...</div></MonitoramentoLayout>

  const sortedPhotos = imovel?.fotosAnomalias ? [...imovel.fotosAnomalias].sort(naturalSort) : []

  const vertices = (() => {
    const raw = imovel?.area_vertices || imovel?.verticesCasa
    if (!raw) return null
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw }
    catch { return null }
  })()
  const alturaEdificacao = parseFloat(imovel?.alturaEdificacao || imovel?.alturaCasa || imovel?.altura_casa || 0)
  const temModelo3D = Array.isArray(vertices) && vertices.length >= 3 && alturaEdificacao > 0

  return (
    <MonitoramentoLayout>
      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.msg}</div>}

      {/* ── Seleção de método (1º relatório) ── */}
      {showMetodoDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, maxWidth: 540, width: '100%', overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '20px 24px 0' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 20, color: '#0f172a' }}>Escolha o Método de Monitoramento</h2>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748b' }}>
                Esta escolha se aplica a <strong>todos os relatórios</strong> deste imóvel.
              </p>
            </div>
            <img src="/metodo-triangulo.png" alt="Método do Triângulo" style={{ width: '100%', display: 'block' }} />
            <div style={{ padding: '16px 24px 24px', display: 'flex', gap: 12, flexDirection: 'column' }}>
              <button
                onClick={() => { setMetodo(1); setShowMetodoDialog(false) }}
                style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 20px', fontWeight: 700, fontSize: 15, cursor: 'pointer', textAlign: 'left' }}>
                <div>📍 Método 1 — Padrão</div>
                <div style={{ fontWeight: 400, fontSize: 13, marginTop: 3, opacity: 0.85 }}>Pontos e linhas livres sobre a foto. Medidas entre quaisquer pontos.</div>
              </button>
              <button
                onClick={() => { setMetodo(2); setShowMetodoDialog(false) }}
                style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 20px', fontWeight: 700, fontSize: 15, cursor: 'pointer', textAlign: 'left' }}>
                <div>📐 Método 2 — Triângulo</div>
                <div style={{ fontWeight: 400, fontSize: 13, marginTop: 3, opacity: 0.85 }}>3 pontos fixos formando triângulo. Linhas a (1→2), b (1→3) e c (2→3) com 3 medições cada.</div>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.pageHeader}>
        <div>
          <Link to={`/monitoramento/${id}/relatorios`} className={styles.backLink}>← Voltar para Relatórios</Link>
          <h1 className={styles.title}>{isEditing ? 'Editar Relatório' : 'Novo Relatório'}</h1>
          <p className={styles.subtitle}>{imovel?.proprietario}</p>
        </div>
        <button className={styles.btnSave} onClick={handleSave} disabled={saving}>
          {saving ? '⏳ Salvando...' : '💾 Salvar e ir para Histórico'}
        </button>
      </div>

      {/* ── Modelo 3D + Anomalias ── */}
      <div className={styles.card} style={{ marginBottom: 20 }}>
        <h2 className={styles.cardTitle}>Modelo 3D do Imóvel — Marcar Anomalias</h2>
        <p className={styles.cardDesc}>
          Clique em "Marcar Anomalia", selecione o ponto inicial da trinca no modelo e depois o ponto final.
          Cada anomalia recebe um nome (T1, T2…).
        </p>

        {temModelo3D ? (
          <Edificio3D
            vertices={vertices}
            altura={alturaEdificacao}
            anomalias={anomalias3D}
            onAddAnomalia={handleAddAnomalia}
            onRemoveAnomalia={handleRemoveAnomalia}
            onCrackComplete={handleCrackComplete}
            edificacaoSalva={(() => {
              try {
                const ep = imovel?.edificacaoPlanta
                if (!ep) return null
                const parsed = typeof ep === 'string' ? JSON.parse(ep) : ep
                return parsed?.gpsVerts?.length ? parsed : null
              } catch { return null }
            })()}
            vistoriaAnomalias={(() => {
              try {
                const raw = imovel?.trincasCasa
                if (!raw) return []
                const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
                return Array.isArray(arr) ? arr : []
              } catch { return [] }
            })()}
            monitoramentoAnomalias={(() => {
              try {
                const saved = imovel?.relatoriosSalvos || []
                const outros = isEditing ? saved.filter(r => r.id !== relatorioId) : saved
                return outros.flatMap(r => Array.isArray(r.anomalias3D) ? r.anomalias3D : [])
              } catch { return [] }
            })()}
          />
        ) : (
          <div style={{
            border: '2px dashed #bfdbfe', borderRadius: 10, padding: '32px 20px',
            textAlign: 'center', color: '#64748b', background: '#f8fbff',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏠</div>
            <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#334155' }}>Modelo 3D não disponível</p>
            <p style={{ margin: 0, fontSize: 13 }}>
              Para visualizar o modelo, o imóvel precisa ter o polígono da planta e a altura informados no cadastro da vistoria.
            </p>
          </div>
        )}
      </div>

      {/* ── Planta Baixa da Edificação ── */}
      {imovel?.edificacaoPlanta?.vertices?.length >= 3 && (
        <div className={styles.card} style={{ marginBottom: 20 }}>
          <h2 className={styles.cardTitle}>Planta Baixa da Edificação</h2>
          <p className={styles.cardDesc}>Planta baixa esquemática registrada na Vistoria Residencial. Anomalias de parede marcadas em vermelho.</p>
          <LocalizacaoEdificacao
            value={imovel.edificacaoPlanta}
            readonly={true}
          />
        </div>
      )}


      {/* ── Fotos de Anomalias ── */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>
          Análise de Anomalias por Foto
          {metodo === 2 && <span style={{ marginLeft: 10, fontSize: 12, background: '#16a34a', color: '#fff', borderRadius: 5, padding: '2px 8px', fontWeight: 600, verticalAlign: 'middle' }}>Método 2 — Triângulo</span>}
          {metodo === 1 && <span style={{ marginLeft: 10, fontSize: 12, background: '#1d4ed8', color: '#fff', borderRadius: 5, padding: '2px 8px', fontWeight: 600, verticalAlign: 'middle' }}>Método 1 — Padrão</span>}
        </h2>
        <p className={styles.cardDesc}>
          Adicione fotos de anomalias, insira pontos e meça fissuras para documentar a vistoria.
          {sortedPhotos.length > 0 && (
            <span style={{ marginLeft: 6, color: '#16a34a', fontWeight: 600 }}>
              {sortedPhotos.length} foto(s) registrada(s).
            </span>
          )}
        </p>

        {activePhotoId ? (
          <div>
            <button className={styles.btnBack} onClick={handleBackFromAnnotator}>← Voltar para Galeria</button>
            <PhotoAnnotator
              imovelId={id}
              vistoria={imovel}
              activePhotoId={activePhotoId}
              onVistoriaChange={handleVistoriaChange}
              onBack={handleBackFromAnnotator}
              defaultCrackCode={pendingCrackCode}
              metodo={metodo || 1}
            />
          </div>
        ) : (
          <div className={styles.gallery}>
            {/* ── Banner: adicionar próxima anomalia ── */}
            {showNextPrompt && sortedPhotos.length > 0 && (
              <div style={{
                background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 10,
                padding: '14px 18px', marginBottom: 14, display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
              }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#15803d', fontSize: 14 }}>
                    ✅ Anomalia {sortedPhotos[sortedPhotos.length - 1]?.codigoTrinca} salva!
                  </div>
                  <div style={{ fontSize: 13, color: '#166534', marginTop: 2 }}>
                    Deseja adicionar a próxima anomalia <strong>{nextCode}</strong>?
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => handleAddFoto(nextCode)}
                    style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    + Adicionar {nextCode}
                  </button>
                  <button
                    onClick={() => setShowNextPrompt(false)}
                    style={{ background: 'transparent', border: '1px solid #86efac', color: '#15803d', borderRadius: 7, padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}>
                    Não, encerrar
                  </button>
                </div>
              </div>
            )}

            <div className={styles.galleryHeader}>
              <h3>Fotos das Anomalias</h3>
              <button className={styles.btnAdd} onClick={() => handleAddFoto(nextCode)}>
                + Adicionar {nextCode}
              </button>
            </div>

            {sortedPhotos.length === 0 ? (
              <div className={styles.emptyGallery}>
                <p>Nenhuma foto de anomalia adicionada.</p>
                <button className={styles.btnLink} onClick={() => handleAddFoto('T1')}>Cadastrar T1 — primeira anomalia</button>
              </div>
            ) : (
              <div className={styles.photoGrid}>
                {sortedPhotos.map(foto => (
                  <div key={foto.id} className={styles.photoCard} onClick={() => { setActivePhotoId(foto.id); setShowNextPrompt(false) }}>
                    <img src={foto.url} alt={foto.codigoTrinca} className={styles.photoImg} />
                    <div className={styles.photoOverlay}>{foto.codigoTrinca}</div>
                    <div className={styles.photoHover}>Ver / Editar</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </MonitoramentoLayout>
  )
}
