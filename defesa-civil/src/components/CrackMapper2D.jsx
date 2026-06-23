import { useRef, useEffect, useState, useCallback } from 'react'

const TIPOS_CRINCA = [
  { id: 'vertical',   label: 'Vertical',   icon: '↕', cor: '#dc2626', desc: 'Rachadura de cima para baixo' },
  { id: 'diagonal',   label: 'Diagonal',   icon: '↗', cor: '#ea580c', desc: 'Rachadura em ângulo' },
  { id: 'horizontal', label: 'Horizontal', icon: '↔', cor: '#d97706', desc: 'Rachadura lateral' },
  { id: 'escalonada', label: 'Escalonada', icon: '⌐', cor: '#7c3aed', desc: 'Rachadura em degraus' },
]

// ── Correlação geotécnica ───────────────────────────────────
export function calcCorrelacao(trincas, direcaoEncosta) {
  if (!trincas || trincas.length === 0) return null
  const cnt = {}
  trincas.forEach(t => { cnt[t.tipo] = (cnt[t.tipo] || 0) + 1 })
  const qtd = trincas.length
  const diag = cnt.diagonal || 0
  const vert = cnt.vertical || 0
  const horiz = cnt.horizontal || 0

  let alinhado = false
  if (direcaoEncosta != null && trincas.length >= 2) {
    const signif = trincas.filter(t => t.tipo === 'diagonal' || t.tipo === 'vertical')
    if (signif.length >= 1) {
      const avgDir = signif.reduce((s, t) => s + t.direcao, 0) / signif.length
      const diff = Math.abs(((avgDir - direcaoEncosta + 180) % 360) - 180)
      alinhado = diff < 40
    }
  }

  if ((diag + vert) >= Math.ceil(qtd * 0.6) && alinhado) {
    return {
      tipo: 'movimento_massa', nivel: 'alto', cor: '#dc2626', bg: '#fef2f2', icon: '🔴',
      titulo: 'Forte Indício de Movimento de Massa',
      desc: 'Trincas alinhadas com a direção de máxima declividade. Provável rastejo, escorregamento lento ou instabilidade do maciço.',
      acoes: ['Avaliar evacuação preventiva (R3/R4)', 'Instalar medidores de recalque/abertura', 'Monitoramento contínuo das trincas'],
    }
  }
  if (horiz >= Math.ceil(qtd * 0.5)) {
    return {
      tipo: 'empuxo_solo', nivel: 'medio', cor: '#d97706', bg: '#fffbeb', icon: '🟠',
      titulo: 'Indício de Empuxo de Solo',
      desc: 'Trincas horizontais predominantes — típicas de pressão lateral do solo em muros ou estruturas de contenção.',
      acoes: ['Inspecionar muros de arrimo', 'Verificar sistema de drenagem', 'Avaliar necessidade de reforço de contenção'],
    }
  }
  if (vert >= Math.ceil(qtd * 0.5) && !alinhado) {
    return {
      tipo: 'recalque', nivel: 'medio', cor: '#ca8a04', bg: '#fefce8', icon: '🟡',
      titulo: 'Possível Recalque de Fundação',
      desc: 'Trincas verticais localizadas sem correlação com a declividade — indica problema estrutural ou de fundação.',
      acoes: ['Investigar fundações (sondagem)', 'Verificar histórico de corte/aterro no local', 'Avaliar com engenheiro estrutural'],
    }
  }
  if (qtd >= 3 && Object.keys(cnt).length >= 2) {
    return {
      tipo: 'multiplo', nivel: 'atencao', cor: '#7c3aed', bg: '#f5f3ff', icon: '⚠️',
      titulo: 'Múltiplos Processos Identificados',
      desc: 'Padrão misto de trincas indica possível combinação de movimentação de encosta e problemas estruturais locais.',
      acoes: ['Avaliação multidisciplinar recomendada', 'Levantamento topográfico de precisão', 'Monitoramento frequente'],
    }
  }
  return {
    tipo: 'insuficiente', nivel: 'baixo', cor: '#64748b', bg: '#f8fafc', icon: '⚪',
    titulo: 'Dados Insuficientes para Correlação',
    desc: 'Poucos pontos para análise conclusiva. Informe a direção da encosta e adicione mais trincas para melhorar a análise.',
    acoes: ['Continuar coleta de pontos', 'Informar direção da encosta (graus)'],
  }
}

