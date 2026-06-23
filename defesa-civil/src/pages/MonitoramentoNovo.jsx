import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import MonitoramentoLayout from '../components/MonitoramentoLayout'
import LocalizacaoEdificacao from '../components/LocalizacaoEdificacao'
import Edificio3D from '../components/Edificio3D'
import styles from './MonitoramentoNovo.module.css'
import { API_BASE } from '../services/api'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ── Diagrama 2D da planta da casa ─────────────────────────────
function CasaDiagram({ vertices, trincas, onMarkTrinca, nextCodigo }) {
  const canvasRef = useRef(null)
  const [hoverPct, setHoverPct] = useState(null)

  const getPolyBounds = () => {
    if (!vertices || vertices.length < 2) return null
    const lngs = vertices.map(v => v.lng)
    const lats = vertices.map(v => v.lat)
    return { minLng: Math.min(...lngs), maxLng: Math.max(...lngs), minLat: Math.min(...lats), maxLat: Math.max(...lats) }
  }

  const toCanvas = (lat, lng, b, W, H) => {
    if (!b || b.maxLng === b.minLng || b.maxLat === b.minLat) return { x: W/2, y: H/2 }
    const x = ((lng - b.minLng) / (b.maxLng - b.minLng)) * (W - 24) + 12
    const y = ((b.maxLat - lat) / (b.maxLat - b.minLat)) * (H - 24) + 12
    return { x, y }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const W = canvas.width, H = canvas.height
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)

    // Fundo
    ctx.fillStyle = '#f0fdf4'
    ctx.fillRect(0, 0, W, H)

    const b = getPolyBounds()

    // Polígono da casa
    if (vertices && vertices.length >= 2) {
      ctx.strokeStyle = '#2563eb'
      ctx.lineWidth = 2.5
      ctx.fillStyle = 'rgba(37,99,235,0.07)'
      ctx.beginPath()
      vertices.forEach((v, i) => {
        const { x, y } = toCanvas(v.lat, v.lng, b, W, H)
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      })
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Vértices
      vertices.forEach(v => {
        const { x, y } = toCanvas(v.lat, v.lng, b, W, H)
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2)
        ctx.fillStyle = '#2563eb'; ctx.fill()
      })
    } else {
      // Retângulo padrão (sem vértices)
      ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.5; ctx.setLineDash([4,3])
      ctx.strokeRect(20, 20, W-40, H-40)
      ctx.setLineDash([])
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('Planta da casa (top view)', W/2, H/2)
      ctx.fillText('Adicione vértices acima para ver a planta', W/2, H/2 + 16)
    }

    // Hover
    if (hoverPct) {
      const hx = hoverPct.x * W, hy = hoverPct.y * H
      ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI*2)
      ctx.fillStyle = 'rgba(239,68,68,0.4)'; ctx.fill()
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.stroke()
    }

    // Marcadores de trinca
    trincas.filter(t => t.xPct != null && t.yPct != null).forEach(t => {
      const tx = t.xPct * W, ty = t.yPct * H
      // X vermelho
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(tx-6, ty-6); ctx.lineTo(tx+6, ty+6); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(tx+6, ty-6); ctx.lineTo(tx-6, ty+6); ctx.stroke()
      // Label
      ctx.fillStyle = '#ef4444'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(t.codigo, tx, ty - 9)
    })
  }, [vertices, trincas, hoverPct])

  const getEventPct = e => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    }
  }

  const handleClick = e => {
    const pct = getEventPct(e)
    if (pct) onMarkTrinca(pct.x, pct.y)
  }
  const handleMove = e => { setHoverPct(getEventPct(e)) }
  const handleLeave = () => setHoverPct(null)

  return (
    <div className={styles.diagramWrap}>
      <div className={styles.diagramLabel}>
        Toque na planta para marcar {nextCodigo}
      </div>
      <canvas
        ref={canvasRef} width={300} height={180}
        className={styles.diagramCanvas}
        onClick={handleClick}
        onTouchEnd={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      />
    </div>
  )
}

