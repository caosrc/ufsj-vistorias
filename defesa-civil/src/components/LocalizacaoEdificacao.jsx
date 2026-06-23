import { useRef, useEffect, useState, useCallback } from 'react'

const CW = 480, CH = 300, PAD = 28

function toCanvas(nx, ny) {
  return { x: nx * (CW - 2 * PAD) + PAD, y: ny * (CH - 2 * PAD) + PAD }
}

function toNorm(cx, cy) {
  return {
    x: Math.min(1, Math.max(0, (cx - PAD) / (CW - 2 * PAD))),
    y: Math.min(1, Math.max(0, (cy - PAD) / (CH - 2 * PAD))),
  }
}

function nearestOnSeg(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { x: ax, y: ay, dist: Math.hypot(px - ax, py - ay) }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  const nx = ax + t * dx, ny = ay + t * dy
  return { x: nx, y: ny, dist: Math.hypot(px - nx, py - ny) }
}

function snapToPoly(cvPts, px, py) {
  let best = null
  for (let i = 0; i < cvPts.length; i++) {
    const a = cvPts[i], b = cvPts[(i + 1) % cvPts.length]
    const r = nearestOnSeg(a.x, a.y, b.x, b.y, px, py)
    if (!best || r.dist < best.dist) best = r
  }
  return best
}

function drawCanvas(canvas, verts, closed, anomalias, mode, pendingStart, mouse) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, CW, CH)

  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, CW, CH)
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 0.5
  for (let x = 0; x <= CW; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke() }
  for (let y = 0; y <= CH; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke() }

  if (verts.length === 0) {
    ctx.fillStyle = '#94a3b8'; ctx.font = '13px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('Clique "Desenhar Edificação" para iniciar', CW / 2, CH / 2)
    return
  }

  const cv = verts.map(v => toCanvas(v.x, v.y))

  if (closed && cv.length >= 3) {
    ctx.beginPath(); ctx.moveTo(cv[0].x, cv[0].y)
    cv.forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath()
    ctx.fillStyle = 'rgba(219,234,254,0.55)'; ctx.fill()
  }

  if (cv.length >= 2) {
    ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.moveTo(cv[0].x, cv[0].y)
    for (let i = 1; i < cv.length; i++) ctx.lineTo(cv[i].x, cv[i].y)
    if (closed) ctx.closePath()
    ctx.stroke()
  }

  if (!closed && mode === 'draw' && cv.length >= 1 && mouse) {
    ctx.setLineDash([5, 4]); ctx.strokeStyle = '#93c5fd'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(cv[cv.length - 1].x, cv[cv.length - 1].y)
    ctx.lineTo(mouse.x, mouse.y); ctx.stroke(); ctx.setLineDash([])
  }

  cv.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(p.x, p.y, i === 0 ? 8 : 5, 0, Math.PI * 2)
    ctx.fillStyle = i === 0 ? '#22c55e' : '#1d4ed8'; ctx.fill()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
    ctx.fillStyle = i === 0 ? '#16a34a' : '#1e40af'
    ctx.font = 'bold 9px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
    ctx.fillText(`V${i + 1}`, p.x, p.y - 10)
  })

  if (closed && mode === 'anomalia' && !pendingStart && mouse && cv.length >= 2) {
    const snap = snapToPoly(cv, mouse.x, mouse.y)
    if (snap && snap.dist < 32) {
      ctx.beginPath(); ctx.arc(snap.x, snap.y, 8, 0, Math.PI * 2)
      ctx.fillStyle = '#f97316'; ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
    }
  }

  if (pendingStart && mouse) {
    const ps = toCanvas(pendingStart.x, pendingStart.y)
    ctx.beginPath(); ctx.arc(ps.x, ps.y, 7, 0, Math.PI * 2)
    ctx.fillStyle = '#dc2626'; ctx.fill()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
    ctx.setLineDash([5, 4]); ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(ps.x, ps.y); ctx.lineTo(mouse.x, mouse.y)
    ctx.stroke(); ctx.setLineDash([])
  }

  anomalias.forEach(a => {
    const s = toCanvas(a.start.x, a.start.y)
    const e = toCanvas(a.end.x, a.end.y)
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke()
    ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#dc2626'; ctx.fill()
    ctx.beginPath(); ctx.arc(e.x, e.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#991b1b'; ctx.fill()
    const mx = (s.x + e.x) / 2, my = (s.y + e.y) / 2
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const tw = ctx.measureText(a.label).width + 8
    ctx.fillStyle = 'rgba(153,27,27,0.85)'
    ctx.beginPath()
    ctx.roundRect(mx - tw / 2, my - 9, tw, 18, 4)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText(a.label, mx, my)
  })

  ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('N ↑', CW / 2, 2)
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('O', 2, CH / 2)
  ctx.textAlign = 'right'; ctx.fillText('L', CW - 2, CH / 2)
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('S ↓', CW / 2, CH - 2)
}