// ── Projeção reversa: local-3D → lat/lng ─────────────────────
function local3DToLatLng(vertices, x3d, z3d) {
  if (!vertices || vertices.length < 3) return null
  const ref = vertices[0]
  const R = 6371000
  const cosLat = Math.cos(ref.lat * Math.PI / 180)
  const raw = vertices.map(v => ({
    x: (v.lng - ref.lng) * cosLat * Math.PI / 180 * R,
    z: -(v.lat - ref.lat) * Math.PI / 180 * R,
  }))
  const cx = raw.reduce((s, p) => s + p.x, 0) / raw.length
  const cz = raw.reduce((s, p) => s + p.z, 0) / raw.length
  const centered = raw.map(p => ({ x: p.x - cx, z: p.z - cz }))
  const maxR = Math.max(...centered.map(p => Math.sqrt(p.x * p.x + p.z * p.z)), 0.1)
  const scale = 12 / maxR
  const xUnscaled = x3d / scale + cx
  const zUnscaled = z3d / scale + cz
  return {
    lat: ref.lat - zUnscaled / (Math.PI / 180 * R),
    lng: ref.lng + xUnscaled / (cosLat * Math.PI / 180 * R),
  }
}

// ── Helpers de geometria ─────────────────────────────────────
function getBounds(vertices) {
  const lats = vertices.map(v => v.lat)
  const lngs = vertices.map(v => v.lng)
  return {
    minLat: Math.min(...lats), maxLat: Math.max(...lats),
    minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
  }
}

function polyToCanvas(vertices, W, H, pad = 44) {
  if (!vertices || vertices.length < 3) return { pts: [], offX: pad, offY: pad, scale: 1, bounds: null }
  const b = getBounds(vertices)
  const latR = b.maxLat - b.minLat || 0.00001
  const lngR = b.maxLng - b.minLng || 0.00001
  const drawW = W - pad * 2, drawH = H - pad * 2
  const scale = Math.min(drawW / lngR, drawH / latR)
  const offX = pad + (drawW - lngR * scale) / 2
  const offY = pad + (drawH - latR * scale) / 2
  const pts = vertices.map(v => ({
    x: offX + (v.lng - b.minLng) * scale,
    y: offY + (b.maxLat - v.lat) * scale,
  }))
  return { pts, offX, offY, scale, bounds: b }
}

function latLngToCanvas(lat, lng, ctx) {
  const { offX, offY, scale, bounds: b } = ctx
  return {
    x: offX + (lng - b.minLng) * scale,
    y: offY + (b.maxLat - lat) * scale,
  }
}

function canvasToLatLng(cx, cy, ctx) {
  const { offX, offY, scale, bounds: b } = ctx
  return {
    lat: b.maxLat - (cy - offY) / scale,
    lng: b.minLng + (cx - offX) / scale,
  }
}

function drawArrow(ctx, x, y, angleDeg, len, color) {
  const rad = (angleDeg - 90) * Math.PI / 180
  const ex = x + Math.cos(rad) * len, ey = y + Math.sin(rad) * len
  ctx.strokeStyle = color; ctx.lineWidth = 2.5
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke()
  const h = 8, a = 0.45
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - h * Math.cos(rad - a), ey - h * Math.sin(rad - a))
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - h * Math.cos(rad + a), ey - h * Math.sin(rad + a))
  ctx.stroke()
}