// ── Mini mapa para captura de pontos ─────────────────────────
function MiniMap({ pontos, corPonto = '#3b82f6', onMapReady }) {
  const mapRef  = useRef(null)
  const mapObj  = useRef(null)
  const polyRef = useRef(null)
  const dotsRef = useRef([])

  useEffect(() => {
    if (!mapRef.current || mapObj.current) return
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false })
    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 }).addTo(map)
    map.setView([-20.515, -43.72], 14)
    mapObj.current = map
    if (onMapReady) onMapReady(map)
    return () => { map.remove(); mapObj.current = null }
  }, [])

  useEffect(() => {
    const map = mapObj.current
    if (!map) return
    dotsRef.current.forEach(d => d.remove()); dotsRef.current = []
    if (polyRef.current) { polyRef.current.remove(); polyRef.current = null }

    if (!pontos || pontos.length === 0) return

    const bounds = []
    pontos.forEach((p, i) => {
      const dot = L.circleMarker([p.lat, p.lng], {
        radius: i === 0 ? 7 : 5,
        color: i === 0 ? '#fbbf24' : corPonto,
        fillColor: i === 0 ? '#fbbf24' : corPonto,
        fillOpacity: 1, weight: 2,
      }).addTo(map)
      dotsRef.current.push(dot)
      bounds.push([p.lat, p.lng])
    })

    if (pontos.length >= 2) {
      polyRef.current = L.polygon(pontos.map(p => [p.lat, p.lng]), {
        color: corPonto, fillColor: corPonto, fillOpacity: 0.1, weight: 2,
      }).addTo(map)
    }

    if (bounds.length > 0) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 })
  }, [pontos, corPonto])

  return <div ref={mapRef} className={styles.miniMap} />
}

