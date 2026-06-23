import { useState, useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as turf from '@turf/turf'
import JSZip from 'jszip'
import MonitoramentoLayout from '../components/MonitoramentoLayout'
import TerrainProfile3D from '../components/TerrainProfile3D'
import { getElevationsBatchWithFallback } from '../services/terrainDEM'
import styles from './MonitoramentoMapa.module.css'
import { API_BASE } from '../services/api'

// ── Ícone padrão do Leaflet ──────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ── Utilidades de elevação ───────────────────────────────────
async function fetchElevations(points) {
  const lats = points.map(p => p[1]).join(',')
  const lngs = points.map(p => p[0]).join(',')
  const res  = await fetch(`${API_BASE}/elevation?latitude=${lats}&longitude=${lngs}`)
  if (!res.ok) throw new Error('API elevation failed')
  const data = await res.json()
  return Array.isArray(data) ? data.map(e => e?.elevation ?? 0)
    : Array.isArray(data?.elevation) ? data.elevation : points.map(() => 0)
}
async function fetchElevBatch(points) {
  const batches = []
  for (let i = 0; i < points.length; i += 100) batches.push(points.slice(i, i + 100))
  const results = []
  for (const b of batches) results.push(await fetchElevations(b))
  return results.flat()
}
async function fetchElevWithDEM(points, extentM) {
  const result = await getElevationsBatchWithFallback(points, fetchElevBatch, extentM)
  return { elevations: result.elevations.map(e => e ?? 0) }
}
function interpolateElev(sceneX, sceneZ, grid, cols, rows) {
  if (!grid || grid.length < 4) return 0
  const minX = grid[0].x, maxX = grid[cols - 1].x
  const minZ = grid[0].z, maxZ = grid[(rows - 1) * cols].z
  if (maxX === minX || maxZ === minZ) return grid[0]?.y ?? 0
  const tc = Math.max(0, Math.min(1, (sceneX - minX) / (maxX - minX)))
  const tr = Math.max(0, Math.min(1, (sceneZ - minZ) / (maxZ - minZ)))
  const c0 = Math.min(Math.floor(tc * (cols - 1)), cols - 2)
  const r0 = Math.min(Math.floor(tr * (rows - 1)), rows - 2)
  const e00 = grid[r0 * cols + c0]?.y ?? 0
  const e10 = grid[r0 * cols + c0 + 1]?.y ?? e00
  const e01 = grid[(r0 + 1) * cols + c0]?.y ?? e00
  const e11 = grid[(r0 + 1) * cols + c0 + 1]?.y ?? e00
  const fc = tc * (cols - 1) - c0, fr = tr * (rows - 1) - r0
  return e00 * (1 - fc) * (1 - fr) + e10 * fc * (1 - fr) + e01 * (1 - fc) * fr + e11 * fc * fr
}

// ── Cor do marcador por nº de trincas ───────────────────────
function corTrinca(n) {
  if (n === 0) return '#22c55e'
  if (n <= 2)  return '#f97316'
  return '#ef4444'
}
function numTrincas(imovel) {
  const fromFotos = (imovel.fotosAnomalias || []).length
  const fromRels  = (imovel.relatoriosSalvos || []).reduce(
    (s, r) => s + (r.fotosAnomalias?.length || 0), 0)
  return fromFotos + fromRels
}

// ── KML export ───────────────────────────────────────────────
function gerarKML(imoveis) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <name>GEO-Vistorias - Imóveis Monitorados</name>
  ${imoveis.filter(i => i.latitude && i.longitude).map(i => `
  <Placemark>
    <name><![CDATA[${i.proprietario}]]></name>
    <description><![CDATA[${i.endereco || ''} • ${numTrincas(i)} trinca(s)]]></description>
    <Style><IconStyle><color>${numTrincas(i) > 2 ? 'ff0000ff' : 'ff00ff00'}</color><scale>1.2</scale>
      <Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon>
    </IconStyle></Style>
    <Point><coordinates>${i.longitude},${i.latitude},0</coordinates></Point>
  </Placemark>`).join('\n')}
</Document></kml>`
}

// ─────────────────────────────────────────────────────────────
export default function MonitoramentoMapa() {
  const mapRef     = useRef(null)
  const mapObjRef  = useRef(null)
  const markersRef = useRef([])
  const polyRef    = useRef({ ativo: false, vertices: [], markers: [], line: null, closeLine: null, filledPoly: null })
  const resultLayerRef = useRef(null)

  const [imoveis,    setImoveis]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [modoDesenho, setModoDesenho] = useState(false)
  const [vertCount,  setVertCount]  = useState(0)
  const [analisando, setAnalisando] = useState(false)
  const [resultado,  setResultado]  = useState(null)  // { grid3D, bbox, monMarkers }
  const [show3D,     setShow3D]     = useState(false)
  const [exporting,  setExporting]  = useState(false)
  const [toast,      setToast]      = useState(null)
  const [camada,     setCamada]     = useState('topo')

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Camadas de mapa ──────────────────────────────────────
  const CAMADAS = {
    topo:     { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',      label: '⛰️ Topo' },
    ruas:     { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',    label: '🗺️ Ruas' },
    satelite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', label: '🛰️ Sat' },
  }

  // ── Carrega imóveis ──────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/monitoramento`)
      .then(r => r.json())
      .then(data => { setImoveis(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // ── Inicializa mapa ──────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapObjRef.current) return
    const map = L.map(mapRef.current, { zoomControl: false })
    mapObjRef.current = map

    L.control.zoom({ position: 'topright' }).addTo(map)

    const layers = {}
    Object.entries(CAMADAS).forEach(([id, c]) => {
      layers[id] = L.tileLayer(c.url, { maxZoom: 17 })
    })
    layers[camada].addTo(map)
    map._layersObj = layers

    map.setView([-20.515, -43.72], 13)

    resultLayerRef.current = L.layerGroup().addTo(map)

    // Clique no mapa — desenho de polígono
    map.on('click', e => {
      if (!polyRef.current.ativo) return
      addVertice(map, e.latlng)
    })

    return () => { map.remove(); mapObjRef.current = null }
  }, [])

  // ── Atualiza camada quando muda ──────────────────────────
  useEffect(() => {
    const map = mapObjRef.current
    if (!map || !map._layersObj) return
    Object.entries(map._layersObj).forEach(([id, layer]) => {
      if (id === camada) { if (!map.hasLayer(layer)) map.addLayer(layer) }
      else               { if (map.hasLayer(layer))  map.removeLayer(layer) }
    })
  }, [camada])

  // ── Atualiza marcadores de imóveis ───────────────────────
  useEffect(() => {
    const map = mapObjRef.current
    if (!map) return
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    const comCoords = imoveis.filter(i => i.latitude && i.longitude)
    if (comCoords.length === 0) return

    const bounds = []
    comCoords.forEach(i => {
      const n = numTrincas(i)
      const cor = corTrinca(n)
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:22px;height:22px;border-radius:50%;background:${cor};border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:white;">${n > 0 ? n : '✓'}</div>`,
        iconSize: [22, 22], iconAnchor: [11, 11],
      })
      const marker = L.marker([i.latitude, i.longitude], { icon })
        .bindPopup(`<b>${i.proprietario}</b><br/>${i.endereco || ''}<br/>Trincas: <b>${n}</b>`)
        .addTo(map)
      markersRef.current.push(marker)
      bounds.push([i.latitude, i.longitude])
    })
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
  }, [imoveis])

  // ── Funções de desenho do polígono ───────────────────────
  const addVertice = useCallback((map, latlng) => {
    const poly = polyRef.current
    const vIdx = poly.vertices.length

    // Se clicou perto do primeiro vértice → fechar polígono
    if (vIdx >= 3) {
      const first = poly.vertices[0]
      const dist  = map.distance([first.lat, first.lng], [latlng.lat, latlng.lng])
      if (dist < 25) { fecharPoligono(map); return }
    }

    poly.vertices.push({ lat: latlng.lat, lng: latlng.lng })
    setVertCount(poly.vertices.length)

    const dot = L.circleMarker([latlng.lat, latlng.lng], {
      radius: vIdx === 0 ? 8 : 5,
      color: vIdx === 0 ? '#fbbf24' : '#3b82f6',
      fillColor: vIdx === 0 ? '#fbbf24' : '#3b82f6',
      fillOpacity: 1, weight: 2,
    }).addTo(map)
    poly.markers.push(dot)

    if (poly.line) poly.line.setLatLngs(poly.vertices.map(v => [v.lat, v.lng]))
    else poly.line = L.polyline(poly.vertices.map(v => [v.lat, v.lng]),
      { color: '#3b82f6', weight: 2.5, dashArray: '5,4', opacity: 0.9 }).addTo(map)
  }, [])

  function fecharPoligono(map) {
    const poly = polyRef.current
    if (poly.vertices.length < 3) return

    if (poly.line)    { poly.line.remove(); poly.line = null }
    if (poly.closeLine) { poly.closeLine.remove(); poly.closeLine = null }

    poly.filledPoly = L.polygon(poly.vertices.map(v => [v.lat, v.lng]), {
      color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.12, weight: 2.5,
    }).addTo(map)

    poly.ativo = false
    setModoDesenho(false)
    analisarPoligono(poly.vertices)
  }

  function limparPoligono() {
    const map  = mapObjRef.current
    const poly = polyRef.current
    poly.markers.forEach(m => m.remove())
    if (poly.line)       poly.line.remove()
    if (poly.closeLine)  poly.closeLine.remove()
    if (poly.filledPoly) poly.filledPoly.remove()
    resultLayerRef.current?.clearLayers()
    polyRef.current = { ativo: false, vertices: [], markers: [], line: null, closeLine: null, filledPoly: null }
    setVertCount(0); setModoDesenho(false); setResultado(null); setShow3D(false)
  }

  function iniciarDesenho() {
    limparPoligono()
    polyRef.current.ativo = true
    setModoDesenho(true)
  }

  // ── Análise do polígono ──────────────────────────────────
  async function analisarPoligono(vertices) {
    setAnalisando(true)
    setResultado(null)

    try {
      const ring     = [...vertices.map(v => [v.lng, v.lat]), [vertices[0].lng, vertices[0].lat]]
      const turfPoly = turf.polygon([ring])
      const bbox     = turf.bbox(turfPoly)

      const bboxW = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'kilometers' }) * 1000
      const bboxH = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'kilometers' }) * 1000
      const CELL  = 5
      const GCOLS = Math.max(4, Math.ceil(bboxW / CELL) + 1)
      const GROWS = Math.max(4, Math.ceil(bboxH / CELL) + 1)

      const gridPts = []
      for (let row = 0; row < GROWS; row++) {
        for (let col = 0; col < GCOLS; col++) {
          const lng = bbox[0] + (GCOLS > 1 ? col / (GCOLS - 1) : 0.5) * (bbox[2] - bbox[0])
          const lat = bbox[1] + (GROWS > 1 ? row / (GROWS - 1) : 0.5) * (bbox[3] - bbox[1])
          gridPts.push({ lng, lat })
        }
      }

      const diag = Math.sqrt(bboxW ** 2 + bboxH ** 2)
      const { elevations } = await fetchElevWithDEM(gridPts.map(p => [p.lng, p.lat]), diag)
      gridPts.forEach((p, i) => {
        p.elev  = Math.round(elevations[i] ?? 0)
        p.inside = turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), turfPoly)
      })

      const origin = [bbox[0], bbox[1]]

      const grid3D = gridPts.map(p => ({
        x: turf.distance(origin, [p.lng, origin[1]], { units: 'kilometers' }) * 1000,
        y: p.elev,
        z: turf.distance(origin, [origin[0], p.lat], { units: 'kilometers' }) * 1000,
        inside: p.inside,
      }))

      const insidePts = gridPts.filter(p => p.inside)
      const elevs     = insidePts.length > 0 ? insidePts.map(p => p.elev) : gridPts.map(p => p.elev)
      const minE      = Math.min(...elevs)
      const maxE      = Math.max(...elevs)
      const desnivel  = maxE - minE

      // Vértices do polígono em 3D
      const vertElevCoords = vertices.map(v => [v.lng, v.lat])
      const { elevations: vertElevs } = await fetchElevWithDEM(vertElevCoords, diag)
      const polyVerts3D = vertices.map((v, i) => ({
        x: turf.distance(origin, [v.lng, origin[1]], { units: 'kilometers' }) * 1000,
        y: vertElevs[i] ?? minE,
        z: turf.distance(origin, [origin[0], v.lat], { units: 'kilometers' }) * 1000,
      }))

      // Marcadores de monitoramento dentro do bbox
      const monMarkers = []
      const padMon = 0.008
      imoveis.forEach(imovel => {
        if (!imovel.latitude || !imovel.longitude) return
        const lat = parseFloat(imovel.latitude)
        const lng = parseFloat(imovel.longitude)
        if (lng < bbox[0] - padMon || lng > bbox[2] + padMon ||
            lat < bbox[1] - padMon || lat > bbox[3] + padMon) return
        const mx = turf.distance(origin, [lng, origin[1]], { units: 'kilometers' }) * 1000
        const mz = turf.distance(origin, [origin[0], lat], { units: 'kilometers' }) * 1000
        const my = interpolateElev(mx, mz, grid3D, GCOLS, GROWS)
        // Coleta todos os códigos de trinca (T1, T2, T3…)
        const trincaSet = new Set()
        ;(imovel.fotosAnomalias || []).forEach(f => { if (f.codigoTrinca) trincaSet.add(f.codigoTrinca) })
        ;(imovel.relatoriosSalvos || []).forEach(r => {
          ;(r.fotosAnomalias || []).forEach(f => { if (f.codigoTrinca) trincaSet.add(f.codigoTrinca) })
        })
        const trincas = [...trincaSet].sort((a, b) => {
          const na = parseInt(a.replace(/\D/g, ''), 10) || 0
          const nb = parseInt(b.replace(/\D/g, ''), 10) || 0
          return na - nb
        })
        // Converter vertices_casa p/ coordenadas métricas
        const vcRaw = imovel.verticesCasa || []
        const vertsCasa3D = vcRaw.map(v => {
          const vx = turf.distance(origin, [parseFloat(v.lng), origin[1]], { units: 'kilometers' }) * 1000
          const vz = turf.distance(origin, [origin[0], parseFloat(v.lat)], { units: 'kilometers' }) * 1000
          const vy = interpolateElev(vx, vz, grid3D, GCOLS, GROWS)
          return { x: vx, y: vy, z: vz }
        })
        monMarkers.push({
          id: imovel.id,
          nome: imovel.proprietario || 'Imóvel',
          numAnomalias: trincas.length,
          trincas,
          trincasCasa: imovel.trincasCasa || [],
          verticesCasa: vertsCasa3D,
          alturaCasa: imovel.alturaCasa || null,
          x: mx, y: my, z: mz,
          trincasGeometry: (() => {
            try {
              const relats = imovel.relatoriosSalvos || []
              const allA = relats.flatMap(r => Array.isArray(r.anomalias3D) ? r.anomalias3D : [])
              if (allA.length === 0 || vcRaw.length < 3) return []
              const refM = vcRaw[0]
              const R_e = 6371000
              const cosL = Math.cos(parseFloat(refM.lat) * Math.PI / 180)
              const rawM = vcRaw.map(vv => ({
                x: (parseFloat(vv.lng) - parseFloat(refM.lng)) * cosL * Math.PI / 180 * R_e,
                z: -(parseFloat(vv.lat) - parseFloat(refM.lat)) * Math.PI / 180 * R_e,
              }))
              const cxM = rawM.reduce((s, p) => s + p.x, 0) / rawM.length
              const czM = rawM.reduce((s, p) => s + p.z, 0) / rawM.length
              const maxRM = Math.max(...rawM.map(p => Math.sqrt((p.x - cxM) ** 2 + (p.z - czM) ** 2)), 0.1)
              const scaleM = 12 / maxRM
              const csxM = vertsCasa3D.reduce((s, v) => s + v.x, 0) / vertsCasa3D.length
              const cszM = vertsCasa3D.reduce((s, v) => s + v.z, 0) / vertsCasa3D.length
              const altHM = Math.max(parseFloat(imovel.alturaCasa || 3) * 1.1, 2.5)
              const toT = p => ({
                sx: csxM + p.x / scaleM, sz: cszM - p.z / scaleM,
                yFrac: Math.max(0, Math.min(1, (p.y || 0) / altHM)),
              })
              return allA.map(a => ({
                nome: a.nome || 'T',
                point: a.point ? toT(a.point) : null,
                linhasTrinca: (a.linhasTrinca || []).map(toT),
              }))
            } catch (_) { return [] }
          })(),
          paredesAnomalia: (() => {
            try {
              const raw = imovel.trincasCasa || []
              const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
              const pi = Array.isArray(arr) ? arr.filter(a => a?.type === 'parede-anomalia' && a?.startPoint && a?.endPoint) : []
              if (pi.length === 0 || vcRaw.length < 3) return []
              const refM = vcRaw[0]
              const R_e = 6371000
              const cosL = Math.cos(parseFloat(refM.lat) * Math.PI / 180)
              const rawM = vcRaw.map(vv => ({
                x: (parseFloat(vv.lng) - parseFloat(refM.lng)) * cosL * Math.PI / 180 * R_e,
                z: -(parseFloat(vv.lat) - parseFloat(refM.lat)) * Math.PI / 180 * R_e,
              }))
              const cxM = rawM.reduce((s, p) => s + p.x, 0) / rawM.length
              const czM = rawM.reduce((s, p) => s + p.z, 0) / rawM.length
              const maxRM = Math.max(...rawM.map(p => Math.sqrt((p.x - cxM) ** 2 + (p.z - czM) ** 2)), 0.1)
              const scaleM = 12 / maxRM
              const csxM = vertsCasa3D.reduce((s, v) => s + v.x, 0) / vertsCasa3D.length
              const cszM = vertsCasa3D.reduce((s, v) => s + v.z, 0) / vertsCasa3D.length
              const altHM = Math.max(parseFloat(imovel.alturaCasa || 3) * 1.1, 2.5)
              return pi.map(a => ({
                nome:      a.nome || 'P',
                startSx:   csxM + a.startPoint.x / scaleM,
                startSz:   cszM - a.startPoint.z / scaleM,
                endSx:     csxM + a.endPoint.x   / scaleM,
                endSz:     cszM - a.endPoint.z   / scaleM,
                yBaseFrac: Math.max(0, Math.min(1, (a.startPoint.y || 0) / altHM)),
                wallFrac:  Math.max(0.05, Math.min(1, (a.floorHeight || altHM) / altHM)),
              }))
            } catch (_) { return [] }
          })(),
        })
      })

      setResultado({
        grid3D: { points: grid3D, cols: GCOLS, rows: GROWS, minE, maxE, polyVerts: polyVerts3D },
        minE, maxE, desnivel,
        areaM2: Math.round(turf.area(turfPoly)),
        monMarkers,
        numImoveis: monMarkers.length,
      })
    } catch (e) {
      showToast('Erro na análise: ' + e.message, 'error')
    } finally {
      setAnalisando(false)
    }
  }

  // ── Exportar KMZ ────────────────────────────────────────
  const handleExportKMZ = async () => {
    if (!imoveis.filter(i => i.latitude && i.longitude).length) {
      showToast('Nenhum imóvel com coordenadas para exportar', 'error'); return
    }
    setExporting(true)
    try {
      const zip = new JSZip()
      zip.file('doc.kml', gerarKML(imoveis))
      const blob = await zip.generateAsync({ type: 'blob' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'geo-vistorias-monitoramento.kmz'; a.click()
      URL.revokeObjectURL(url)
      showToast('KMZ exportado!')
    } catch { showToast('Erro ao exportar', 'error') }
    finally { setExporting(false) }
  }

  // ── Render ───────────────────────────────────────────────
  const comCoords = imoveis.filter(i => i.latitude && i.longitude)

  return (
    <MonitoramentoLayout>
      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.msg}</div>
      )}

      {/* ── Área do mapa — expande para cima e ocupa tudo ── */}
      <div className={styles.mapaContainer}>

        {/* Cabeçalho flutuante sobre o mapa */}
        <div className={styles.mapaHeader}>
          <div className={styles.mapaHeaderLeft}>
            <span className={styles.mapaTitulo}>Mapa de Declividade</span>
            <span className={styles.mapaSubtitulo}>{comCoords.length} imóvel(is) com GPS</span>
          </div>
          <button className={styles.btnKmz} onClick={handleExportKMZ} disabled={exporting || comCoords.length === 0}>
            {exporting ? '⏳' : '⬇️ KMZ'}
          </button>
        </div>

        {/* Seletor de camada */}
        <div className={styles.camadaSel}>
          {Object.entries(CAMADAS).map(([id, c]) => (
            <button key={id}
              className={`${styles.camadaBtn} ${camada === id ? styles.camadaBtnActive : ''}`}
              onClick={() => setCamada(id)}>
              {c.label}
            </button>
          ))}
        </div>

        {/* Mapa */}
        {loading ? (
          <div className={styles.loadingMap}>Carregando imóveis...</div>
        ) : (
          <div ref={mapRef} className={styles.leafletMap} />
        )}

        {/* Legenda de marcadores */}
        <div className={styles.legenda}>
          <span className={styles.legendaItem}><span style={{ background: '#22c55e' }} className={styles.legendaDot} /> Sem trincas</span>
          <span className={styles.legendaItem}><span style={{ background: '#f97316' }} className={styles.legendaDot} /> 1–2 trincas</span>
          <span className={styles.legendaItem}><span style={{ background: '#ef4444' }} className={styles.legendaDot} /> 3+ trincas</span>
        </div>

        {/* Botões de controle do polígono */}
        <div className={styles.polyControls}>
          {!modoDesenho && !resultado && !analisando && (
            <button className={styles.btnDesenho} onClick={iniciarDesenho}>
              ✏️ Desenhar Polígono
            </button>
          )}
          {modoDesenho && (
            <div className={styles.polyStatus}>
              <div className={styles.polyStatusText}>
                {vertCount === 0 && 'Toque no mapa para adicionar o 1º ponto'}
                {vertCount === 1 && 'Adicione mais pontos…'}
                {vertCount === 2 && 'Adicione mais pontos…'}
                {vertCount >= 3 && `${vertCount} pontos — toque no 1º ponto para fechar`}
              </div>
              <button className={styles.btnCancelar} onClick={limparPoligono}>✕ Cancelar</button>
            </div>
          )}
          {analisando && (
            <div className={styles.polyStatus}>
              <div className={styles.polyStatusText}>⏳ Analisando elevação e declividade…</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Painel de resultados ──────────────────────────── */}
      {resultado && !show3D && (
        <div className={styles.resultadoPanel}>
          <div className={styles.resultadoHeader}>
            <span className={styles.resultadoTitulo}>📊 Análise do Polígono</span>
            <button className={styles.btnFecharResult} onClick={limparPoligono}>✕</button>
          </div>

          <div className={styles.resultadoGrid}>
            <div className={styles.resultadoCard}>
              <div className={styles.resultadoValor}>{resultado.minE} m</div>
              <div className={styles.resultadoLabel}>Altitude mín.</div>
            </div>
            <div className={styles.resultadoCard}>
              <div className={styles.resultadoValor}>{resultado.maxE} m</div>
              <div className={styles.resultadoLabel}>Altitude máx.</div>
            </div>
            <div className={styles.resultadoCard}>
              <div className={styles.resultadoValor}>{resultado.desnivel} m</div>
              <div className={styles.resultadoLabel}>Desnível</div>
            </div>
            <div className={styles.resultadoCard}>
              <div className={styles.resultadoValor}>
                {resultado.areaM2 >= 10000
                  ? `${(resultado.areaM2 / 10000).toFixed(2)} ha`
                  : `${resultado.areaM2} m²`}
              </div>
              <div className={styles.resultadoLabel}>Área</div>
            </div>
          </div>

          {resultado.numImoveis > 0 && (
            <div className={styles.resultadoImoveis}>
              🏠 <b>{resultado.numImoveis}</b> imóvel(is) de monitoramento dentro do polígono
            </div>
          )}

          <button className={styles.btn3D} onClick={() => setShow3D(true)}>
            🏔️ Ver Relevo 3D com Imóveis e Trincas
          </button>

          <button className={styles.btnNovoPoligono} onClick={iniciarDesenho}>
            ↩ Redesenhar Polígono
          </button>
        </div>
      )}

      {/* ── 3D fullscreen ──────────────────────────────────── */}
      {show3D && resultado && (
        <TerrainProfile3D
          mode="poligono"
          gridData={resultado.grid3D}
          vistoriaPolygons={[]}
          monitoramentoMarkers={resultado.monMarkers}
          onClose={() => setShow3D(false)}
        />
      )}
    </MonitoramentoLayout>
  )
}