function drawCompass(ctx, cx, cy, r) {
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(15,23,42,0.82)'; ctx.fill()
  ctx.strokeStyle = '#475569'; ctx.lineWidth = 1; ctx.stroke()
  ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(cx, cy + r * 0.55); ctx.lineTo(cx, cy - r * 0.65); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.65); ctx.lineTo(cx - 4, cy - r * 0.1)
  ctx.moveTo(cx, cy - r * 0.65); ctx.lineTo(cx + 4, cy - r * 0.1); ctx.stroke()
  ctx.fillStyle = '#f8fafc'; ctx.font = `bold ${Math.round(r * 0.55)}px sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('N', cx, cy + r * 0.55)
}

function drawCrack(ctx, x, y, angleDeg, tipo, codigo, isHover) {
  const cor = TIPOS_CRINCA.find(t => t.id === tipo)?.cor || '#dc2626'
  const r = isHover ? 13 : 11

  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = isHover ? cor + '33' : cor + '22'; ctx.fill()
  ctx.strokeStyle = cor; ctx.lineWidth = isHover ? 2.5 : 2; ctx.stroke()

  ctx.strokeStyle = cor; ctx.lineWidth = isHover ? 3 : 2.5
  ctx.beginPath()
  if (tipo === 'horizontal') {
    ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y)
  } else if (tipo === 'diagonal') {
    ctx.moveTo(x - 6, y + 6); ctx.lineTo(x + 6, y - 6)
  } else if (tipo === 'vertical') {
    ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8)
  } else {
    ctx.moveTo(x - 7, y + 2); ctx.lineTo(x - 3, y + 2)
    ctx.lineTo(x - 3, y - 2); ctx.lineTo(x + 3, y - 2)
    ctx.lineTo(x + 3, y + 2); ctx.lineTo(x + 7, y + 2)
  }
  ctx.stroke()

  drawArrow(ctx, x, y, angleDeg, isHover ? 26 : 22, cor)

  ctx.fillStyle = '#1e293b'; ctx.font = `bold 10px sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(codigo, x, y)
}

function renderCanvas(canvas, verticesCasa, trincas, pendingLatLng, pendingDirecao, hover, readonly, anomalias3D, edificacaoGps) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#f1f5f9'; ctx.fillRect(0, 0, W, H)

  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1
  for (let x = 0; x < W; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
  for (let y = 0; y < H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

  const geo = polyToCanvas(verticesCasa, W, H)

  if (geo.pts.length >= 3) {
    ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 8; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2
    ctx.beginPath(); ctx.moveTo(geo.pts[0].x, geo.pts[0].y)
    geo.pts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath()
    ctx.fillStyle = '#dbeafe'; ctx.fill()
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0
    ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 2.5; ctx.stroke()
    geo.pts.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#1d4ed8'; ctx.fill()
    })
    ctx.fillStyle = 'rgba(29,78,216,0.07)'; ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const cx2 = geo.pts.reduce((s, p) => s + p.x, 0) / geo.pts.length
    const cy2 = geo.pts.reduce((s, p) => s + p.y, 0) / geo.pts.length
    ctx.fillStyle = 'rgba(29,78,216,0.4)'; ctx.fillText('Planta do Imóvel', cx2, cy2)
  } else {
    ctx.fillStyle = '#94a3b8'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('Polígono do imóvel não disponível', W / 2, H / 2 - 8)
    ctx.font = '11px sans-serif'; ctx.fillText('(Cadastre a localização da área na Vistoria)', W / 2, H / 2 + 10)
  }

  // ── Polígono da Edificação (GPS) ──────────────────────────────
  if (edificacaoGps && edificacaoGps.length >= 3 && geo.bounds) {
    const edifPts = edificacaoGps.map(v => latLngToCanvas(v.lat, v.lng, geo))
    ctx.beginPath(); ctx.moveTo(edifPts[0].x, edifPts[0].y)
    edifPts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath()
    ctx.fillStyle = 'rgba(234,179,8,0.15)'; ctx.fill()
    ctx.strokeStyle = '#ca8a04'; ctx.lineWidth = 2; ctx.setLineDash([6, 3]); ctx.stroke()
    ctx.setLineDash([])
    const ecx = edifPts.reduce((s, p) => s + p.x, 0) / edifPts.length
    const ecy = edifPts.reduce((s, p) => s + p.y, 0) / edifPts.length
    ctx.fillStyle = '#92400e'; ctx.font = 'bold 10px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('Edificação', ecx, ecy)
  }

  trincas.forEach(t => {
    if (!geo.bounds) return
    const { x, y } = latLngToCanvas(t.lat, t.lng, geo)
    drawCrack(ctx, x, y, t.direcao, t.tipo, t.codigo, hover === t.id)
  })

  // ── Pontos 3D (anomalias do modelo Edificio3D) ──────────────
  if (anomalias3D && anomalias3D.length > 0 && geo.bounds && verticesCasa && verticesCasa.length >= 3) {
    anomalias3D.forEach(a => {
      if (!a.point) return
      const ll = local3DToLatLng(verticesCasa, a.point.x, a.point.z)
      if (!ll) return
      const { x, y } = latLngToCanvas(ll.lat, ll.lng, geo)
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(234,88,12,0.18)'; ctx.fill()
      ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 2.5; ctx.stroke()
      ctx.fillStyle = '#ea580c'; ctx.font = 'bold 10px sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(a.nome, x, y)
    })
  }

  if (pendingLatLng && geo.bounds && !readonly) {
    const { x, y } = latLngToCanvas(pendingLatLng.lat, pendingLatLng.lng, geo)
    ctx.setLineDash([5, 4])
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2)
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.stroke()
    ctx.setLineDash([])
    drawArrow(ctx, x, y, pendingDirecao || 0, 22, '#f97316')
  }

  drawCompass(ctx, W - 38, 38, 20)
}

