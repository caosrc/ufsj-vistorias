import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as turf from '@turf/turf'
import Chart from 'chart.js/auto'
import { CIDADES, CIDADE_PADRAO } from '../data/cidades'
import Sidebar from '../components/Sidebar'
import styles from './Declividade.module.css'
import { FiTrendingUp, FiTrash2, FiActivity, FiZap, FiEye, FiEyeOff, FiMaximize2 } from 'react-icons/fi'

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
  if (range < 30)  return 5
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
        const dist = distances[i] + t * (distances[i + 1] - distances[i])
        crossings.push({ elevation: cv, dist })
      }
    }
  }
  crossings.sort((a, b) => a.dist - b.dist)
  const filtered = []
  for (const c of crossings) {
    const last = filtered[filtered.length - 1]
    if (!last || Math.abs(c.dist - last.dist) > 2) filtered.push(c)
  }
  return filtered
}

// Retorna coordenada [lng, lat] de um ponto a `distM` metros ao longo de uma line
function pointAlongLine(turfLine, distM) {
  const km = distM / 1000
  const len = turf.length(turfLine, { units: 'kilometers' })
  const safeDist = Math.min(Math.max(km, 0), len)
  return turf.along(turfLine, safeDist, { units: 'kilometers' }).geometry.coordinates
}

