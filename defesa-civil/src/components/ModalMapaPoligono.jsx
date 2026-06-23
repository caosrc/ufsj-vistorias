import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as turf from '@turf/turf'
import { FiX, FiTrash2, FiCheck, FiMapPin, FiLayers, FiHome } from 'react-icons/fi'
import { api } from '../services/api'

const CAMADAS = [
  {
    id: 'satelite',
    label: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri',
    maxZoom: 22,
    maxNativeZoom: 19,
  },
  {
    id: 'ruas',
    label: 'Ruas',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    maxZoom: 22,
    maxNativeZoom: 19,
  },
]

const RISCO_CORES = { R1: '#22c55e', R2: '#eab308', R3: '#f97316', R4: '#ef4444' }

export default function ModalMapaPoligono({ coordAtual, onConfirm, onClose }) {
  const mapRef     = useRef(null)
  const leafletRef = useRef(null)
  const layerRef   = useRef(null)
  const tileRef    = useRef(null)
  const refLayerRef = useRef(null)

  // refs — área
  const vertsRef   = useRef([])
  const linesRef   = useRef([])
  const closeRef   = useRef(null)
  const polyRef    = useRef(null)

  // refs — edificação
  const edificVertsRef = useRef([])
  const edificLinesRef = useRef([])
  const edificCloseRef = useRef(null)
  const edificPolyRef  = useRef(null)

  const [count,         setCount]         = useState(0)
  const [areaM2,        setAreaM2]        = useState(null)
  const [fechado,       setFechado]       = useState(false)
  const [camada,        setCamada]        = useState('satelite')

  // estado — edificação
  const [edificMode,    setEdificMode]    = useState(false)
  const [edificCount,   setEdificCount]   = useState(0)
  const [edificFechado, setEdificFechado] = useState(false)

  useEffect(() => {
    if (leafletRef.current) return
    const lat = coordAtual?.lat ?? -20.5308
    const lng = coordAtual?.lng ?? -43.7023
    const map = L.map(mapRef.current, {
      center: [lat, lng], zoom: 18,
      zoomControl: true, doubleClickZoom: false,
      maxZoom: 22,
    })

    const cam = CAMADAS[0]
    tileRef.current = L.tileLayer(cam.url, {
      attribution: cam.attribution,
      maxZoom: cam.maxZoom,
      maxNativeZoom: cam.maxNativeZoom,
    }).addTo(map)

    refLayerRef.current = L.layerGroup().addTo(map)
    const layer = L.layerGroup().addTo(map)
    layerRef.current = layer
    leafletRef.current = map

    if (coordAtual?.lat) {
      L.circleMarker([coordAtual.lat, coordAtual.lng], {
        radius: 8, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.5, weight: 2,
      }).bindTooltip('Localização atual').addTo(refLayerRef.current)
    }

    carregarVistoriasRef(refLayerRef.current)

    map.on('click', handleClick)
    return () => { map.remove(); leafletRef.current = null }
  }, [])

  // sincroniza o handler de click quando o estado muda
  useEffect(() => {
    const map = leafletRef.current
    if (!map) return
    map.off('click')
    map.on('click', handleClick)
  }, [fechado, edificMode, edificFechado])

  async function carregarVistoriasRef(refLayer) {
    try {
      let vistorias = []
      try { vistorias = await api.getVistorias() } catch (_) {}
      const lsVistorias = JSON.parse(localStorage.getItem('vistorias') || '[]')
      const apiIds = new Set(vistorias.map(v => String(v.id)))
      const merged = [...vistorias, ...lsVistorias.filter(v => !apiIds.has(String(v.id)))]

      merged.forEach(v => {
        const rawVerts = v.area_vertices
        if (!rawVerts) return
        try {
          const verts = typeof rawVerts === 'string' ? JSON.parse(rawVerts) : rawVerts
          if (!Array.isArray(verts) || verts.length < 2) return
          const cor = RISCO_CORES[v.risco] || '#64748b'
          const lls = verts.map(p => [p.lat, p.lng])
          if (verts.length >= 3) {
            L.polygon(lls, {
              color: cor, fillColor: cor, fillOpacity: 0.1,
              weight: 2, dashArray: '5,4', opacity: 0.7,
            }).bindTooltip(
              `<b>${v.nome || 'Vistoria'}</b><br/>${v.risco || ''} · ${v.endereco || ''}`,
              { sticky: true }
            ).addTo(refLayer)
          } else {
            L.polyline(lls, { color: cor, weight: 2, opacity: 0.7, dashArray: '5,4' }).addTo(refLayer)
          }
        } catch (_) {}
      })
    } catch (_) {}
  }

  function trocarCamada(novaCamada) {
    if (!leafletRef.current || !tileRef.current) return
    setCamada(novaCamada)
    const cam = CAMADAS.find(c => c.id === novaCamada)
    tileRef.current.setUrl(cam.url)
    tileRef.current.options.maxZoom = cam.maxZoom
    tileRef.current.options.maxNativeZoom = cam.maxNativeZoom
  }

  function handleClick(e) {
    if (edificMode && fechado) {
      if (!edificFechado) addEdificVert(e.latlng)
      return
    }
    if (!fechado) addVert(e.latlng)
  }

  // ── Área ──────────────────────────────────────────────────────
  function addVert({ lat, lng }) {
    const verts   = vertsRef.current
    const isFirst = verts.length === 0
    const marker  = L.circleMarker([lat, lng], {
      radius: isFirst ? 9 : 6,
      color:  isFirst ? '#22c55e' : '#f59e0b',
      fillColor: isFirst ? '#22c55e' : '#f59e0b',
      fillOpacity: 1, weight: 2.5,
    }).bindTooltip(isFirst ? '⬤ Ponto inicial — clique para fechar' : `Ponto ${verts.length + 1}`)
    if (isFirst) {
      marker.on('click', ev => {
        L.DomEvent.stopPropagation(ev)
        if (vertsRef.current.length >= 3) fecharPoligono()
      })
    }
    marker.addTo(layerRef.current)
    const newV = { lat, lng, marker }
    verts.push(newV)
    setCount(verts.length)

    if (verts.length >= 2) {
      const prev = verts[verts.length - 2]
      const line = L.polyline([[prev.lat, prev.lng], [lat, lng]], {
        color: '#f59e0b', weight: 2.5, opacity: 0.9,
      }).addTo(layerRef.current)
      linesRef.current.push(line)
    }

    if (verts.length >= 3) {
      const first = verts[0]
      if (closeRef.current) layerRef.current.removeLayer(closeRef.current)
      closeRef.current = L.polyline([[lat, lng], [first.lat, first.lng]], {
        color: '#f59e0b', weight: 1.5, opacity: 0.5, dashArray: '5,6',
      }).addTo(layerRef.current)
    }
  }

  function fecharPoligono() {
    const verts = vertsRef.current
    if (verts.length < 3) return
    if (closeRef.current) { layerRef.current.removeLayer(closeRef.current); closeRef.current = null }
    if (polyRef.current)  layerRef.current.removeLayer(polyRef.current)
    polyRef.current = L.polygon(verts.map(v => [v.lat, v.lng]), {
      color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.22, weight: 2.5,
    }).addTo(layerRef.current)
    const ring = [...verts.map(v => [v.lng, v.lat]), [verts[0].lng, verts[0].lat]]
    const m2   = Math.round(turf.area(turf.polygon([ring])))
    setAreaM2(m2)
    setFechado(true)
    try {
      const bounds = L.latLngBounds(verts.map(v => [v.lat, v.lng]))
      leafletRef.current?.fitBounds(bounds, { padding: [40, 40], maxZoom: 19 })
    } catch (_) {}
  }

  function limpar() {
    const layer = layerRef.current
    vertsRef.current.forEach(v => layer.removeLayer(v.marker))
    linesRef.current.forEach(l => layer.removeLayer(l))
    if (closeRef.current) layer.removeLayer(closeRef.current)
    if (polyRef.current)  layer.removeLayer(polyRef.current)
    vertsRef.current = []
    linesRef.current = []
    closeRef.current = null
    polyRef.current  = null
    setCount(0); setAreaM2(null); setFechado(false)
    // limpar edificação também
    limparEdificacao()
    setEdificMode(false)
  }

  // ── Edificação ────────────────────────────────────────────────
  function addEdificVert({ lat, lng }) {
    const verts   = edificVertsRef.current
    const isFirst = verts.length === 0
    const marker  = L.circleMarker([lat, lng], {
      radius: isFirst ? 9 : 6,
      color:  isFirst ? '#22c55e' : '#2563eb',
      fillColor: isFirst ? '#22c55e' : '#2563eb',
      fillOpacity: 1, weight: 2.5,
    }).bindTooltip(isFirst ? '⬤ Ponto inicial — clique para fechar' : `Edif. Ponto ${verts.length + 1}`)
    if (isFirst) {
      marker.on('click', ev => {
        L.DomEvent.stopPropagation(ev)
        if (edificVertsRef.current.length >= 3) fecharEdificPoligono()
      })
    }
    marker.addTo(layerRef.current)
    const newV = { lat, lng, marker }
    verts.push(newV)
    setEdificCount(verts.length)

    if (verts.length >= 2) {
      const prev = verts[verts.length - 2]
      const line = L.polyline([[prev.lat, prev.lng], [lat, lng]], {
        color: '#2563eb', weight: 2.5, opacity: 0.9,
      }).addTo(layerRef.current)
      edificLinesRef.current.push(line)
    }

    if (verts.length >= 3) {
      const first = verts[0]
      if (edificCloseRef.current) layerRef.current.removeLayer(edificCloseRef.current)
      edificCloseRef.current = L.polyline([[lat, lng], [first.lat, first.lng]], {
        color: '#2563eb', weight: 1.5, opacity: 0.5, dashArray: '5,6',
      }).addTo(layerRef.current)
    }
  }

  function fecharEdificPoligono() {
    const verts = edificVertsRef.current
    if (verts.length < 3) return
    if (edificCloseRef.current) { layerRef.current.removeLayer(edificCloseRef.current); edificCloseRef.current = null }
    if (edificPolyRef.current)  layerRef.current.removeLayer(edificPolyRef.current)
    edificPolyRef.current = L.polygon(verts.map(v => [v.lat, v.lng]), {
      color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.25, weight: 2.5,
    }).addTo(layerRef.current)
    setEdificFechado(true)
    setEdificMode(false)
  }

  function limparEdificacao() {
    const layer = layerRef.current
    edificVertsRef.current.forEach(v => layer.removeLayer(v.marker))
    edificLinesRef.current.forEach(l => layer.removeLayer(l))
    if (edificCloseRef.current) layer.removeLayer(edificCloseRef.current)
    if (edificPolyRef.current)  layer.removeLayer(edificPolyRef.current)
    edificVertsRef.current = []
    edificLinesRef.current = []
    edificCloseRef.current = null
    edificPolyRef.current  = null
    setEdificCount(0); setEdificFechado(false)
  }

  function confirmar() {
    const verts  = vertsRef.current.map(v => ({ lat: v.lat, lng: v.lng }))
    const edificVerts = edificVertsRef.current.map(v => ({ lat: v.lat, lng: v.lng }))
    onConfirm({
      vertices: verts,
      areaM2,
      edificacaoVertices: edificVerts.length >= 3 ? edificVerts : null,
    })
  }

  // ── Helpers de status ─────────────────────────────────────────
  const statusArea = fechado
    ? `✓ Área fechada com ${count} pontos`
    : count === 0
      ? 'Clique no mapa para adicionar o primeiro ponto'
      : count < 3
        ? `${count} ponto(s) — adicione mais ${3 - count}`
        : `${count} pontos — clique no ponto verde para fechar`

  const statusEdific = edificFechado
    ? `✓ Edificação fechada com ${edificCount} pontos`
    : edificCount === 0
      ? 'Clique dentro da área para adicionar o 1º ponto da edificação'
      : edificCount < 3
        ? `${edificCount} ponto(s) — adicione mais ${3 - edificCount}`
        : `${edificCount} pontos — clique no ponto verde para fechar`

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, overflow: 'hidden',
        width: '100%', maxWidth: 720, height: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
      }}>
        {/* Header */}
        <div style={{
          padding: '13px 18px', borderBottom: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          background: edificMode ? '#eff6ff' : '#fffbeb',
        }}>
          {edificMode
            ? <FiHome size={16} color='#1d4ed8' />
            : <FiMapPin size={16} color='#d97706' />}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>
              {edificMode ? 'Desenhar Localização da Edificação' : 'Desenhar Área do Imóvel'}
            </div>
            <div style={{ fontSize: 11, color: edificMode ? '#1e40af' : '#92400e', marginTop: 1 }}>
              {edificMode
                ? 'Clique dentro da área amarela para marcar os vértices da edificação · Clique no ponto verde para fechar'
                : 'Clique no mapa para adicionar vértices · Clique no ponto verde para fechar o polígono'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}>
            <FiX size={18} />
          </button>
        </div>

        {/* Status — Área */}
        <div style={{
          padding: '7px 14px', background: '#fefce8', borderBottom: '1px solid #fde68a',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap',
          fontSize: 12,
        }}>
          <span style={{ color: '#92400e', flex: 1 }}>
            {statusArea}
          </span>
          {areaM2 !== null && (
            <span style={{ fontWeight: 700, color: '#b45309', fontSize: 13 }}>
              Área: {areaM2 >= 10000
                ? (areaM2 / 10000).toFixed(4) + ' ha'
                : areaM2 + ' m²'}
            </span>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Layer toggle */}
            <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
              {CAMADAS.map(c => (
                <button
                  key={c.id}
                  onClick={() => trocarCamada(c.id)}
                  style={{
                    background: camada === c.id ? '#0f172a' : '#f8fafc',
                    color: camada === c.id ? '#fff' : '#64748b',
                    border: 'none', padding: '4px 10px', fontSize: 11,
                    fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {c.id === 'satelite' ? '🛰️' : '🗺️'} {c.label}
                </button>
              ))}
            </div>
            {!fechado && count >= 3 && (
              <button onClick={fecharPoligono} style={{
                background: '#22c55e', border: 'none', color: '#fff',
                padding: '4px 11px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}>
                <FiCheck size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Fechar Área
              </button>
            )}
            {count > 0 && !fechado && (
              <button onClick={limpar} style={{
                background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b',
                padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
              }}>
                <FiTrash2 size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Limpar
              </button>
            )}
          </div>
        </div>

        {/* Status — Edificação (aparece só quando fechado=true) */}
        {fechado && (
          <div style={{
            padding: '7px 14px',
            background: edificMode ? '#eff6ff' : '#f0fdf4',
            borderBottom: `1px solid ${edificMode ? '#bfdbfe' : '#bbf7d0'}`,
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap',
            fontSize: 12,
          }}>
            <FiHome size={13} color={edificMode ? '#1d4ed8' : '#16a34a'} />
            <span style={{ color: edificMode ? '#1e40af' : '#15803d', flex: 1 }}>
              {edificFechado
                ? statusEdific
                : edificMode
                  ? statusEdific
                  : 'Opcional: desenhe a localização da edificação dentro da área'}
            </span>
            {edificFechado && (
              <button onClick={() => { limparEdificacao(); setEdificMode(false) }} style={{
                background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b',
                padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
              }}>
                <FiTrash2 size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Redesenhar
              </button>
            )}
            {!edificFechado && edificMode && edificCount >= 3 && (
              <button onClick={fecharEdificPoligono} style={{
                background: '#2563eb', border: 'none', color: '#fff',
                padding: '4px 11px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}>
                <FiCheck size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Fechar Edif.
              </button>
            )}
            {!edificFechado && edificMode && edificCount > 0 && (
              <button onClick={() => { limparEdificacao(); }} style={{
                background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b',
                padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
              }}>
                <FiTrash2 size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Limpar Edif.
              </button>
            )}
            {!edificFechado && (
              <button
                onClick={() => setEdificMode(m => !m)}
                style={{
                  background: edificMode ? '#1d4ed8' : '#dbeafe',
                  border: 'none', color: edificMode ? '#fff' : '#1d4ed8',
                  padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                <FiHome size={11} />
                {edificMode ? 'Sair do Desenho' : 'Desenhar Edificação'}
              </button>
            )}
          </div>
        )}

        {/* Map */}
        <div ref={mapRef} style={{ flex: 1, minHeight: 0 }} />

        {/* Footer */}
        <div style={{
          padding: '10px 16px', borderTop: '1px solid #e2e8f0',
          display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0, background: '#fff',
        }}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            {!fechado && count > 0 && count >= 3
              ? 'Dica: clique no ponto verde inicial para fechar a área'
              : edificMode
                ? '🏠 Clique dentro da área amarela para marcar os pontos da edificação'
                : edificFechado
                  ? `✓ Área + Edificação desenhadas`
                  : 'Polígonos tracejados = vistorias já registradas'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{
              background: '#f8fafc', border: '1px solid #e2e8f0', color: '#64748b',
              padding: '8px 18px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
            }}>
              Cancelar
            </button>
            <button onClick={confirmar} disabled={!fechado} style={{
              background: fechado ? '#d97706' : '#fde68a',
              border: 'none', color: fechado ? '#fff' : '#92400e',
              padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: fechado ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <FiCheck size={13} />
              {edificFechado ? 'Confirmar Área + Edificação' : 'Confirmar Área'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