// ─────────────────────────────────────────────────────────────
export default function MonitoramentoNovo() {
  const { id } = useParams()
  const isEditing = !!id
  const navigate  = useNavigate()

  const [tab, setTab] = useState('dados')
  const [form, setForm] = useState({ proprietario: '', cidade: '', endereco: '', celular: '' })
  const [position, setPosition] = useState(null)
  const [locating, setLocating] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [toast, setToast]       = useState(null)
  const [showGpsDialog, setShowGpsDialog] = useState(false)
  const [gpsTarget, setGpsTarget] = useState('ponto') // 'ponto' | 'terreno' | 'casa' | 'trinca'
  const [gpsTargetTrincaIdx, setGpsTargetTrincaIdx] = useState(null)

  // Terreno
  const [vtTerreno, setVtTerreno] = useState([])   // [{lat,lng}]
  const [showTerrMap, setShowTerrMap] = useState(false)
  const [manLat, setManLat] = useState(''); const [manLng, setManLng] = useState('')

  // Casa
  const [vtCasa, setVtCasa]     = useState([])     // [{lat,lng}]
  const [alturaCasa, setAlturaCasa] = useState('')
  const [showCasaMap, setShowCasaMap] = useState(false)
  const [manCasaLat, setManCasaLat] = useState(''); const [manCasaLng, setManCasaLng] = useState('')

  // Trincas da casa
  const [trincasCasa, setTrincasCasa] = useState([]) // [{codigo,lat,lng,xPct,yPct}]
  const [marcandoTrinca, setMarcandoTrinca] = useState(false)

  // Planta da edificação (vinda da Vistoria Residencial)
  const [edificacaoPlanta, setEdificacaoPlanta] = useState(null)

  const showToast = (msg, type = 'info') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3200) }

  // Próximo código de trinca
  const nextCodigo = (() => {
    const nums = trincasCasa.map(t => parseInt(t.codigo.replace(/\D/g,''), 10)).filter(n => !isNaN(n))
    return `T${nums.length > 0 ? Math.max(...nums) + 1 : 1}`
  })()

  // ── Carrega dados ao editar ─────────────────────────────────
  useEffect(() => {
    if (!isEditing) return
    fetch(`${API_BASE}/monitoramento/${id}`).then(r => r.json()).then(data => {
      setForm({ proprietario: data.proprietario||'', cidade: data.cidade||'',
                endereco: data.endereco||'', celular: data.celular||'' })
      if (data.latitude && data.longitude) setPosition({ lat: data.latitude, lng: data.longitude })
      if (Array.isArray(data.areaTerrenho)) setVtTerreno(data.areaTerrenho)
      if (Array.isArray(data.verticesCasa))  setVtCasa(data.verticesCasa)
      if (data.alturaCasa) setAlturaCasa(String(data.alturaCasa))
      if (Array.isArray(data.trincasCasa))   setTrincasCasa(data.trincasCasa)
      if (data.edificacaoPlanta?.gpsVerts?.length || data.edificacaoPlanta?.vertices?.length) setEdificacaoPlanta(data.edificacaoPlanta)
    }).catch(() => showToast('Erro ao carregar', 'error'))
  }, [id, isEditing])

  const handleChange = e => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  // ── GPS capture ─────────────────────────────────────────────
  const requestGps = (target, trincaIdx = null) => {
    setGpsTarget(target); setGpsTargetTrincaIdx(trincaIdx)
    setShowGpsDialog(true)
  }

  const getLocation = () => {
    setShowGpsDialog(false); setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords
        setLocating(false)
        if (gpsTarget === 'ponto') {
          setPosition({ lat, lng }); showToast('Localização do imóvel capturada!')
        } else if (gpsTarget === 'terreno') {
          setVtTerreno(prev => [...prev, { lat, lng }])
          setShowTerrMap(true); showToast(`Ponto ${vtTerreno.length + 1} do terreno adicionado!`)
        } else if (gpsTarget === 'casa') {
          setVtCasa(prev => [...prev, { lat, lng }])
          setShowCasaMap(true); showToast(`Vértice ${vtCasa.length + 1} da casa adicionado!`)
        } else if (gpsTarget === 'trinca') {
          setTrincasCasa(prev => {
            const next = [...prev]
            if (gpsTargetTrincaIdx != null) {
              next[gpsTargetTrincaIdx] = { ...next[gpsTargetTrincaIdx], lat, lng }
            }
            return next
          }); showToast('Posição GPS da trinca capturada!')
        }
      },
      () => { setLocating(false); showToast('Não foi possível obter a localização', 'error') },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  // ── Terreno ─────────────────────────────────────────────────
  const addManualTerreno = () => {
    const lat = parseFloat(manLat), lng = parseFloat(manLng)
    if (isNaN(lat) || isNaN(lng)) { showToast('Coordenadas inválidas', 'error'); return }
    setVtTerreno(prev => [...prev, { lat, lng }])
    setManLat(''); setManLng(''); setShowTerrMap(true)
  }

  // ── Casa ────────────────────────────────────────────────────
  const addManualCasa = () => {
    const lat = parseFloat(manCasaLat), lng = parseFloat(manCasaLng)
    if (isNaN(lat) || isNaN(lng)) { showToast('Coordenadas inválidas', 'error'); return }
    setVtCasa(prev => [...prev, { lat, lng }])
    setManCasaLat(''); setManCasaLng(''); setShowCasaMap(true)
  }

  // ── Trincas ─────────────────────────────────────────────────
  const addTrinca = () => {
    setTrincasCasa(prev => [...prev, { codigo: nextCodigo, lat: null, lng: null, xPct: null, yPct: null }])
    setMarcandoTrinca(true)
  }

  const markTrincaOnDiagram = (xPct, yPct) => {
    if (!marcandoTrinca) return
    const idx = trincasCasa.findIndex(t => t.xPct == null && t.yPct == null)
    if (idx >= 0) {
      setTrincasCasa(prev => {
        const next = [...prev]
        next[idx] = { ...next[idx], xPct, yPct }
        return next
      })
    }
    setMarcandoTrinca(false)
    showToast(`${trincasCasa[idx]?.codigo || 'Trinca'} marcada na planta!`)
  }

  const removeTrinca = idx => setTrincasCasa(prev => prev.filter((_, i) => i !== idx))

  // ── Salvar ──────────────────────────────────────────────────
  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.proprietario) { showToast('Proprietário é obrigatório', 'error'); return }
    setSaving(true)
    try {
      const body = {
        ...form,
        latitude: position?.lat || null, longitude: position?.lng || null,
        nome: form.proprietario,
        areaTerrenho: vtTerreno.length > 0 ? vtTerreno : null,
        verticesCasa:  vtCasa.length > 0   ? vtCasa   : null,
        alturaCasa:    alturaCasa ? parseFloat(alturaCasa) : null,
        trincasCasa:   trincasCasa.length > 0 ? trincasCasa : null,
      }
      const res = await fetch(isEditing ? `${API_BASE}/monitoramento/${id}` : `${API_BASE}/monitoramento`, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Erro ao salvar')
      const data = await res.json()
      showToast(isEditing ? 'Imóvel atualizado!' : 'Imóvel cadastrado!')
      setTimeout(() => navigate(isEditing ? `/monitoramento/${id}` : `/monitoramento/${data.id}`), 800)
    } catch (err) { showToast(err.message, 'error') }
    finally { setSaving(false) }
  }

  const backPath = isEditing ? `/monitoramento/${id}` : '/monitoramento/imoveis'

  // ── Render ──────────────────────────────────────────────────
  return (
    <MonitoramentoLayout>
      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.msg}</div>}

      <div className={styles.back}>
        <Link to={backPath} className={styles.backLink}>← Voltar</Link>
      </div>

      <div className={styles.pageTitle}>{isEditing ? 'Editar Imóvel' : 'Cadastrar Imóvel'}</div>

      {/* ── Abas ─────────────────────────────────────────── */}
      <div className={styles.tabs}>
        {[['dados','📋 Dados'],['terreno','🌍 Terreno'],['casa','🏠 Casa']].map(([k,label]) => (
          <button key={k} className={`${styles.tabBtn} ${tab === k ? styles.tabBtnActive : ''}`}
            onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      <form onSubmit={handleSubmit}>

        {/* ── ABA DADOS ─────────────────────────────────── */}
        {tab === 'dados' && (
          <div className={styles.section}>
            <div className={styles.field}>
              <label className={styles.label}>Proprietário *</label>
              <input className={styles.input} name="proprietario" value={form.proprietario}
                onChange={handleChange} placeholder="Ex: João da Silva" required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Celular (com DDD)</label>
              <input className={styles.input} name="celular" value={form.celular}
                onChange={handleChange} placeholder="(31) 99999-9999" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Cidade</label>
              <input className={styles.input} name="cidade" value={form.cidade}
                onChange={handleChange} placeholder="Ex: Ouro Branco" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Endereço</label>
              <textarea className={styles.textarea} name="endereco" value={form.endereco}
                onChange={handleChange} placeholder="Rua das Flores, 123" rows={2} />
            </div>

            <div className={styles.gpsBox}>
              <div className={styles.gpsHeader}>
                <span className={styles.label}>📍 GPS do Imóvel</span>
                <button type="button" className={styles.btnGps}
                  onClick={() => requestGps('ponto')} disabled={locating}>
                  {locating && gpsTarget==='ponto' ? '⏳…' : '📍 Capturar'}
                </button>
              </div>
              {position && (
                <div className={styles.gpsCoords}>
                  <div className={styles.coordField}><label>Lat</label>
                    <input className={styles.input} value={position.lat.toFixed(7)} readOnly /></div>
                  <div className={styles.coordField}><label>Lng</label>
                    <input className={styles.input} value={position.lng.toFixed(7)} readOnly /></div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ABA TERRENO ───────────────────────────────── */}
        {tab === 'terreno' && (
          <div className={styles.section}>
            <p className={styles.hint}>
              Defina o polígono do <b>terreno</b> ao redor da edificação. Percorra os limites e capture cada vértice com GPS.
            </p>

            <div className={styles.captureBtns}>
              <button type="button" className={styles.btnCapture}
                onClick={() => requestGps('terreno')} disabled={locating}>
                {locating && gpsTarget==='terreno' ? '⏳ Aguarde…' : '📍 Capturar ponto GPS'}
              </button>
            </div>

            <div className={styles.manualRow}>
              <input className={styles.inputSm} placeholder="Lat" value={manLat}
                onChange={e => setManLat(e.target.value)} inputMode="decimal" />
              <input className={styles.inputSm} placeholder="Lng" value={manLng}
                onChange={e => setManLng(e.target.value)} inputMode="decimal" />
              <button type="button" className={styles.btnAdd} onClick={addManualTerreno}>+ Add</button>
            </div>

            {vtTerreno.length > 0 ? (
              <>
                <div className={styles.vertList}>
                  {vtTerreno.map((v, i) => (
                    <div key={i} className={styles.vertItem}>
                      <span className={styles.vertBadge}>P{i+1}</span>
                      <span className={styles.vertCoord}>{v.lat.toFixed(6)}, {v.lng.toFixed(6)}</span>
                      <button type="button" className={styles.btnRemove}
                        onClick={() => setVtTerreno(prev => prev.filter((_,j)=>j!==i))}>✕</button>
                    </div>
                  ))}
                </div>
                <button type="button" className={styles.btnToggleMap}
                  onClick={() => setShowTerrMap(v => !v)}>
                  {showTerrMap ? '🗺️ Ocultar mapa' : '🗺️ Ver no mapa'}
                </button>
                {showTerrMap && <MiniMap pontos={vtTerreno} corPonto="#22c55e" />}
              </>
            ) : (
              <div className={styles.emptyHint}>Nenhum ponto adicionado ainda.</div>
            )}
          </div>
        )}

        {/* ── ABA CASA ──────────────────────────────────── */}
        {tab === 'casa' && (
          <div className={styles.section}>
            <p className={styles.hint}>
              Defina o <b>contorno da edificação</b> (vértices dos cantos), a altura e marque as trincas.
            </p>

            {/* ── Vértices da casa ── */}
            <div className={styles.subSection}>
              <div className={styles.subTitle}>📐 Vértices da edificação</div>
              <div className={styles.captureBtns}>
                <button type="button" className={styles.btnCapture}
                  onClick={() => requestGps('casa')} disabled={locating}>
                  {locating && gpsTarget==='casa' ? '⏳ Aguarde…' : '📍 Capturar vértice GPS'}
                </button>
              </div>
              <div className={styles.manualRow}>
                <input className={styles.inputSm} placeholder="Lat" value={manCasaLat}
                  onChange={e => setManCasaLat(e.target.value)} inputMode="decimal" />
                <input className={styles.inputSm} placeholder="Lng" value={manCasaLng}
                  onChange={e => setManCasaLng(e.target.value)} inputMode="decimal" />
                <button type="button" className={styles.btnAdd} onClick={addManualCasa}>+ Add</button>
              </div>

              {vtCasa.length > 0 ? (
                <>
                  <div className={styles.vertList}>
                    {vtCasa.map((v, i) => (
                      <div key={i} className={styles.vertItem}>
                        <span className={styles.vertBadge}>V{i+1}</span>
                        <span className={styles.vertCoord}>{v.lat.toFixed(6)}, {v.lng.toFixed(6)}</span>
                        <button type="button" className={styles.btnRemove}
                          onClick={() => setVtCasa(prev => prev.filter((_,j)=>j!==i))}>✕</button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className={styles.btnToggleMap}
                    onClick={() => setShowCasaMap(v => !v)}>
                    {showCasaMap ? '🗺️ Ocultar mapa' : '🗺️ Ver no mapa'}
                  </button>
                  {showCasaMap && <MiniMap pontos={vtCasa} corPonto="#2563eb" />}
                </>
              ) : (
                <div className={styles.emptyHint}>Nenhum vértice adicionado.</div>
              )}
            </div>

            {/* ── Altura ── */}
            <div className={styles.subSection}>
              <div className={styles.subTitle}>📏 Altura da edificação</div>
              <div className={styles.alturaRow}>
                <input className={styles.input} type="number" step="0.1" min="1" max="100"
                  placeholder="Ex: 3.5" value={alturaCasa}
                  onChange={e => setAlturaCasa(e.target.value)} />
                <span className={styles.alturaUnit}>metros</span>
              </div>
            </div>

            {/* ── Trincas da casa ── */}
            <div className={styles.subSection}>
              <div className={styles.subTitle}>🔴 Pontos de Trinca</div>
              <p className={styles.hint} style={{marginTop:0}}>
                Marque na planta (toque no diagrama) <b>ou</b> capture o GPS estando no local da trinca.
              </p>

              {trincasCasa.length > 0 && (
                <div className={styles.trincaList}>
                  {trincasCasa.map((t, i) => (
                    <div key={i} className={styles.trincaItem}>
                      <div className={styles.trincaHeader}>
                        <span className={styles.trincaBadge}>{t.codigo}</span>
                        <div className={styles.trincaActions}>
                          <button type="button" className={styles.btnGpsSmall}
                            onClick={() => requestGps('trinca', i)}>
                            📍 GPS
                          </button>
                          <button type="button" className={styles.btnRemove}
                            onClick={() => removeTrinca(i)}>✕</button>
                        </div>
                      </div>
                      {t.lat && t.lng && (
                        <div className={styles.trincaCoord}>
                          GPS: {t.lat.toFixed(6)}, {t.lng.toFixed(6)}
                        </div>
                      )}
                      {t.xPct != null && t.yPct != null && (
                        <div className={styles.trincaCoord}>
                          Planta: {Math.round(t.xPct * 100)}%, {Math.round(t.yPct * 100)}%
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button type="button" className={styles.btnAddTrinca} onClick={addTrinca}>
                + Adicionar Trinca ({nextCodigo})
              </button>

              {/* Diagrama 2D da planta */}
              {(trincasCasa.length > 0 || vtCasa.length >= 2) && (
                <CasaDiagram
                  vertices={vtCasa}
                  trincas={trincasCasa}
                  onMarkTrinca={markTrincaOnDiagram}
                  nextCodigo={marcandoTrinca ? nextCodigo : '—'}
                />
              )}
              {marcandoTrinca && (
                <div className={styles.marcandoAlert}>
                  Toque na planta acima para posicionar {nextCodigo}
                  <button type="button" className={styles.btnCancelMarca}
                    onClick={() => {
                      setTrincasCasa(prev => prev.slice(0, -1))
                      setMarcandoTrinca(false)
                    }}>Cancelar</button>
                </div>
              )}
            </div>

            {/* ── Modelo 3D com Edificação (gpsVerts) da Vistoria Residencial ── */}
            {edificacaoPlanta?.gpsVerts?.length > 0 && vtCasa.length >= 3 && parseFloat(alturaCasa) > 0 && (
              <div className={styles.subSection}>
                <div className={styles.subTitle}>🏠 Modelo 3D do Imóvel — Terreno + Edificação</div>
                <p className={styles.hint} style={{ marginTop: 0 }}>
                  Modelo 3D com terreno e edificação registrados na Vistoria Residencial. Somente leitura.
                </p>
                <Edificio3D
                  vertices={vtCasa}
                  altura={parseFloat(alturaCasa)}
                  anomalias={[]}
                  onAddAnomalia={() => {}}
                  onRemoveAnomalia={() => {}}
                  showPontoButton={false}
                  showTrincaButton={false}
                  edificacaoSalva={edificacaoPlanta}
                />
              </div>
            )}

            {/* ── Planta da Edificação (formato antigo, vertices) ── */}
            {edificacaoPlanta?.vertices?.length > 0 && !edificacaoPlanta?.gpsVerts && (
              <div className={styles.subSection}>
                <div className={styles.subTitle}>🏗️ Planta da Edificação (Vistoria Residencial)</div>
                <p className={styles.hint} style={{ marginTop: 0 }}>
                  Planta registrada na Vistoria Residencial. Somente leitura.
                </p>
                <LocalizacaoEdificacao value={edificacaoPlanta} readonly />
              </div>
            )}
          </div>
        )}

        {/* ── Botão salvar ─────────────────────────────── */}
        <div className={styles.saveRow}>
          <button type="submit" className={styles.btnSave} disabled={saving}>
            {saving ? '⏳ Salvando…' : (isEditing ? '✅ Atualizar' : '💾 Salvar Imóvel')}
          </button>
        </div>
      </form>

      {/* ── Dialog GPS ───────────────────────────────────── */}
      {showGpsDialog && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <h3>Capturar localização GPS?</h3>
            <p>
              {gpsTarget === 'ponto'   && 'Localização principal do imóvel.'}
              {gpsTarget === 'terreno' && `Vértice ${vtTerreno.length + 1} do polígono do terreno.`}
              {gpsTarget === 'casa'    && `Vértice ${vtCasa.length + 1} do contorno da edificação.`}
              {gpsTarget === 'trinca'  && `Posição GPS da trinca ${trincasCasa[gpsTargetTrincaIdx]?.codigo}.`}
            </p>
            <div className={styles.dialogBtns}>
              <button className={styles.btnCancel} onClick={() => setShowGpsDialog(false)}>Cancelar</button>
              <button className={styles.btnPrimary} onClick={getLocation}>Capturar</button>
            </div>
          </div>
        </div>
      )}
    </MonitoramentoLayout>
  )
}