export default function LocalizacaoEdificacao({ value, onChange, readonly = false }) {
  const canvasRef = useRef(null)
  const counterRef = useRef(1)

  const [verts, setVerts] = useState(() => value?.vertices || [])
  const [closed, setClosed] = useState(() => (value?.vertices?.length || 0) >= 3)
  const [anomalias, setAnomalias] = useState(() => value?.anomalias || [])
  const [mode, setMode] = useState(null)
  const [pendingStart, setPendingStart] = useState(null)
  const [mouse, setMouse] = useState(null)

  useEffect(() => {
    if (value) {
      setVerts(value.vertices || [])
      setClosed((value.vertices?.length || 0) >= 3)
      setAnomalias(value.anomalias || [])
      counterRef.current = (value.anomalias?.length || 0) + 1
    }
  }, [])

  useEffect(() => {
    drawCanvas(canvasRef.current, verts, closed, anomalias, mode, pendingStart, mouse)
  }, [verts, closed, anomalias, mode, pendingStart, mouse])

  const notify = useCallback((v, a) => { onChange?.({ vertices: v, anomalias: a }) }, [onChange])

  const getXY = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (CW / rect.width),
      y: (e.clientY - rect.top) * (CH / rect.height),
    }
  }

  const handleClick = (e) => {
    if (readonly) return
    const { x, y } = getXY(e)

    if (mode === 'draw' && !closed) {
      const norm = toNorm(x, y)
      if (verts.length >= 3) {
        const fp = toCanvas(verts[0].x, verts[0].y)
        if (Math.hypot(x - fp.x, y - fp.y) < 18) {
          setClosed(true); setMode(null); notify(verts, anomalias); return
        }
      }
      const nv = [...verts, norm]
      setVerts(nv); notify(nv, anomalias); return
    }

    if (mode === 'anomalia' && closed) {
      const cv = verts.map(v => toCanvas(v.x, v.y))
      if (!pendingStart) {
        const snap = snapToPoly(cv, x, y)
        if (snap && snap.dist < 40) setPendingStart(toNorm(snap.x, snap.y))
      } else {
        const end = toNorm(x, y)
        const label = `P${counterRef.current++}`
        const na = [...anomalias, { id: Date.now(), label, start: pendingStart, end }]
        setAnomalias(na); setPendingStart(null); notify(verts, na)
      }
    }
  }

  const fecharPoly = () => {
    if (verts.length >= 3) { setClosed(true); setMode(null); notify(verts, anomalias) }
  }

  const limpar = () => {
    setVerts([]); setClosed(false); setAnomalias([]); setMode(null); setPendingStart(null)
    counterRef.current = 1; onChange?.({ vertices: [], anomalias: [] })
  }

  const remover = (id) => {
    const na = anomalias.filter(a => a.id !== id); setAnomalias(na); notify(verts, na)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!readonly && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button"
            onClick={() => { setMode(m => m === 'draw' ? null : 'draw'); setPendingStart(null) }}
            style={{
              padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700,
              border: 'none', cursor: 'pointer',
              background: mode === 'draw' ? '#1d4ed8' : '#dbeafe',
              color: mode === 'draw' ? '#fff' : '#1d4ed8',
            }}>
            {mode === 'draw' ? '✕ Sair do Desenho' : '✏️ Desenhar Edificação'}
          </button>

          {closed && (
            <button type="button"
              onClick={() => { setMode(m => m === 'anomalia' ? null : 'anomalia'); setPendingStart(null) }}
              style={{
                padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                border: 'none', cursor: 'pointer',
                background: mode === 'anomalia' ? '#dc2626' : '#fee2e2',
                color: mode === 'anomalia' ? '#fff' : '#dc2626',
              }}>
              {mode === 'anomalia'
                ? (pendingStart ? '🔴 Clique para finalizar linha' : '✕ Sair')
                : '📍 Marcar Parede com Anomalia'}
            </button>
          )}

          {!closed && verts.length >= 3 && (
            <button type="button" onClick={fecharPoly}
              style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: '#22c55e', color: '#fff' }}>
              ✓ Fechar Polígono
            </button>
          )}

          {verts.length > 0 && (
            <button type="button" onClick={limpar}
              style={{ padding: '6px 10px', borderRadius: 7, fontSize: 12, border: '1px solid #e2e8f0', cursor: 'pointer', background: '#f8fafc', color: '#64748b' }}>
              🗑️ Limpar
            </button>
          )}
        </div>
      )}

      {mode === 'draw' && !closed && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '7px 12px', fontSize: 12, color: '#92400e' }}>
          ✏️ Clique para adicionar vértices (V1, V2...). Com ≥3 pontos, clique no ponto verde inicial ou "Fechar Polígono".
        </div>
      )}
      {mode === 'anomalia' && !pendingStart && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '7px 12px', fontSize: 12, color: '#991b1b' }}>
          📍 Clique sobre uma parede da edificação (borda laranja destacada) para iniciar a marcação.
        </div>
      )}
      {mode === 'anomalia' && pendingStart && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '7px 12px', fontSize: 12, color: '#991b1b' }}>
          🔴 Agora clique dentro do imóvel para indicar até onde vai a anomalia na parede.
        </div>
      )}

      <canvas ref={canvasRef} width={CW} height={CH}
        onClick={handleClick}
        onMouseMove={e => !readonly && setMouse(getXY(e))}
        onMouseLeave={() => setMouse(null)}
        style={{
          width: '100%', height: 'auto', display: 'block',
          borderRadius: 10, border: '1.5px solid #bfdbfe',
          cursor: mode === 'draw' ? 'crosshair' : mode === 'anomalia' ? 'pointer' : 'default',
        }}
      />

      {anomalias.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {anomalias.map(a => (
            <div key={a.id} style={{
              background: '#fff', border: '1.5px solid #fca5a544', borderRadius: 8,
              padding: '4px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontWeight: 700, color: '#dc2626' }}>{a.label}</span>
              <span style={{ color: '#64748b' }}>parede com anomalia</span>
              {!readonly && (
                <button type="button" onClick={() => remover(a.id)}
                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {readonly && verts.length === 0 && (
        <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', margin: 0 }}>
          Nenhuma planta da edificação cadastrada na Vistoria Residencial.
        </p>
      )}
    </div>
  )
}
