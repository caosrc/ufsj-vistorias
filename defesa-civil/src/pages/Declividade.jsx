import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as turf from '@turf/turf'
import Chart from 'chart.js/auto'
import { CIDADES, CIDADE_PADRAO } from '../data/cidades'
import Sidebar from '../components/Sidebar'
import styles from './Declividade.module.css'
import { FiTrendingUp, FiEdit3, FiTrash2, FiActivity, FiZap, FiX } from 'react-icons/fi'

const LAYERS = [
  {
    id: 'topo', label: 'Topografia', icone: '⛰️',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxZoom: 17,
  },
  {
    id: 'ruas', label: 'Ruas', icone: '🗺️',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap', maxZoom: 19,
  },
  {
    id: 'satelite', label: 'Satélite', icone: '🛰️',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri', maxZoom: 19,
  },
]

const SLOPE_CLASSES = [
  { max: 3,        label: 'Plano',           desc: 'Sem restrições',                   cor: '#22c55e' },
  { max: 8,        label: 'Suave ondulado',  desc: 'Pequena limitação agrícola',        cor: '#84cc16' },
  { max: 20,       label: 'Ondulado',        desc: 'Requer práticas conservacionistas', cor: '#eab308' },
  { max: 45,       label: 'Forte ondulado',  desc: 'Risco de erosão',                  cor: '#f97316' },
  { max: 75,       label: 'Montanhoso',      desc: 'Evitar construções',               cor: '#ef4444' },
  { max: Infinity, label: 'Escarpado',       desc: 'Risco geológico severo',           cor: '#7c3aed' },
]

function classifySlope(pct) {
  return SLOPE_CLASSES.find(c => pct <= c.max) || SLOPE_CLASSES[SLOPE_CLASSES.length - 1]
}

function detectContourInterval(elevations) {
  const range = Math.max(...elevations) - Math.min(...elevations)
  if (range < 30) return 5
  if (range < 200) return 10
  return 20
}

async function fetchElevations(points) {
  if (points.length > 100) throw new Error('Máximo 100 pontos por requisição')
  const lats = points.map(p => p[1].toFixed(4)).join(',')
  const lngs = points.map(p => p[0].toFixed(4)).join(',')
  const res = await fetch(
    `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`
  )
  if (!res.ok) {
    const txt = await res.text().catch(() => String(res.status))
    throw new Error(`API retornou ${res.status}: ${txt}`)
  }
  const data = await res.json()
  if (!data.elevation) throw new Error('Resposta inválida da API')
  return data.elevation
}

function findContourCrossings(elevations, distances, interval) {
  const minElev = Math.min(...elevations)
  const maxElev = Math.max(...elevations)
  const firstCV = Math.ceil(minElev / interval) * interval
  const lastCV  = Math.floor(maxElev / interval) * interval
  const crossings = []
  for (let cv = firstCV; cv <= lastCV; cv += interval) {
    for (let i = 0; i < elevations.length - 1; i++) {
      const e1 = elevations[i], e2 = elevations[i + 1]
      if ((e1 < cv && e2 >= cv) || (e1 > cv && e2 <= cv)) {
        const t = (cv - e1) / (e2 - e1)
        const crossDist = distances[i] + t * (distances[i + 1] - distances[i])
        crossings.push({ elevation: cv, dist: crossDist })
      }
    }
  }
  const filtered = []
  crossings.sort((a, b) => a.dist - b.dist)
  for (const c of crossings) {
    const last = filtered[filtered.length - 1]
    if (!last || Math.abs(c.dist - last.dist) > 2) filtered.push(c)
  }
  return filtered
}