export default function CrackMapper2D({ verticesCasa, trincas = [], onUpdate, direcaoEncosta, readonly = false, anomalias3D = [], edificacaoGps = null }) {
  const canvasRef = useRef(null)
  const [modo, setModo] = useState(false)
  const [pendingLatLng, setPendingLatLng] = useState(null)
  const [form, setForm] = useState({ tipo: 'diagonal', direcao: 0 })
  const [hover, setHover] = useState(null)

  const redraw = useCallback(() => {
    renderCanvas(canvasRef.current, verticesCasa, trincas, pendingLatLng, form.direcao, hover, readonly, anomalias3D, edificacaoGps)
  }, [verticesCasa, trincas, pendingLatLng, form.direcao, hover, readonly, anomalias3D, edificacaoGps])

  useEffect(() => { redraw() }, [redraw])

  const getGeo = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return null
    return polyToCanvas(verticesCasa, canvas.width, canvas.height)
  }, [verticesCasa])

  const handleClick = (e) => {
    if (!modo || readonly) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scX = canvas.width / rect.width, scY = canvas.height / rect.height
    const cx = (e.clientX - rect.left) * scX, cy = (e.clientY - rect.top) * scY
    const geo = getGeo()
    if (!geo || !geo.bounds) return
    const ll = canvasToLatLng(cx, cy, geo)
    setPendingLatLng(ll)
  }

  const handleMouseMove = (e) => {
    if (readonly) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scX = canvas.width / rect.width, scY = canvas.height / rect.height
    const cx = (e.clientX - rect.left) * scX, cy = (e.clientY - rect.top) * scY
    const geo = getGeo()
    if (!geo || !geo.bounds) return
    let found = null
    for (const t of trincas) {
      const { x, y } = latLngToCanvas(t.lat, t.lng, geo)
      if (Math.hypot(cx - x, cy - y) < 16) { found = t.id; break }
    }
    setHover(found)
  }

  const confirmar = () => {
    if (!pendingLatLng) return
    const novaTrinca = {
      id: Date.now(),
      codigo: `T${trincas.length + 1}`,
      tipo: form.tipo,
      direcao: Number(form.direcao),
      lat: pendingLatLng.lat,
      lng: pendingLatLng.lng,
    }
    onUpdate([...trincas, novaTrinca])
    setPendingLatLng(null)
  }

  const remover = (id) => {
    const updated = trincas.filter(t => t.id !== id).map((t, i) => ({ ...t, codigo: `T${i + 1}` }))
    onUpdate(updated)
  }

  const analise = calcCorrelacao(trincas, direcaoEncosta)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Cabeçalho */}
      {!readonly && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>
            📐 Planta Baixa — Mapeamento de Trincas
          </span>
          <button type="button" onClick={() => { setModo(m => !m); setPendingLatLng(null) }}
            style={{
              padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
              background: modo ? '#dc2626' : '#2563eb', color: '#fff',
            }}>
            {modo ? '✕ Sair do modo marcar' : '📍 Marcar Trinca na Planta'}
          </button>
        </div>
      )}

      {/* Instrução */}
      {modo && !pendingLatLng && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#92400e' }}>
          ⚠️ Clique sobre a planta do imóvel para posicionar a trinca
        </div>
      )}

      {/* Formulário do ponto pendente */}
      {pendingLatLng && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#991b1b', whiteSpace: 'nowrap' }}>Nova trinca — {trincas.length + 1}:</span>
          <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
            style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #fca5a5' }}>
            {TIPOS_CRINCA.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <label style={{ fontSize: 12, color: '#991b1b', fontWeight: 600 }}>Direção (°N):</label>
            <input type="number" min={0} max={360} value={form.direcao}
              onChange={e => setForm(f => ({ ...f, direcao: e.target.value }))}
              style={{ width: 64, fontSize: 12, padding: '5px 6px', borderRadius: 6, border: '1px solid #fca5a5', textAlign: 'center' }}
            />
            <span style={{ fontSize: 10, color: '#94a3b8' }}>0=N 90=L 180=S 270=O</span>
          </div>
          <button type="button" onClick={confirmar}
            style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Confirmar
          </button>
          <button type="button" onClick={() => setPendingLatLng(null)}
            style={{ background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>
            Cancelar
          </button>
        </div>
      )}

      {/* Canvas */}
      <canvas ref={canvasRef} width={560} height={340}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        style={{
          width: '100%', height: 'auto', borderRadius: 10, border: '1.5px solid #bfdbfe',
          cursor: modo ? 'crosshair' : (hover ? 'pointer' : 'default'),
          display: 'block',
        }}
      />

      {/* Legenda de tipos */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TIPOS_CRINCA.map(t => (
          <span key={t.id} style={{
            fontSize: 11, padding: '3px 9px', borderRadius: 12,
            background: t.cor + '18', border: `1px solid ${t.cor}44`, color: t.cor, fontWeight: 600,
          }}>
            {t.icon} {t.label}
          </span>
        ))}
      </div>

      {/* Lista de trincas */}
      {trincas.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {trincas.map(t => {
            const tc = TIPOS_CRINCA.find(x => x.id === t.tipo)
            return (
              <div key={t.id} style={{
                background: '#fff', border: `1.5px solid ${tc?.cor || '#dc2626'}44`,
                borderRadius: 8, padding: '4px 10px', fontSize: 11, color: '#1e293b',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ fontWeight: 700, color: tc?.cor }}>{t.codigo}</span>
                <span style={{ color: '#64748b' }}>{tc?.icon} {tc?.label}</span>
                <span style={{ color: '#94a3b8' }}>→ {t.direcao}°</span>
                {!readonly && (
                  <button type="button" onClick={() => remover(t.id)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Análise de correlação */}
      {analise && (
        <div style={{
          background: analise.bg, border: `1.5px solid ${analise.cor}44`,
          borderRadius: 10, padding: '12px 16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 18 }}>{analise.icon}</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: analise.cor }}>{analise.titulo}</span>
          </div>
          <p style={{ fontSize: 12, color: '#475569', margin: '0 0 8px' }}>{analise.desc}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {analise.acoes.map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: '#374151', display: 'flex', gap: 6 }}>
                <span style={{ color: analise.cor, flexShrink: 0 }}>›</span>
                <span>{a}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
