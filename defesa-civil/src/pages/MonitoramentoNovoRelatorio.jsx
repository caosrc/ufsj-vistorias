import { useState, useEffect, useCallback } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import MonitoramentoLayout from '../components/MonitoramentoLayout'
import PhotoAnnotator from '../components/PhotoAnnotator'
import Edificio3D from '../components/Edificio3D'
import LocalizacaoEdificacao from '../components/LocalizacaoEdificacao'
import CrackMapper2D from '../components/CrackMapper2D'
import styles from './MonitoramentoNovoRelatorio.module.css'
import { API_BASE } from '../services/api'

const naturalSort = (a, b) => {
  const numA = parseInt((a.codigoTrinca || '').replace(/\D/g, '') || '0', 10)
  const numB = parseInt((b.codigoTrinca || '').replace(/\D/g, '') || '0', 10)
  return (isNaN(numA) ? 0 : numA) - (isNaN(numB) ? 0 : numB)
}

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
  const [direcaoEncosta, setDirecaoEncosta] = useState('')

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
          if (report?.direcaoEncosta != null) setDirecaoEncosta(String(report.direcaoEncosta))
        } else {
          data.fotosAnomalias = []
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

  // Sempre redimensiona e comprime a foto (independente de ter anotações ou não).
  // Isso garante que o payload fique abaixo do limite de ~1MB por linha do D1.
  const rasterizePhoto = async (foto) => {
    if (!foto.url) return foto.url
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image()
        const url = foto.url || ''
        if (!url.startsWith('data:') && !url.startsWith('blob:')) i.crossOrigin = 'Anonymous'
        i.onload = () => resolve(i); i.onerror = reject; i.src = url
      })
      // Máx 800px em qualquer dimensão — aprox. 80–150KB por foto
      const MAX_DIM = 800
      const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth || 800, img.naturalHeight || 600))
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round((img.naturalWidth  || 800) * scale)
      canvas.height = Math.round((img.naturalHeight || 600) * scale)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const lw = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * 0.006))
      const pr = Math.max(6, Math.round(Math.min(canvas.width, canvas.height) * 0.01))
      if (foto.linhas && foto.pontos) {
        for (const line of foto.linhas) {
          const p1 = foto.pontos.find(p => p.id === line.ponto1Id)
          const p2 = foto.pontos.find(p => p.id === line.ponto2Id)
          if (!p1 || !p2) continue
          const x1 = (p1.x / 100) * canvas.width, y1 = (p1.y / 100) * canvas.height
          const x2 = (p2.x / 100) * canvas.width, y2 = (p2.y / 100) * canvas.height
          ctx.strokeStyle = 'white'; ctx.lineWidth = lw + 2
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
          ctx.strokeStyle = 'black'; ctx.lineWidth = lw
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
          const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2
          const valid = line.comprimentos.filter(c => typeof c === 'number')
          if (valid.length) {
            const avg = valid.reduce((a, b) => a + b, 0) / valid.length
            const text = `Ø ${avg.toFixed(2).replace('.', ',')} mm`
            ctx.font = `${Math.max(12, Math.round(Math.min(canvas.width, canvas.height) * 0.02))}px sans-serif`
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
            ctx.fillStyle = 'white'; ctx.strokeStyle = 'black'; ctx.lineWidth = 3
            ctx.strokeText(text, midX, midY - 8); ctx.fillText(text, midX, midY - 8)
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
      return canvas.toDataURL('image/jpeg', 0.7)
    } catch { return foto.url }
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
      for (let i = 0; i < fotosCopy.length; i++) fotosCopy[i].url = await rasterizePhoto(fotosCopy[i])
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
        direcaoEncosta: direcaoEncosta !== '' ? Number(direcaoEncosta) : null,
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

      {/* ── Mapeamento de Trincas na Planta Baixa ── */}
      {imovel?.verticesCasa?.length >= 3 && (
        <div className={styles.card} style={{ marginBottom: 20 }}>
          <h2 className={styles.cardTitle}>🗺️ Mapeamento de Trincas — Planta Baixa</h2>
          <p className={styles.cardDesc}>
            Marque os locais das trincas (T1, T2, T3…) diretamente na planta do imóvel.
            Clique em <strong>"📍 Marcar Trinca na Planta"</strong>, clique sobre a planta e confirme o tipo e direção.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>
              Direção da Encosta (°N):
            </label>
            <input
              type="number"
              min={0}
              max={360}
              placeholder="Ex: 180 = Sul"
              value={direcaoEncosta}
              onChange={e => setDirecaoEncosta(e.target.value)}
              style={{
                width: 120, fontSize: 13, padding: '5px 8px',
                borderRadius: 7, border: '1px solid #bfdbfe',
              }}
            />
            <span style={{ fontSize: 11, color: '#94a3b8' }}>0=Norte · 90=Leste · 180=Sul · 270=Oeste</span>
          </div>

          <CrackMapper2D
            verticesCasa={imovel.verticesCasa}
            trincas={trincasPlanta}
            onUpdate={setTrincasPlanta}
            direcaoEncosta={direcaoEncosta !== '' ? Number(direcaoEncosta) : null}
            readonly={false}
          />
        </div>
      )}

      {/* ── Fotos de Anomalias ── */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Análise de Anomalias por Foto</h2>
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