export default function Declividade() {
  const mapRef           = useRef(null)
  const leafletRef       = useRef(null)
  const tileLayerRef     = useRef(null)
  const drawLayerRef     = useRef(null)
  const lineLayerRef     = useRef(null)
  const autoLayerRef     = useRef(null)
  const chartRef         = useRef(null)
  const chartInstanceRef = useRef(null)
  const drawStateRef     = useRef({ ativo: false, pontos: [], markers: [], activeLine: null, previewLine: null })

  const [cidade,        setCidade]        = useState(CIDADE_PADRAO)
  const [camada,        setCamada]        = useState('topo')
  const [desenhando,    setDesenhando]    = useState(false)
  const [carregando,    setCarregando]    = useState(false)
  const [carregandoAuto, setCarregandoAuto] = useState(false)
  const [resultado,     setResultado]     = useState(null)
  const [autoResultado, setAutoResultado] = useState(null)
  const [modoAtivo,     setModoAtivo]     = useState(null) // 'manual' | 'auto'

  // ── Init mapa ──────────────────────────────────────────────
  useEffect(() => {
    if (leafletRef.current) return
    const c = CIDADES[cidade]
    const [lng, lat] = c.center
    const map = L.map(mapRef.current, {
      center: [lat, lng], zoom: 13,
      zoomControl: false, doubleClickZoom: false,
    })
    L.control.zoom({ position: 'topright' }).addTo(map)
    L.control.scale({ metric: true, imperial: false }).addTo(map)

    const layerObj = LAYERS[0]
    tileLayerRef.current = L.tileLayer(layerObj.url, {
      attribution: layerObj.attribution, maxZoom: layerObj.maxZoom,
    }).addTo(map)

    drawLayerRef.current = L.layerGroup().addTo(map)
    lineLayerRef.current = L.layerGroup().addTo(map)
    autoLayerRef.current = L.layerGroup().addTo(map)

    map.on('click',     handleClick)
    map.on('dblclick',  handleDblClick)
    map.on('mousemove', handleMouseMove)

    leafletRef.current = map
    return () => { map.remove(); leafletRef.current = null }
  }, [])

  useEffect(() => {
    if (!leafletRef.current || !tileLayerRef.current) return
    const layerObj = LAYERS.find(l => l.id === camada)
    tileLayerRef.current.setUrl(layerObj.url)
    tileLayerRef.current.options.maxZoom = layerObj.maxZoom
  }, [camada])

  useEffect(() => {
    if (!leafletRef.current) return
    const c = CIDADES[cidade]
    const [lng, lat] = c.center
    leafletRef.current.flyTo([lat, lng], 13, { duration: 1.2 })
  }, [cidade])

  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.style.cursor = desenhando ? 'crosshair' : ''
    drawStateRef.current.ativo = desenhando
    if (!desenhando) limparDesenho()
  }, [desenhando])

  // ── Eventos de mapa ────────────────────────────────────────
  function handleClick(e)     { if (!drawStateRef.current.ativo) return; adicionarPonto(e.latlng) }
  function handleDblClick(e)  { if (!drawStateRef.current.ativo) return; L.DomEvent.stop(e); finalizarLinha() }
  function handleMouseMove(e) {
    const state = drawStateRef.current
    if (!state.ativo || state.pontos.length === 0) return
    const ultimo = state.pontos[state.pontos.length - 1]
    if (!state.previewLine) {
      state.previewLine = L.polyline([], { color: '#38bdf8', weight: 1.5, dashArray: '5,5', opacity: 0.7 }).addTo(drawLayerRef.current)
    }
    state.previewLine.setLatLngs([ultimo, e.latlng])
  }

  function adicionarPonto(latlng) {
    const state = drawStateRef.current
    state.pontos.push(latlng)
    const m = L.circleMarker(latlng, { radius: 5, color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 1, weight: 2 }).addTo(drawLayerRef.current)
    state.markers.push(m)
    if (state.pontos.length >= 2) {
      if (state.activeLine) drawLayerRef.current.removeLayer(state.activeLine)
      state.activeLine = L.polyline(state.pontos, { color: '#38bdf8', weight: 2.5, opacity: 0.9 }).addTo(drawLayerRef.current)
    }
  }

  function finalizarLinha() {
    const state = drawStateRef.current
    if (state.pontos.length < 2) { limparDesenho(); setDesenhando(false); return }
    analisarLinhaManual([...state.pontos])
    limparDesenho()
    setDesenhando(false)
  }

  function limparDesenho() {
    const state = drawStateRef.current
    state.markers.forEach(m => drawLayerRef.current?.removeLayer(m))
    if (state.activeLine)  drawLayerRef.current?.removeLayer(state.activeLine)
    if (state.previewLine) drawLayerRef.current?.removeLayer(state.previewLine)
    state.pontos = []; state.markers = []; state.activeLine = null; state.previewLine = null
  }

  function limparManual() {
    limparDesenho(); lineLayerRef.current?.clearLayers()
    setResultado(null); setDesenhando(false); setModoAtivo(null)
    if (chartInstanceRef.current) { chartInstanceRef.current.destroy(); chartInstanceRef.current = null }
  }

  function limparAuto() {
    autoLayerRef.current?.clearLayers(); setAutoResultado(null); setModoAtivo(null)
  }

  // ── Análise manual ─────────────────────────────────────────
  async function analisarLinhaManual(latlngs) {
    setCarregando(true); setResultado(null); lineLayerRef.current?.clearLayers()
    try {
      const coords      = latlngs.map(p => [p.lng, p.lat])
      const line        = turf.lineString(coords)
      const totalDistKm = turf.length(line, { units: 'kilometers' })
      const totalDist   = totalDistKm * 1000
      const AMOSTRAS = 99
      const samplePoints = [], sampleDists = []
      for (let i = 0; i <= AMOSTRAS; i++) {
        const pt = turf.along(line, (i / AMOSTRAS) * totalDistKm, { units: 'kilometers' })
        samplePoints.push(pt.geometry.coordinates)
        sampleDists.push((i / AMOSTRAS) * totalDist)
      }
      const elevations = await fetchElevations(samplePoints)
      const interval   = detectContourInterval(elevations)
      const crossings  = findContourCrossings(elevations, sampleDists, interval)
      const startElev  = elevations[0], endElev = elevations[AMOSTRAS]
      const marcos = [
        { elevation: Math.round(startElev), dist: 0, tipo: 'inicio' },
        ...crossings.map(c => ({ ...c, tipo: 'curva' })),
        { elevation: Math.round(endElev), dist: totalDist, tipo: 'fim' },
      ]
      const segmentos = []
      for (let i = 0; i < marcos.length - 1; i++) {
        const a = marcos[i], b = marcos[i + 1]
        const distSeg = b.dist - a.dist
        if (distSeg < 0.5) continue
        const elevDiff = Math.abs(b.elevation - a.elevation)
        const slope    = distSeg > 0 ? (elevDiff / distSeg) * 100 : 0
        segmentos.push({ de: a.elevation, para: b.elevation, dist: distSeg, elevDiff, slope, sobe: b.elevation > a.elevation, classif: classifySlope(slope), distAcum: b.dist })
      }
      const minAlt = Math.round(Math.min(...elevations))
      const maxAlt = Math.round(Math.max(...elevations))
      const desnivel    = maxAlt - minAlt
      const slopeGlobal = totalDist > 0 ? (desnivel / totalDist) * 100 : 0
      const classifGlobal = classifySlope(slopeGlobal)

      lineLayerRef.current?.clearLayers()
      segmentos.forEach((seg, idx) => {
        const a = marcos[idx], b = marcos[idx + 1]
        if (!b) return
        const fracA = a.dist / totalDist, fracB = b.dist / totalDist
        const ptA = turf.along(line, fracA * totalDistKm, { units: 'kilometers' })
        const ptB = turf.along(line, fracB * totalDistKm, { units: 'kilometers' })
        const [lngA, latA] = ptA.geometry.coordinates
        const [lngB, latB] = ptB.geometry.coordinates
        L.polyline([[latA, lngA], [latB, lngB]], { color: seg.classif.cor, weight: 5, opacity: 0.9 }).addTo(lineLayerRef.current)
      })
      crossings.forEach(c => {
        const pt = turf.along(line, (c.dist / totalDist) * totalDistKm, { units: 'kilometers' })
        const [lng, lat] = pt.geometry.coordinates
        L.circleMarker([lat, lng], { radius: 5, color: '#fff', fillColor: '#1e293b', fillOpacity: 1, weight: 2 })
          .bindTooltip(`⛰ ${c.elevation} m`, { direction: 'top' }).addTo(lineLayerRef.current)
      })
      L.circleMarker(latlngs[0], { radius: 7, color: '#fff', fillColor: '#22c55e', fillOpacity: 1, weight: 2 })
        .bindTooltip(`Início: ${Math.round(startElev)} m`, { direction: 'top' }).addTo(lineLayerRef.current)
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, color: '#fff', fillColor: classifGlobal.cor, fillOpacity: 1, weight: 2 })
        .bindTooltip(`Fim: ${Math.round(endElev)} m`, { direction: 'top' }).addTo(lineLayerRef.current)

      setModoAtivo('manual')
      setResultado({ totalDist, minAlt, maxAlt, desnivel, slopeGlobal, classifGlobal, interval, crossings, segmentos, distances: sampleDists.map(d => d.toFixed(0)), elevations })
    } catch (e) {
      setResultado({ erro: `Erro: ${e.message}` })
    } finally { setCarregando(false) }
  }

  // ── Análise automática ─────────────────────────────────────
  async function analisarAuto() {
    setCarregandoAuto(true); setAutoResultado(null)
    autoLayerRef.current?.clearLayers()
    lineLayerRef.current?.clearLayers()
    setResultado(null)
    try {
      const map    = leafletRef.current
      const bounds = map.getBounds()
      const N = bounds.getNorth(), S = bounds.getSouth()
      const W = bounds.getWest(),  E = bounds.getEast()
      const GRID = 10

      // ── 1. Grade 10×10 = 100 pontos de elevação bruta (limite da API)
      const gridPts = []
      for (let row = 0; row < GRID; row++) {
        for (let col = 0; col < GRID; col++) {
          const lat = S + (row / (GRID - 1)) * (N - S)
          const lng = W + (col / (GRID - 1)) * (E - W)
          gridPts.push({ lat, lng, row, col })
        }
      }
      const rawCoords  = gridPts.map(p => [p.lng, p.lat])
      const elevations = await fetchElevations(rawCoords)
      gridPts.forEach((p, i) => { p.elev = elevations[i] })

      // ── 2. Calcular declividade em cada ponto bruto (diferenças centrais)
      const cellH = turf.distance([gridPts[0].lng, gridPts[0].lat], [gridPts[GRID].lng, gridPts[GRID].lat], { units: 'meters' })
      const cellW = turf.distance([gridPts[0].lng, gridPts[0].lat], [gridPts[1].lng, gridPts[1].lat], { units: 'meters' })

      const slopeAtPt = gridPts.map((p) => {
        const { row, col } = p
        const Lv = col > 0       ? gridPts[row * GRID + (col - 1)].elev : p.elev
        const Rv = col < GRID-1  ? gridPts[row * GRID + (col + 1)].elev : p.elev
        const Uv = row > 0       ? gridPts[(row - 1) * GRID + col].elev : p.elev
        const Dv = row < GRID-1  ? gridPts[(row + 1) * GRID + col].elev : p.elev
        const dx = (col > 0 && col < GRID-1) ? 2 * cellW : cellW
        const dy = (row > 0 && row < GRID-1) ? 2 * cellH : cellH
        return Math.sqrt(((Rv - Lv) / dx) ** 2 + ((Dv - Uv) / dy) ** 2) * 100
      })

      // FeatureCollection com declividade por ponto (para consulta por isoband)
      const slopeTurfPts = turf.featureCollection(
        gridPts.map((p, i) => turf.point([p.lng, p.lat], { slope: slopeAtPt[i] }))
      )

      // ── 3. Interpolar superfície densa (~25 colunas) para isobands suaves
      const lonKm  = (E - W) * Math.cos(((N + S) / 2) * Math.PI / 180) * 111.32
      const latKm  = (N - S) * 111.32
      const cellKm = Math.max(Math.min(lonKm, latKm) / 25, 0.15)

      const rawTurfPts = turf.featureCollection(
        gridPts.map(p => turf.point([p.lng, p.lat], { elevation: p.elev }))
      )

      let densePts = rawTurfPts
      try {
        densePts = turf.interpolate(rawTurfPts, cellKm, {
          gridType: 'point', property: 'elevation', units: 'kilometers', weight: 3,
        })
      } catch (_) { /* usa grade bruta se interpolação falhar */ }

      // ── 4. Intervalos de cota e breaks
      const minElev = Math.min(...elevations)
      const maxElev = Math.max(...elevations)
      const range   = maxElev - minElev
      let interval  = 5
      if (range > 80)  interval = 10
      if (range > 200) interval = 20
      if (range > 400) interval = 50

      const breaks = []
      for (let e = Math.ceil(minElev / interval) * interval; e <= Math.floor(maxElev / interval) * interval; e += interval) {
        breaks.push(e)
      }
      if (breaks.length < 2) { breaks.length = 0; breaks.push(Math.round(minElev), Math.round(maxElev)) }

      // ── 5. isobands — polígonos entre as curvas de nível
      let bands = null
      try {
        bands = turf.isobands(densePts, breaks, { zProperty: 'elevation' })
      } catch (_) {
        try { bands = turf.isobands(rawTurfPts, breaks, { zProperty: 'elevation' }) } catch (_2) { bands = null }
      }

      // ── 6. Desenhar cada isoband colorido pela declividade média do band
      const classCounts = Object.fromEntries(SLOPE_CLASSES.map(c => [c.label, 0]))
      let drawnBands = 0

      if (bands && bands.features.length > 0) {
        bands.features.forEach((feature) => {
          try {
            // Declividade do band = média dos pontos brutos dentro dele (ou mais próximo)
            let avgSlope = 20
            try {
              const inside = turf.pointsWithinPolygon(slopeTurfPts, feature)
              if (inside.features.length > 0) {
                avgSlope = inside.features.reduce((s, f) => s + f.properties.slope, 0) / inside.features.length
              } else {
                const centroid = turf.centroid(feature)
                const nearest  = turf.nearestPoint(centroid, slopeTurfPts)
                avgSlope = nearest.properties.slope
              }
            } catch (_) { /* mantém default */ }

            const classif = classifySlope(avgSlope)
            classCounts[classif.label] = (classCounts[classif.label] || 0) + 1
            drawnBands++

            // Tooltip com intervalo de elevação
            const lv = feature.properties?.['fill-min-value'] ?? feature.properties?.lowerValue ?? ''
            const uv = feature.properties?.['fill-max-value'] ?? feature.properties?.upperValue ?? ''
            const elevLabel = (lv !== '' && uv !== '') ? `${lv}–${uv} m · ` : ''

            L.geoJSON(feature, {
              style: () => ({
                color:       classif.cor,
                fillColor:   classif.cor,
                fillOpacity: 0.52,
                weight:      0.6,
                opacity:     0.2,
              }),
            })
              .bindTooltip(`<b>${classif.label}</b><br>${elevLabel}${avgSlope.toFixed(1)}%`, { sticky: true })
              .addTo(autoLayerRef.current)
          } catch (_) { /* pula band inválido */ }
        })
      }

      // ── 7. Curvas de nível (isolines) sobre os bands — linhas escuras finas
      try {
        const isoLines = turf.isolines(densePts, breaks, { zProperty: 'elevation' })
        L.geoJSON(isoLines, {
          style: f => {
            const elev   = f.properties.elevation
            const master = elev % (interval * 5) === 0
            return { color: '#0f172a', weight: master ? 2 : 0.9, opacity: master ? 0.9 : 0.55 }
          },
          onEachFeature: (f, layer) => {
            layer.bindTooltip(`⛰ ${f.properties.elevation} m`, { sticky: true })
          },
        }).addTo(autoLayerRef.current)
      } catch (_) { /* isolines opcionais */ }

      // ── 8. Caminho de maior declive (steepest descent nos pontos brutos)
      let maxIdx = 0
      elevations.forEach((e, i) => { if (e > elevations[maxIdx]) maxIdx = i })
      const path    = [gridPts[maxIdx]]
      const visited = new Set([maxIdx])
      while (true) {
        const curr = path[path.length - 1]
        const neighbors = [
          { row: curr.row-1, col: curr.col   }, { row: curr.row+1, col: curr.col   },
          { row: curr.row,   col: curr.col-1 }, { row: curr.row,   col: curr.col+1 },
          { row: curr.row-1, col: curr.col-1 }, { row: curr.row-1, col: curr.col+1 },
          { row: curr.row+1, col: curr.col-1 }, { row: curr.row+1, col: curr.col+1 },
        ].filter(n => n.row >= 0 && n.row < GRID && n.col >= 0 && n.col < GRID)
        let best = null, bestElev = curr.elev
        for (const n of neighbors) {
          const idx = n.row * GRID + n.col
          if (!visited.has(idx) && gridPts[idx].elev < bestElev) {
            bestElev = gridPts[idx].elev; best = { ...gridPts[idx], idx }
          }
        }
        if (!best) break
        visited.add(best.idx); path.push(best)
      }

      if (path.length >= 2) {
        const pathCoords = path.map(p => [p.lat, p.lng])
        L.polyline(pathCoords, { color: '#ffffff', weight: 4, opacity: 0.95, dashArray: '10,5' })
          .bindTooltip('📍 Caminho de maior declive').addTo(autoLayerRef.current)
        L.circleMarker(pathCoords[0], { radius: 9, color: '#fff', fillColor: '#ef4444', fillOpacity: 1, weight: 2.5 })
          .bindTooltip(`▲ Topo: ${Math.round(path[0].elev)} m`).addTo(autoLayerRef.current)
        L.circleMarker(pathCoords[pathCoords.length - 1], { radius: 9, color: '#fff', fillColor: '#22c55e', fillOpacity: 1, weight: 2.5 })
          .bindTooltip(`▼ Base: ${Math.round(path[path.length - 1].elev)} m`).addTo(autoLayerRef.current)
      }

      // ── 9. Estatísticas
      const totalCells   = Object.values(classCounts).reduce((s, v) => s + v, 0)
      const maxSlopePct  = Math.max(...slopeAtPt)
      const avgSlopePct  = slopeAtPt.reduce((s, v) => s + v, 0) / slopeAtPt.length
      const pathDesnivel = path.length > 1 ? Math.abs(path[0].elev - path[path.length - 1].elev) : 0
      const pathDistLine = path.length > 1
        ? turf.length(turf.lineString(path.map(p => [p.lng, p.lat])), { units: 'kilometers' }) * 1000
        : 0
      const pathSlope = pathDistLine > 0 ? (pathDesnivel / pathDistLine) * 100 : 0

      setModoAtivo('auto')
      setAutoResultado({
        minElev: Math.round(minElev), maxElev: Math.round(maxElev),
        interval, numBreaks: breaks.length, drawnBands,
        classCounts, totalCells, maxSlopePct, avgSlopePct,
        pathDesnivel: Math.round(pathDesnivel),
        pathDist:     Math.round(pathDistLine),
        pathSlope,
      })
    } catch (e) {
      setAutoResultado({ erro: e.message })
    } finally { setCarregandoAuto(false) }
  }

  // ── Gráfico perfil manual ──────────────────────────────────
  useEffect(() => {
    if (!resultado?.elevations || !chartRef.current) return
    if (chartInstanceRef.current) chartInstanceRef.current.destroy()
    const cor = resultado.classifGlobal?.cor || '#38bdf8'
    chartInstanceRef.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: resultado.distances,
        datasets: [{ label: 'Altitude (m)', data: resultado.elevations.map(e => Math.round(e)), borderColor: cor, backgroundColor: cor + '22', borderWidth: 2, tension: 0.35, fill: true, pointRadius: 0, pointHoverRadius: 4 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => `Dist: ${i[0].label} m`, label: i => `Alt: ${i.raw} m` } } },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 5, callback: (v, i, tks) => i === 0 || i === tks.length - 1 || i === Math.floor(tks.length / 2) ? `${resultado.distances[i]}m` : '' }, grid: { color: '#1e293b' } },
          y: { ticks: { color: '#64748b', font: { size: 10 }, callback: v => `${v}m` }, grid: { color: '#1e293b' } },
        },
      },
    })
  }, [resultado])

  const isLoading = carregando || carregandoAuto

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0f172a' }}>
      <Sidebar />
      <div className={styles.wrapper}>

        {/* ── Mapa ──────────────────────────────────────── */}
        <div className={styles.mapContainer}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarTitle}><FiTrendingUp size={14} /> Declividade</div>

            <select className={styles.select} value={cidade} onChange={e => setCidade(e.target.value)}>
              {Object.values(CIDADES).map(c => (
                <option key={c.codigo} value={c.codigo}>{c.nome}</option>
              ))}
            </select>

            <div className={styles.layerBtns}>
              {LAYERS.map(l => (
                <button key={l.id} className={`${styles.layerBtn} ${camada === l.id ? styles.layerBtnActive : ''}`} onClick={() => setCamada(l.id)}>
                  {l.icone} {l.label}
                </button>
              ))}
            </div>

            <div className={styles.modeBtns}>
              {/* Botão análise automática */}
              <button
                className={`${styles.btn} ${modoAtivo === 'auto' ? styles.btnAutoActive : styles.btnAuto}`}
                onClick={() => { if (modoAtivo === 'auto') { limparAuto() } else { limparManual(); analisarAuto() } }}
                disabled={isLoading}
              >
                <FiZap size={12} />
                {carregandoAuto ? 'Analisando…' : modoAtivo === 'auto' ? 'Limpar auto' : 'Análise automática'}
              </button>

              {/* Separador */}
              <span style={{ color: '#334155', fontSize: 14 }}>|</span>

              {/* Botão desenho manual */}
              <button
                className={`${styles.btn} ${desenhando ? styles.btnDrawActive : styles.btnDraw}`}
                onClick={() => {
                  if (desenhando) finalizarLinha()
                  else { limparManual(); limparAuto(); setDesenhando(true) }
                }}
                disabled={isLoading}
              >
                <FiEdit3 size={12} />
                {desenhando ? 'Finalizar linha' : 'Linha manual'}
              </button>

              {modoAtivo === 'manual' && !desenhando && (
                <button className={`${styles.btn} ${styles.btnClear}`} onClick={limparManual} disabled={isLoading}>
                  <FiTrash2 size={12} /> Limpar
                </button>
              )}
            </div>

            <span className={`${styles.hint} ${desenhando ? styles.hintActive : ''} ${isLoading ? styles.hintLoading : ''}`}>
              {carregandoAuto
                ? '⏳ Buscando grade de elevação…'
                : carregando
                  ? '⏳ Calculando cruzamentos…'
                  : desenhando
                    ? '✏️ Clique para pontos · Duplo clique para finalizar'
                    : modoAtivo === 'auto'
                      ? 'Retângulos coloridos por declividade · linha branca = maior declive'
                      : 'Escolha análise automática ou desenhe uma linha manual'}
            </span>
          </div>

          <div ref={mapRef} className={styles.mapEl} style={{ position: 'absolute', top: 50, left: 0, right: 0, bottom: 0 }} />
        </div>

        {/* ── Painel ────────────────────────────────────── */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <FiActivity size={14} color="#38bdf8" />
            <span className={styles.panelTitle}>
              {modoAtivo === 'auto' ? 'Análise Automática' : modoAtivo === 'manual' ? 'Linha Manual' : 'Resultado'}
            </span>
            {isLoading && <span className={styles.loadingDot} />}
          </div>

          <div className={styles.panelBody}>

            {/* Loading */}
            {isLoading && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>⏳</div>
                <div>{carregandoAuto ? 'Calculando grade de elevação e retângulos de risco…' : 'Calculando cruzamentos de curvas de nível…'}</div>
                <div style={{ fontSize: 11, color: '#475569' }}>Elevação SRTM · Open-Meteo</div>
              </div>
            )}

            {/* Placeholder inicial */}
            {!isLoading && !modoAtivo && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>📐</div>
                <div style={{ fontWeight: 600, color: '#94a3b8' }}>Escolha um modo de análise</div>
                <div style={{ marginTop: 6 }}>
                  <b style={{ color: '#f59e0b' }}>⚡ Automático</b> — analisa toda a vista atual do mapa, desenha retângulos coloridos por risco e traça a linha de maior declive.
                </div>
                <div style={{ marginTop: 8 }}>
                  <b style={{ color: '#38bdf8' }}>✏️ Manual</b> — desenhe uma linha cruzando as curvas de nível para calcular a declividade segmento a segmento.
                </div>
              </div>
            )}

            {/* Erro */}
            {!isLoading && (resultado?.erro || autoResultado?.erro) && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>⚠️</div>
                <div style={{ color: '#f97316' }}>{resultado?.erro || autoResultado?.erro}</div>
              </div>
            )}

            {/* ── Resultado AUTOMÁTICO ──────────────────── */}
            {!isLoading && modoAtivo === 'auto' && autoResultado && !autoResultado.erro && (
              <>
                {/* Stats gerais */}
                <div className={styles.statsGrid}>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Alt. mín</div>
                    <div className={styles.statValue}>{autoResultado.minElev}<span className={styles.statUnit}> m</span></div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Alt. máx</div>
                    <div className={styles.statValue}>{autoResultado.maxElev}<span className={styles.statUnit}> m</span></div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Decliv. máx.</div>
                    <div className={styles.statValue} style={{ color: classifySlope(autoResultado.maxSlopePct).cor }}>
                      {autoResultado.maxSlopePct.toFixed(1)}<span className={styles.statUnit}> %</span>
                    </div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Decliv. média</div>
                    <div className={styles.statValue} style={{ color: classifySlope(autoResultado.avgSlopePct).cor }}>
                      {autoResultado.avgSlopePct.toFixed(1)}<span className={styles.statUnit}> %</span>
                    </div>
                  </div>
                </div>

                {/* Caminho de maior declive */}
                <div className={styles.pathCard}>
                  <div className={styles.pathTitle}>📍 Caminho de maior declive</div>
                  <div className={styles.pathRow}>
                    <span>Distância</span><span>{autoResultado.pathDist} m</span>
                  </div>
                  <div className={styles.pathRow}>
                    <span>Desnível</span><span>{autoResultado.pathDesnivel} m</span>
                  </div>
                  <div className={styles.pathRow}>
                    <span>Declividade</span>
                    <span style={{ color: classifySlope(autoResultado.pathSlope).cor, fontWeight: 700 }}>
                      {autoResultado.pathSlope.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Distribuição por classe */}
                <div>
                  <div className={styles.chartTitle}>Distribuição de risco na área</div>
                  <div className={styles.riskBars}>
                    {SLOPE_CLASSES.map(cls => {
                      const count = autoResultado.classCounts[cls.label] || 0
                      const pct   = (count / autoResultado.totalCells) * 100
                      if (pct === 0) return null
                      return (
                        <div key={cls.label} className={styles.riskBarRow}>
                          <div className={styles.riskBarLabel}>
                            <span style={{ width: 9, height: 9, borderRadius: '50%', background: cls.cor, display: 'inline-block', flexShrink: 0 }} />
                            <span>{cls.label}</span>
                          </div>
                          <div className={styles.riskBarTrack}>
                            <div className={styles.riskBarFill} style={{ width: `${pct}%`, background: cls.cor }} />
                          </div>
                          <span className={styles.riskBarPct}>{pct.toFixed(0)}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Legenda de cores */}
                <div>
                  <div className={styles.chartTitle}>Legenda — retângulos no mapa</div>
                  <div className={styles.legendGrid}>
                    {SLOPE_CLASSES.map(cls => (
                      <div key={cls.label} className={styles.legendItem}>
                        <div style={{ width: 14, height: 14, borderRadius: 3, background: cls.cor, opacity: 0.85, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: cls.cor }}>{cls.label}</div>
                          <div style={{ fontSize: 10, color: '#64748b' }}>≤ {cls.max === Infinity ? '75+' : cls.max}%</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ── Resultado MANUAL ─────────────────────── */}
            {!isLoading && modoAtivo === 'manual' && resultado && !resultado.erro && (
              <>
                <div className={styles.statsGrid}>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Dist. total</div>
                    <div className={styles.statValue}>
                      {resultado.totalDist >= 1000 ? (resultado.totalDist / 1000).toFixed(2) : resultado.totalDist.toFixed(0)}
                      <span className={styles.statUnit}>{resultado.totalDist >= 1000 ? ' km' : ' m'}</span>
                    </div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Decliv. global</div>
                    <div className={styles.statValue} style={{ color: resultado.classifGlobal.cor }}>
                      {resultado.slopeGlobal.toFixed(1)}<span className={styles.statUnit}> %</span>
                    </div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Alt. mínima</div>
                    <div className={styles.statValue}>{resultado.minAlt}<span className={styles.statUnit}> m</span></div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Alt. máxima</div>
                    <div className={styles.statValue}>{resultado.maxAlt}<span className={styles.statUnit}> m</span></div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Desnível</div>
                    <div className={styles.statValue}>{resultado.desnivel}<span className={styles.statUnit}> m</span></div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Curvas cruzadas</div>
                    <div className={styles.statValue}>{resultado.crossings.length}<span className={styles.statUnit}> × {resultado.interval}m</span></div>
                  </div>
                </div>

                <div className={styles.classCard} style={{ borderColor: resultado.classifGlobal.cor + '55', background: resultado.classifGlobal.cor + '12' }}>
                  <div className={styles.classDot} style={{ background: resultado.classifGlobal.cor }} />
                  <div>
                    <div className={styles.classTitle} style={{ color: resultado.classifGlobal.cor }}>{resultado.classifGlobal.label}</div>
                    <div className={styles.classDesc}>{resultado.classifGlobal.desc}</div>
                  </div>
                </div>

                <div>
                  <div className={styles.chartTitle}>Perfil Altimétrico</div>
                  <div className={styles.chartWrap} style={{ height: 140 }}>
                    <canvas ref={chartRef} />
                  </div>
                </div>

                {resultado.segmentos.length > 0 && (
                  <div>
                    <div className={styles.chartTitle}>Segmentos entre curvas ({resultado.interval} m)</div>
                    <div className={styles.segTable}>
                      <div className={styles.segHeader}>
                        <span>Cotas</span><span>Dist.</span><span>Desnível</span><span>Decliv.</span>
                      </div>
                      {resultado.segmentos.map((seg, i) => (
                        <div key={i} className={styles.segRow}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: seg.classif.cor, display: 'inline-block', flexShrink: 0 }} />
                            {seg.de}→{seg.para}m
                          </span>
                          <span>{seg.dist < 1000 ? `${seg.dist.toFixed(0)}m` : `${(seg.dist / 1000).toFixed(2)}km`}</span>
                          <span style={{ color: seg.sobe ? '#f97316' : '#38bdf8' }}>{seg.sobe ? '▲' : '▼'} {seg.elevDiff}m</span>
                          <span style={{ color: seg.classif.cor, fontWeight: 700 }}>{seg.slope.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