export default function Declividade() {
  const mapRef           = useRef(null)
  const leafletRef       = useRef(null)
  const tileLayerRef     = useRef(null)
  const drawLayerRef     = useRef(null)   // linhas sendo desenhadas (preview)
  const boundaryLayerRef = useRef(null)  // linhas A e B salvas
  const resultsLayerRef  = useRef(null)  // polígonos coloridos + curvas
  const chartRef         = useRef(null)
  const chartInstanceRef = useRef(null)
  const drawnPolygonsRef = useRef([])    // [{layer, classLabel}] para toggle
  const drawStateRef     = useRef({ ativo: false, pontos: [], markers: [], activeLine: null, previewLine: null })

  const [cidade,          setCidade]          = useState(CIDADE_PADRAO)
  const [camada,          setCamada]          = useState('topo')
  const [modoDesenho,     setModoDesenho]     = useState(null)  // 'A' | 'B' | null
  const [linhaA,          setLinhaA]          = useState(null)  // L.LatLng[]
  const [linhaB,          setLinhaB]          = useState(null)  // L.LatLng[]
  const [carregando,      setCarregando]      = useState(false)
  const [carregandoAuto,  setCarregandoAuto]  = useState(false)
  const [modoAtivo,       setModoAtivo]       = useState(null)  // 'corredor' | 'auto'
  const [resultado,       setResultado]       = useState(null)
  const [autoResultado,   setAutoResultado]   = useState(null)
  const [classesVisiveis, setClassesVisiveis] = useState(() => new Set(SLOPE_CLASSES.map(c => c.label)))

  // ── Modo Medir: 2 cliques ──────────────────────────────────
  const [modoMedir,       setModoMedir]       = useState(false)
  const [carregandoMedir, setCarregandoMedir] = useState(false)
  const [medicaoResult,   setMedicaoResult]   = useState(null)
  const modoMedirRef = useRef(false)
  useEffect(() => { modoMedirRef.current = modoMedir }, [modoMedir])
  const medirStateRef = useRef({ pt1: null, pt1Marker: null, linhaMedir: null, pt2Marker: null, previewLine: null })

  const modoDesenhoRef = useRef(null)
  useEffect(() => { modoDesenhoRef.current = modoDesenho }, [modoDesenho])

  // ── Toggle visibilidade por classe ─────────────────────────
  useEffect(() => {
    if (!resultsLayerRef.current) return
    drawnPolygonsRef.current.forEach(({ layer, classLabel }) => {
      try {
        if (classesVisiveis.has(classLabel)) {
          if (!resultsLayerRef.current.hasLayer(layer)) resultsLayerRef.current.addLayer(layer)
        } else {
          if (resultsLayerRef.current.hasLayer(layer)) resultsLayerRef.current.removeLayer(layer)
        }
      } catch (_) {}
    })
  }, [classesVisiveis])

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

    tileLayerRef.current    = L.tileLayer(LAYERS[0].url, { attribution: LAYERS[0].attribution, maxZoom: LAYERS[0].maxZoom }).addTo(map)
    drawLayerRef.current    = L.layerGroup().addTo(map)
    boundaryLayerRef.current = L.layerGroup().addTo(map)
    resultsLayerRef.current = L.layerGroup().addTo(map)

    map.on('click',     handleClick)
    map.on('dblclick',  handleDblClick)
    map.on('mousemove', handleMouseMove)
    leafletRef.current = map
    return () => { map.remove(); leafletRef.current = null }
  }, [])

  useEffect(() => {
    if (!leafletRef.current || !tileLayerRef.current) return
    const l = LAYERS.find(l => l.id === camada)
    tileLayerRef.current.setUrl(l.url)
    tileLayerRef.current.options.maxZoom = l.maxZoom
  }, [camada])

  useEffect(() => {
    if (!leafletRef.current) return
    const c = CIDADES[cidade]
    const [lng, lat] = c.center
    leafletRef.current.flyTo([lat, lng], 13, { duration: 1.2 })
  }, [cidade])

  useEffect(() => {
    if (!mapRef.current) return
    const drawing = modoDesenho === 'A' || modoDesenho === 'B'
    mapRef.current.style.cursor = drawing ? 'crosshair' : ''
    drawStateRef.current.ativo = drawing
    if (!drawing) limparDesenhoPreview()
  }, [modoDesenho])

  // ── Eventos de mapa ────────────────────────────────────────
  function handleClick(e) {
    // Modo medir: 1º clique = ponto inicial, 2º clique = ponto final e calcula
    if (modoMedirRef.current) {
      const ms = medirStateRef.current
      if (!ms.pt1) {
        // 1º clique: marca ponto inicial
        ms.pt1 = e.latlng
        ms.pt1Marker = L.circleMarker(e.latlng, {
          radius: 7, color: '#a78bfa', fillColor: '#a78bfa', fillOpacity: 1, weight: 2
        }).bindTooltip('Ponto A').addTo(drawLayerRef.current)
      } else {
        // 2º clique: finaliza e calcula
        const pt2 = e.latlng
        if (ms.previewLine) { drawLayerRef.current.removeLayer(ms.previewLine); ms.previewLine = null }
        ms.linhaMedir = L.polyline([ms.pt1, pt2], {
          color: '#a78bfa', weight: 3, opacity: 0.95, dashArray: '8,4'
        }).addTo(drawLayerRef.current)
        ms.pt2Marker = L.circleMarker(pt2, {
          radius: 7, color: '#a78bfa', fillColor: '#f0abfc', fillOpacity: 1, weight: 2
        }).bindTooltip('Ponto B').addTo(drawLayerRef.current)
        setModoMedir(false)
        calcularDeclividade(ms.pt1, pt2)
      }
      return
    }
    if (!drawStateRef.current.ativo) return
    adicionarPonto(e.latlng)
  }
  function handleDblClick(e)  { if (!drawStateRef.current.ativo) return; L.DomEvent.stop(e); finalizarLinha() }
  function handleMouseMove(e) {
    // Preview no modo medir
    if (modoMedirRef.current) {
      const ms = medirStateRef.current
      if (!ms.pt1) return
      if (!ms.previewLine) {
        ms.previewLine = L.polyline([], { color: '#a78bfa', weight: 1.5, dashArray: '4,4', opacity: 0.6 }).addTo(drawLayerRef.current)
      }
      ms.previewLine.setLatLngs([ms.pt1, e.latlng])
      return
    }
    const state = drawStateRef.current
    if (!state.ativo || state.pontos.length === 0) return
    const ultimo = state.pontos[state.pontos.length - 1]
    if (!state.previewLine) {
      state.previewLine = L.polyline([], { color: modoDesenhoRef.current === 'A' ? '#f97316' : '#38bdf8', weight: 1.5, dashArray: '5,5', opacity: 0.7 }).addTo(drawLayerRef.current)
    }
    state.previewLine.setLatLngs([ultimo, e.latlng])
  }

  function adicionarPonto(latlng) {
    const state = drawStateRef.current
    state.pontos.push(latlng)
    const cor = modoDesenhoRef.current === 'A' ? '#f97316' : '#38bdf8'
    const m = L.circleMarker(latlng, { radius: 5, color: cor, fillColor: cor, fillOpacity: 1, weight: 2 }).addTo(drawLayerRef.current)
    state.markers.push(m)
    if (state.pontos.length >= 2) {
      if (state.activeLine) drawLayerRef.current.removeLayer(state.activeLine)
      state.activeLine = L.polyline(state.pontos, { color: cor, weight: 2.5, opacity: 0.9 }).addTo(drawLayerRef.current)
      // 2º ponto finaliza a linha automaticamente
      finalizarLinha()
    }
  }

  function finalizarLinha() {
    const state = drawStateRef.current
    const modo  = modoDesenhoRef.current
    const pontos = [...state.pontos]
    limparDesenhoPreview()
    if (pontos.length < 2) { setModoDesenho(null); return }

    const cor = modo === 'A' ? '#f97316' : '#38bdf8'
    const label = modo === 'A' ? 'Linha A' : 'Linha B'
    // Salva linha no boundaryLayer com a cor correspondente
    L.polyline(pontos, { color: cor, weight: 3, opacity: 0.85, dashArray: '8,4' })
      .bindTooltip(label).addTo(boundaryLayerRef.current)

    if (modo === 'A') {
      setLinhaA(pontos)
      setModoDesenho('B') // Automaticamente pede para desenhar linha B
    } else if (modo === 'B') {
      setLinhaB(pontos)
      setModoDesenho(null)
      // Análise é disparada pelo useEffect quando linhaB é setada
    }
  }

  // Dispara análise quando as duas linhas estão prontas
  const linhaARef = useRef(null)
  useEffect(() => { linhaARef.current = linhaA }, [linhaA])

  useEffect(() => {
    if (linhaB && linhaARef.current) {
      analisarCorredor(linhaARef.current, linhaB)
    }
  }, [linhaB])

  function limparDesenhoPreview() {
    const state = drawStateRef.current
    state.markers.forEach(m => drawLayerRef.current?.removeLayer(m))
    if (state.activeLine)  drawLayerRef.current?.removeLayer(state.activeLine)
    if (state.previewLine) drawLayerRef.current?.removeLayer(state.previewLine)
    state.pontos = []; state.markers = []; state.activeLine = null; state.previewLine = null
  }

  function limparMedicao() {
    const ms = medirStateRef.current
    if (ms.pt1Marker)   drawLayerRef.current?.removeLayer(ms.pt1Marker)
    if (ms.pt2Marker)   drawLayerRef.current?.removeLayer(ms.pt2Marker)
    if (ms.linhaMedir)  drawLayerRef.current?.removeLayer(ms.linhaMedir)
    if (ms.previewLine) drawLayerRef.current?.removeLayer(ms.previewLine)
    medirStateRef.current = { pt1: null, pt1Marker: null, linhaMedir: null, pt2Marker: null, previewLine: null }
    setModoMedir(false)
    setMedicaoResult(null)
  }

  function limparTudo() {
    limparDesenhoPreview()
    limparMedicao()
    boundaryLayerRef.current?.clearLayers()
    resultsLayerRef.current?.clearLayers()
    drawnPolygonsRef.current = []
    setLinhaA(null); setLinhaB(null)
    setModoDesenho(null); setModoAtivo(null)
    setResultado(null); setAutoResultado(null)
    if (chartInstanceRef.current) { chartInstanceRef.current.destroy(); chartInstanceRef.current = null }
    setClassesVisiveis(new Set(SLOPE_CLASSES.map(c => c.label)))
  }

  // ── Cálculo de declividade por 2 pontos ───────────────────
  async function calcularDeclividade(pt1, pt2) {
    setCarregandoMedir(true)
    setMedicaoResult(null)
    try {
      const tLine = turf.lineString([[pt1.lng, pt1.lat], [pt2.lng, pt2.lat]])
      const distHorizM = turf.length(tLine, { units: 'kilometers' }) * 1000

      const elevs = await fetchElevations([[pt1.lng, pt1.lat], [pt2.lng, pt2.lat]])
      const cotaA = elevs[0]
      const cotaB = elevs[1]
      const deltaH = Math.abs(cotaB - cotaA)
      const slopePct = distHorizM > 0 ? (deltaH / distHorizM) * 100 : 0
      const slopeGrau = Math.atan(deltaH / distHorizM) * (180 / Math.PI)
      const classif = classifySlope(slopePct)

      // Adiciona cotas nos marcadores
      const ms = medirStateRef.current
      if (ms.pt1Marker) ms.pt1Marker.setTooltipContent(`Ponto A: ${Math.round(cotaA)} m`)
      if (ms.pt2Marker) ms.pt2Marker.setTooltipContent(`Ponto B: ${Math.round(cotaB)} m`)
      if (ms.linhaMedir) ms.linhaMedir.bindTooltip(
        `↕ ${Math.round(deltaH)} m · ${slopePct.toFixed(1)}% · ${classif.label}`,
        { permanent: true, direction: 'center', className: '' }
      ).openTooltip()

      setModoAtivo('medir')
      setMedicaoResult({ cotaA: Math.round(cotaA), cotaB: Math.round(cotaB), deltaH: Math.round(deltaH), distHorizM: Math.round(distHorizM), slopePct, slopeGrau, classif })
    } catch (e) {
      setMedicaoResult({ erro: e.message })
    } finally {
      setCarregandoMedir(false)
    }
  }

  // ── Análise de corredor (duas linhas) ──────────────────────
  async function analisarCorredor(ptosA, ptosB) {
    setCarregando(true)
    resultsLayerRef.current?.clearLayers()
    drawnPolygonsRef.current = []
    setResultado(null)

    try {
      const lineA = turf.lineString(ptosA.map(p => [p.lng, p.lat]))
      const lineB = turf.lineString(ptosB.map(p => [p.lng, p.lat]))
      const distAm = turf.length(lineA, { units: 'kilometers' }) * 1000
      const distBm = turf.length(lineB, { units: 'kilometers' }) * 1000

      // 50 amostras por linha = 100 pontos total (limite da API)
      const N = 49 // 0..49 = 50 pts por linha
      const ptsA = [], ptsB = [], distsA = [], distsB = []
      for (let i = 0; i <= N; i++) {
        ptsA.push(pointAlongLine(lineA, (i / N) * distAm))
        distsA.push((i / N) * distAm)
        ptsB.push(pointAlongLine(lineB, (i / N) * distBm))
        distsB.push((i / N) * distBm)
      }

      const allElevs = await fetchElevations([...ptsA, ...ptsB])
      const elevsA   = allElevs.slice(0, N + 1)
      const elevsB   = allElevs.slice(N + 1)

      const interval = detectContourInterval([...elevsA, ...elevsB])
      const crossA   = findContourCrossings(elevsA, distsA, interval)
      const crossB   = findContourCrossings(elevsB, distsB, interval)

      // Índice rápido por cota
      const mapA = new Map(crossA.map(c => [c.elevation, c]))
      const mapB = new Map(crossB.map(c => [c.elevation, c]))

      // Cotas presentes nas duas linhas
      const cotas = [...mapA.keys()].filter(e => mapB.has(e)).sort((a, b) => a - b)

      const classCounts = Object.fromEntries(SLOPE_CLASSES.map(c => [c.label, 0]))
      let drawnCount = 0

      for (let i = 0; i < cotas.length - 1; i++) {
        const E1 = cotas[i], E2 = cotas[i + 1]
        if (E2 - E1 !== interval) continue // apenas cotas consecutivas

        const cA1 = mapA.get(E1), cA2 = mapA.get(E2)
        const cB1 = mapB.get(E1), cB2 = mapB.get(E2)

        const ptA1 = pointAlongLine(lineA, cA1.dist) // [lng, lat]
        const ptA2 = pointAlongLine(lineA, cA2.dist)
        const ptB1 = pointAlongLine(lineB, cB1.dist)
        const ptB2 = pointAlongLine(lineB, cB2.dist)

        // Distância horizontal entre as cotas (= largura do band = base da declividade)
        const d1 = turf.distance(ptA1, ptB1, { units: 'meters' }) * 1000
        const d2 = turf.distance(ptA2, ptB2, { units: 'meters' }) * 1000
        const horizDist = (d1 + d2) / 2

        if (horizDist < 0.5) continue // evita divisão por zero em terreno plano
        const slopePct = (interval / horizDist) * 100
        const classif  = classifySlope(slopePct)
        classCounts[classif.label] = (classCounts[classif.label] || 0) + 1

        // Polígono: A1 → B1 → B2 → A2 (sentido horário)
        const polygon = L.polygon(
          [ptA1, ptB1, ptB2, ptA2].map(([lng, lat]) => [lat, lng]),
          {
            color: classif.cor, fillColor: classif.cor,
            fillOpacity: 0.60, weight: 1.2, opacity: 0.4,
          }
        ).bindTooltip(
          `<b>${classif.label}</b><br>${E1}→${E2} m · ${slopePct.toFixed(1)}%`,
          { sticky: true }
        )

        polygon.addTo(resultsLayerRef.current)
        drawnPolygonsRef.current.push({ layer: polygon, classLabel: classif.label })
        drawnCount++
      }

      // Marcadores nas linhas
      const eleMinA = Math.min(...elevsA), eleMaxA = Math.max(...elevsA)
      const eleMinB = Math.min(...elevsB), eleMaxB = Math.max(...elevsB)
      const allElevsArr = [...elevsA, ...elevsB]
      const minElev = Math.min(...allElevsArr), maxElev = Math.max(...allElevsArr)

      const totalCells = Object.values(classCounts).reduce((s, v) => s + v, 0)
      const maxSlope = drawnCount > 0
        ? SLOPE_CLASSES.find(c => classCounts[c.label] > 0 && c.max !== Infinity)?.max || 0
        : 0

      setModoAtivo('corredor')
      setResultado({
        type: 'corredor',
        minElev: Math.round(minElev), maxElev: Math.round(maxElev),
        interval, drawnCount, cotas: cotas.length, classCounts, totalCells,
      })
    } catch (e) {
      setResultado({ erro: e.message })
    } finally {
      setCarregando(false)
    }
  }

  // ── Análise automática (isobands + 2 chamadas paralelas) ───
  async function analisarAuto() {
    setCarregandoAuto(true); setAutoResultado(null)
    resultsLayerRef.current?.clearLayers()
    boundaryLayerRef.current?.clearLayers()
    drawLayerRef.current?.clearLayers()
    drawnPolygonsRef.current = []
    setLinhaA(null); setLinhaB(null)
    setModoDesenho(null)

    try {
      const map    = leafletRef.current
      const bounds = map.getBounds()
      const N = bounds.getNorth(), S = bounds.getSouth()
      const W = bounds.getWest(),  E = bounds.getEast()

      // Grade 10×10 principal + grade 10×10 deslocada (200 pts no total, 2 chamadas paralelas)
      const GRID = 10
      const grid1 = [], grid2 = []
      const stepLat = (N - S) / (GRID - 1)
      const stepLng = (E - W) / (GRID - 1)

      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          grid1.push([W + c * stepLng, S + r * stepLat])
          // grade 2: deslocada meio passo (preenche lacunas)
          const lat2 = S + (r + 0.5) * stepLat
          const lng2 = W + (c + 0.5) * stepLng
          if (lat2 < N && lng2 < E) grid2.push([lng2, lat2])
        }
      }

      // Duas chamadas paralelas à API
      const [elevs1, elevs2] = await Promise.all([
        fetchElevations(grid1),
        fetchElevations(grid2.slice(0, 100)),
      ])

      // Monta FeatureCollection com todos os pontos de elevação
      const allTurfPts = turf.featureCollection([
        ...grid1.map((c, i) => turf.point(c, { elevation: elevs1[i] })),
        ...grid2.slice(0, elevs2.length).map((c, i) => turf.point(c, { elevation: elevs2[i] })),
      ])

      const allElevs = [...elevs1, ...elevs2]
      const minElev  = Math.min(...allElevs)
      const maxElev  = Math.max(...allElevs)
      const range    = maxElev - minElev

      let interval = 5
      if (range > 80)  interval = 10
      if (range > 200) interval = 20
      if (range > 400) interval = 50

      // Calcular slope na grade principal (para colorir os isobands)
      const cellH = turf.distance(grid1[0], grid1[GRID], { units: 'meters' }) * 1000
      const cellW = turf.distance(grid1[0], grid1[1],    { units: 'meters' }) * 1000
      const slopeAtPt = grid1.map((_, idx) => {
        const row = Math.floor(idx / GRID), col = idx % GRID
        const Lv = col > 0       ? elevs1[row*GRID+(col-1)] : elevs1[idx]
        const Rv = col < GRID-1  ? elevs1[row*GRID+(col+1)] : elevs1[idx]
        const Uv = row > 0       ? elevs1[(row-1)*GRID+col] : elevs1[idx]
        const Dv = row < GRID-1  ? elevs1[(row+1)*GRID+col] : elevs1[idx]
        const dx = (col > 0 && col < GRID-1) ? 2*cellW : cellW
        const dy = (row > 0 && row < GRID-1) ? 2*cellH : cellH
        return Math.sqrt(((Rv-Lv)/dx)**2 + ((Dv-Uv)/dy)**2) * 100
      })
      const slopeTurfPts = turf.featureCollection(
        grid1.map((c, i) => turf.point(c, { slope: slopeAtPt[i] }))
      )

      // Interpolar superfície densa
      const lonKm  = (E - W) * Math.cos(((N+S)/2) * Math.PI/180) * 111.32
      const latKm  = (N - S) * 111.32
      const cellKm = Math.max(Math.min(lonKm, latKm) / 30, 0.1)
      let densePts = allTurfPts
      try {
        densePts = turf.interpolate(allTurfPts, cellKm, {
          gridType: 'point', property: 'elevation', units: 'kilometers', weight: 3,
        })
      } catch (_) {}

      // Breaks de cota
      const breaks = []
      for (let e = Math.ceil(minElev/interval)*interval; e <= Math.floor(maxElev/interval)*interval; e += interval) {
        breaks.push(e)
      }
      if (breaks.length < 2) { breaks.push(Math.round(minElev), Math.round(maxElev)) }

      // isobands
      let bands = null
      try { bands = turf.isobands(densePts, breaks, { zProperty: 'elevation' }) }
      catch (_) {
        try { bands = turf.isobands(allTurfPts, breaks, { zProperty: 'elevation' }) } catch (_2) {}
      }

      const classCounts = Object.fromEntries(SLOPE_CLASSES.map(c => [c.label, 0]))

      if (bands?.features?.length) {
        bands.features.forEach((feature) => {
          try {
            let avgSlope = 20
            try {
              const inside = turf.pointsWithinPolygon(slopeTurfPts, feature)
              if (inside.features.length > 0) {
                avgSlope = inside.features.reduce((s, f) => s + f.properties.slope, 0) / inside.features.length
              } else {
                avgSlope = turf.nearestPoint(turf.centroid(feature), slopeTurfPts).properties.slope
              }
            } catch (_) {}

            const classif = classifySlope(avgSlope)
            classCounts[classif.label] = (classCounts[classif.label] || 0) + 1

            const layer = L.geoJSON(feature, {
              style: () => ({ color: classif.cor, fillColor: classif.cor, fillOpacity: 0.55, weight: 0.5, opacity: 0.15 }),
            }).bindTooltip(`<b>${classif.label}</b><br>${avgSlope.toFixed(1)}%`, { sticky: true })

            layer.addTo(resultsLayerRef.current)
            drawnPolygonsRef.current.push({ layer, classLabel: classif.label })
          } catch (_) {}
        })
      }

      // Curvas de nível sobre os bands
      try {
        const isoLines = turf.isolines(densePts, breaks, { zProperty: 'elevation' })
        L.geoJSON(isoLines, {
          style: f => {
            const master = f.properties.elevation % (interval * 5) === 0
            return { color: '#0f172a', weight: master ? 2 : 0.8, opacity: master ? 0.9 : 0.5 }
          },
          onEachFeature: (f, layer) => { layer.bindTooltip(`⛰ ${f.properties.elevation} m`, { sticky: true }) },
        }).addTo(resultsLayerRef.current)
      } catch (_) {}

      // Caminho de maior declive
      let maxIdx = 0
      elevs1.forEach((e, i) => { if (e > elevs1[maxIdx]) maxIdx = i })
      const path = [{ lat: grid1[maxIdx][1], lng: grid1[maxIdx][0], elev: elevs1[maxIdx], row: Math.floor(maxIdx/GRID), col: maxIdx%GRID }]
      const visited = new Set([maxIdx])
      while (true) {
        const curr = path[path.length - 1]
        const nbrs = [
          [curr.row-1,curr.col],[curr.row+1,curr.col],[curr.row,curr.col-1],[curr.row,curr.col+1],
          [curr.row-1,curr.col-1],[curr.row-1,curr.col+1],[curr.row+1,curr.col-1],[curr.row+1,curr.col+1],
        ].filter(([r,c]) => r>=0&&r<GRID&&c>=0&&c<GRID)
        let best = null, bestElev = curr.elev
        for (const [r, c] of nbrs) {
          const idx = r*GRID+c
          if (!visited.has(idx) && elevs1[idx] < bestElev) {
            bestElev = elevs1[idx]; best = { lat: grid1[idx][1], lng: grid1[idx][0], elev: elevs1[idx], row: r, col: c, idx }
          }
        }
        if (!best) break; visited.add(best.idx); path.push(best)
      }
      if (path.length >= 2) {
        L.polyline(path.map(p => [p.lat, p.lng]), { color: '#fff', weight: 4, opacity: 0.95, dashArray: '10,5' })
          .bindTooltip('Caminho de maior declive').addTo(resultsLayerRef.current)
        L.circleMarker([path[0].lat, path[0].lng], { radius: 9, color: '#fff', fillColor: '#ef4444', fillOpacity: 1, weight: 2.5 })
          .bindTooltip(`▲ ${Math.round(path[0].elev)} m`).addTo(resultsLayerRef.current)
        L.circleMarker([path[path.length-1].lat, path[path.length-1].lng], { radius: 9, color: '#fff', fillColor: '#22c55e', fillOpacity: 1, weight: 2.5 })
          .bindTooltip(`▼ ${Math.round(path[path.length-1].elev)} m`).addTo(resultsLayerRef.current)
      }

      const totalCells = Object.values(classCounts).reduce((s,v) => s+v, 0)
      setModoAtivo('auto')
      setAutoResultado({
        minElev: Math.round(minElev), maxElev: Math.round(maxElev),
        interval, numBreaks: breaks.length, classCounts, totalCells,
        maxSlopePct: Math.max(...slopeAtPt),
        avgSlopePct: slopeAtPt.reduce((s,v) => s+v, 0) / slopeAtPt.length,
      })
    } catch (e) {
      setAutoResultado({ erro: e.message })
    } finally { setCarregandoAuto(false) }
  }

  // ── Gráfico (não usado no modo corredor, mantido para compatibilidade)
  useEffect(() => {
    if (!resultado?.elevations || !chartRef.current) return
    if (chartInstanceRef.current) chartInstanceRef.current.destroy()
    const cor = '#38bdf8'
    chartInstanceRef.current = new Chart(chartRef.current, {
      type: 'line',
      data: { labels: resultado.distances, datasets: [{ data: resultado.elevations.map(e => Math.round(e)), borderColor: cor, backgroundColor: cor+'22', borderWidth: 2, tension: 0.35, fill: true, pointRadius: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } } } },
    })
  }, [resultado])

  const isLoading = carregando || carregandoAuto || carregandoMedir
  const linhaAFeita = !!linhaA
  const linhaBFeita = !!linhaB

  const hintMsg = carregandoMedir
    ? '⏳ Buscando cotas de elevação…'
    : carregandoAuto
      ? '⏳ Buscando grade de elevação…'
      : carregando
        ? '⏳ Analisando corredor entre as linhas…'
        : modoMedir && !medirStateRef.current.pt1
          ? '🟣 Clique no mapa para marcar o Ponto A (início da linha)'
          : modoMedir && medirStateRef.current.pt1
            ? '🟣 Clique para marcar o Ponto B — a declividade será calculada automaticamente'
            : modoDesenho === 'A'
              ? '🟠 Desenhe a Linha A — clique para pontos, duplo clique para finalizar'
              : modoDesenho === 'B'
                ? '🔵 Desenhe a Linha B no outro lado do talude'
                : modoAtivo === 'medir'
                  ? 'Linha medida · clique em Medir para nova medição'
                  : modoAtivo === 'corredor'
                    ? 'Polígonos entre as curvas de nível coloridos por risco'
                    : modoAtivo === 'auto'
                      ? 'Isobands coloridos por declividade · linha branca = maior declive'
                      : 'Escolha Medir, Análise Auto ou Linha A + B para delimitar o corredor'

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0f172a' }}>
      <Sidebar />
      <div className={styles.wrapper}>

        {/* ── Mapa ──────────────────────────────────────── */}
        <div className={styles.mapContainer}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarTitle}><FiTrendingUp size={14} /> Declividade</div>

            <select className={styles.select} value={cidade} onChange={e => setCidade(e.target.value)}>
              {Object.values(CIDADES).map(c => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}
            </select>

            <div className={styles.layerBtns}>
              {LAYERS.map(l => (
                <button key={l.id} className={`${styles.layerBtn} ${camada === l.id ? styles.layerBtnActive : ''}`} onClick={() => setCamada(l.id)}>
                  {l.icone} {l.label}
                </button>
              ))}
            </div>

            <div className={styles.modeBtns}>
              {/* ── Medir: 2 cliques ── */}
              <button
                className={`${styles.btn} ${modoMedir ? styles.btnMedirActive : styles.btnMedir}`}
                onClick={() => {
                  if (modoMedir) { limparMedicao(); return }
                  limparTudo()
                  setModoMedir(true)
                }}
                disabled={isLoading && !modoMedir}
              >
                <FiMaximize2 size={12} />
                {carregandoMedir ? 'Calculando…' : modoMedir ? 'Cancelar' : 'Medir'}
              </button>

              <span style={{ color: '#334155', fontSize: 14 }}>|</span>

              {/* Análise automática */}
              <button
                className={`${styles.btn} ${modoAtivo === 'auto' ? styles.btnAutoActive : styles.btnAuto}`}
                onClick={() => modoAtivo === 'auto' ? limparTudo() : analisarAuto()}
                disabled={isLoading}
              >
                <FiZap size={12} />
                {carregandoAuto ? 'Analisando…' : modoAtivo === 'auto' ? 'Limpar' : 'Auto'}
              </button>

              <span style={{ color: '#334155', fontSize: 14 }}>|</span>

              {/* Linha A */}
              <button
                className={`${styles.btn} ${modoDesenho === 'A' ? styles.btnLineAActive : linhaAFeita ? styles.btnLineADone : styles.btnLineA}`}
                onClick={() => {
                  limparTudo()
                  setModoDesenho('A')
                }}
                disabled={isLoading}
              >
                <span style={{ fontWeight: 700 }}>A</span>
                {modoDesenho === 'A' ? ' desenhando…' : linhaAFeita ? ' ✓' : ' Linha A'}
              </button>

              {/* Linha B */}
              <button
                className={`${styles.btn} ${modoDesenho === 'B' ? styles.btnLineBActive : linhaBFeita ? styles.btnLineBDone : styles.btnLineB}`}
                onClick={() => {
                  if (!linhaAFeita) return
                  if (linhaBFeita) { setLinhaB(null); boundaryLayerRef.current?.clearLayers(); resultsLayerRef.current?.clearLayers(); drawnPolygonsRef.current = [] }
                  setModoDesenho('B')
                }}
                disabled={isLoading || (!linhaAFeita && modoDesenho !== 'B')}
              >
                <span style={{ fontWeight: 700 }}>B</span>
                {modoDesenho === 'B' ? ' desenhando…' : linhaBFeita ? ' ✓' : ' Linha B'}
              </button>

              {/* Limpar */}
              {(modoAtivo || linhaAFeita || modoDesenho || modoMedir) && (
                <button className={`${styles.btn} ${styles.btnClear}`} onClick={limparTudo} disabled={isLoading && !modoMedir}>
                  <FiTrash2 size={12} />
                </button>
              )}
            </div>

            <span className={`${styles.hint} ${modoDesenho ? styles.hintActive : ''} ${isLoading ? styles.hintLoading : ''}`}>
              {hintMsg}
            </span>
          </div>

          <div ref={mapRef} className={styles.mapEl} style={{ position: 'absolute', top: 50, left: 0, right: 0, bottom: 0 }} />
        </div>

        {/* ── Painel ────────────────────────────────────── */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <FiActivity size={14} color="#38bdf8" />
            <span className={styles.panelTitle}>
              {modoAtivo === 'corredor' ? 'Corredor de Risco' : modoAtivo === 'auto' ? 'Análise Automática' : 'Resultado'}
            </span>
            {isLoading && <span className={styles.loadingDot} />}
          </div>

          <div className={styles.panelBody}>

            {/* Loading */}
            {isLoading && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>⏳</div>
                <div>{carregandoAuto ? 'Calculando isobands e grade de elevação…' : 'Calculando polígonos entre curvas de nível…'}</div>
                <div style={{ fontSize: 11, color: '#475569' }}>Elevação SRTM · Open-Meteo</div>
              </div>
            )}

            {/* Instruções */}
            {!isLoading && !modoAtivo && !modoDesenho && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>📐</div>
                <div style={{ fontWeight: 600, color: '#94a3b8' }}>Dois modos de análise</div>
                <div style={{ marginTop: 8 }}>
                  <b style={{ color: '#f59e0b' }}>⚡ Auto</b> — analisa a vista atual, colore as faixas entre curvas de nível pelo grau de risco.
                </div>
                <div style={{ marginTop: 8 }}>
                  <b style={{ color: '#f97316' }}>A</b> + <b style={{ color: '#38bdf8' }}>B</b> — desenhe duas linhas laterais delimitando o talude. Os retângulos entre cada par de curvas de nível ficam coloridos pela declividade.
                </div>
              </div>
            )}

            {/* Instrução modo Medir */}
            {!isLoading && modoMedir && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>📏</div>
                <div style={{ fontWeight: 600, color: '#a78bfa' }}>
                  {medirStateRef.current.pt1 ? 'Agora clique no Ponto B' : 'Clique no Ponto A'}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5 }}>
                  {medirStateRef.current.pt1
                    ? 'Um clique encerra a linha e calcula a declividade automaticamente.'
                    : 'Marque o início da linha no mapa com um clique.'}
                </div>
              </div>
            )}

            {/* Instrução durante desenho */}
            {!isLoading && modoDesenho && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>{modoDesenho === 'A' ? '🟠' : '🔵'}</div>
                <div style={{ fontWeight: 600, color: modoDesenho === 'A' ? '#f97316' : '#38bdf8' }}>
                  Desenhando Linha {modoDesenho}
                </div>
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  {modoDesenho === 'A'
                    ? 'Clique no mapa para adicionar pontos. A Linha A define a borda esquerda do talude.'
                    : 'Clique no mapa para adicionar pontos. A Linha B define a borda direita. Ao finalizar, os polígonos serão calculados automaticamente.'}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
                  Duplo clique para finalizar a linha
                </div>
                {linhaAFeita && modoDesenho === 'B' && (
                  <div style={{ marginTop: 8, padding: '6px 10px', background: '#1e293b', borderRadius: 6, fontSize: 11, color: '#22c55e' }}>
                    ✓ Linha A salva — agora desenhe a Linha B
                  </div>
                )}
              </div>
            )}

            {/* ── Resultado da Medição (2 pontos) ──────────── */}
            {!isLoading && modoAtivo === 'medir' && medicaoResult && !medicaoResult.erro && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: medicaoResult.classif.cor, display: 'inline-block' }} />
                  <span style={{ fontWeight: 700, color: medicaoResult.classif.cor, fontSize: 15 }}>{medicaoResult.classif.label}</span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>{medicaoResult.classif.desc}</span>
                </div>

                <div className={styles.statsGrid}>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Declividade</div>
                    <div className={styles.statValue} style={{ color: medicaoResult.classif.cor }}>
                      {medicaoResult.slopePct.toFixed(1)}<span className={styles.statUnit}> %</span>
                    </div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Ângulo</div>
                    <div className={styles.statValue} style={{ color: medicaoResult.classif.cor }}>
                      {medicaoResult.slopeGrau.toFixed(1)}<span className={styles.statUnit}> °</span>
                    </div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Cota A</div>
                    <div className={styles.statValue}>{medicaoResult.cotaA}<span className={styles.statUnit}> m</span></div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Cota B</div>
                    <div className={styles.statValue}>{medicaoResult.cotaB}<span className={styles.statUnit}> m</span></div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Desnível (Δh)</div>
                    <div className={styles.statValue}>{medicaoResult.deltaH}<span className={styles.statUnit}> m</span></div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Dist. horizontal</div>
                    <div className={styles.statValue}>
                      {medicaoResult.distHorizM >= 1000
                        ? (medicaoResult.distHorizM / 1000).toFixed(2)
                        : medicaoResult.distHorizM}
                      <span className={styles.statUnit}> {medicaoResult.distHorizM >= 1000 ? 'km' : 'm'}</span>
                    </div>
                  </div>
                </div>

                <div style={{ background: medicaoResult.classif.cor + '18', border: `1px solid ${medicaoResult.classif.cor}44`, borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#e2e8f0', lineHeight: 1.5 }}>
                  <b style={{ color: medicaoResult.classif.cor }}>Fórmula:</b> declividade = (Δh / distância) × 100<br />
                  = ({medicaoResult.deltaH} m / {medicaoResult.distHorizM} m) × 100 = <b style={{ color: medicaoResult.classif.cor }}>{medicaoResult.slopePct.toFixed(2)}%</b>
                </div>

                <button
                  className={`${styles.btn} ${styles.btnMedir}`}
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => { limparMedicao(); setModoAtivo(null); setModoMedir(true) }}
                >
                  <FiMaximize2 size={12} /> Nova medição
                </button>
              </>
            )}

            {/* Erro */}
            {!isLoading && (resultado?.erro || autoResultado?.erro || medicaoResult?.erro) && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>⚠️</div>
                <div style={{ color: '#f97316' }}>{resultado?.erro || autoResultado?.erro || medicaoResult?.erro}</div>
              </div>
            )}

            {/* ── Legenda com toggle (apenas corredor e auto) ─── */}
            {!isLoading && modoAtivo && modoAtivo !== 'medir' && !resultado?.erro && !autoResultado?.erro && (
              <div>
                <div className={styles.chartTitle}>Legenda — clique para mostrar/ocultar</div>
                <div className={styles.legendToggleList}>
                  {SLOPE_CLASSES.map(cls => {
                    const visible = classesVisiveis.has(cls.label)
                    const count   = modoAtivo === 'corredor'
                      ? resultado?.classCounts?.[cls.label] || 0
                      : autoResultado?.classCounts?.[cls.label] || 0
                    return (
                      <button
                        key={cls.label}
                        className={`${styles.legendToggleBtn} ${visible ? styles.legendToggleBtnOn : styles.legendToggleBtnOff}`}
                        style={{ borderColor: visible ? cls.cor : '#334155' }}
                        onClick={() => setClassesVisiveis(prev => {
                          const next = new Set(prev)
                          if (next.has(cls.label)) next.delete(cls.label)
                          else next.add(cls.label)
                          return next
                        })}
                      >
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: visible ? cls.cor : '#334155', flexShrink: 0, display: 'inline-block' }} />
                        <span style={{ flex: 1, textAlign: 'left', color: visible ? cls.cor : '#475569' }}>{cls.label}</span>
                        <span style={{ color: visible ? '#94a3b8' : '#334155', fontSize: 10 }}>
                          {count > 0 ? count : ''}
                        </span>
                        {visible ? <FiEye size={11} color="#94a3b8" /> : <FiEyeOff size={11} color="#334155" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Stats corredor ───────────────────────── */}
            {!isLoading && modoAtivo === 'corredor' && resultado && !resultado.erro && (
              <>
                <div className={styles.statsGrid}>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Cotas cruzadas</div>
                    <div className={styles.statValue}>{resultado.cotas}<span className={styles.statUnit}> ×{resultado.interval}m</span></div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Polígonos</div>
                    <div className={styles.statValue}>{resultado.drawnCount}</div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Alt. mín</div>
                    <div className={styles.statValue}>{resultado.minElev}<span className={styles.statUnit}> m</span></div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Alt. máx</div>
                    <div className={styles.statValue}>{resultado.maxElev}<span className={styles.statUnit}> m</span></div>
                  </div>
                </div>

                <div>
                  <div className={styles.chartTitle}>Distribuição de risco no corredor</div>
                  <div className={styles.riskBars}>
                    {SLOPE_CLASSES.map(cls => {
                      const count = resultado.classCounts?.[cls.label] || 0
                      const pct   = resultado.totalCells > 0 ? (count / resultado.totalCells) * 100 : 0
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
              </>
            )}

            {/* ── Stats auto ───────────────────────────── */}
            {!isLoading && modoAtivo === 'auto' && autoResultado && !autoResultado.erro && (
              <>
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

                <div>
                  <div className={styles.chartTitle}>Distribuição por classe</div>
                  <div className={styles.riskBars}>
                    {SLOPE_CLASSES.map(cls => {
                      const count = autoResultado.classCounts?.[cls.label] || 0
                      const pct   = autoResultado.totalCells > 0 ? (count / autoResultado.totalCells) * 100 : 0
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
              </>
            )}

          </div>
        </div>

      </div>
    </div>
  )
}
