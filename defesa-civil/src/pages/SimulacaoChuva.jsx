import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { FiArrowLeft, FiDroplet, FiPlay, FiCloud, FiZap, FiDownload, FiX, FiCpu, FiAlertTriangle } from 'react-icons/fi'
import { CIDADES } from '../data/cidades'
import Sidebar from '../components/Sidebar'
import styles from './SimulacaoChuva.module.css'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { API_BASE } from '../services/api'

const GRID_N       = 20
const GRID_SPACING = 0.006

// ── utilidades ────────────────────────────────────────────────────────────────
function corAgua(mm) {
  if (mm < 20)  return '#bfdbfe'
  if (mm < 50)  return '#3b82f6'
  if (mm < 100) return '#1d4ed8'
  if (mm < 200) return '#7c3aed'
  return '#dc2626'
}

function getCidadeCoords(key) {
  const c = CIDADES[key]
  return { lat: c.center[1], lng: c.center[0], nome: c.nome }
}

// Interpola elevação do grid D8 para qualquer lat/lng
function getElevInterpolated(lat, lng, cells) {
  if (!cells?.length) return 800
  let nearest = cells[0], minDist = Infinity
  for (const c of cells) {
    const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2
    if (d < minDist) { minDist = d; nearest = c }
  }
  return nearest.elev
}

// Cor da zona de inundação baseada em risco (0–1) + acumulação
function corZonaInundacao(risco, acumulado) {
  if (risco > 0.8 || acumulado > 180)  return { fill: '#7c3aed', stroke: '#4c1d95' }
  if (risco > 0.6 || acumulado > 100)  return { fill: '#1d4ed8', stroke: '#1e3a8a' }
  if (risco > 0.4 || acumulado > 50)   return { fill: '#2563eb', stroke: '#1d4ed8' }
  if (risco > 0.2 || acumulado > 25)   return { fill: '#3b82f6', stroke: '#2563eb' }
  return                                       { fill: '#93c5fd', stroke: '#3b82f6' }
}

// Gota de chuva
function criarGotas(n, W, H) {
  return Array.from({ length: n }, () => ({
    x:   Math.random() * W,
    y:   Math.random() * H,
    vy:  9 + Math.random() * 9,
    vx: -0.5 - Math.random() * 0.9,
    len: 11 + Math.random() * 13,
    op:  0.13 + Math.random() * 0.18,
  }))
}

// Partículas D8 (escoamento de terreno, off-road)
function criarParticulas(cells) {
  const all = []
  cells.forEach(cell => {
    if (!cell.fluxo || cell.acumulado < 12) return
    const n = Math.max(1, Math.round(cell.acumulado / 35))
    for (let k = 0; k < Math.min(n, 3); k++) {
      all.push({ cell, t: Math.random(), vida: 90 + Math.random() * 150, vidaMax: 240 })
    }
  })
  return all
}

// ──────────────────────────────────────────────────────────────────────────────
export default function SimulacaoChuva() {
  const mapRef        = useRef(null)
  const canvasRef     = useRef(null)
  const mapInst       = useRef(null)
  const rafRef        = useRef(null)
  const workerRef     = useRef(null)
  const gotasRef      = useRef([])
  const particulasRef = useRef([])
  const gridRef       = useRef(null)
  const ruasRef       = useRef([])       // segmentos OSM com elevação já calculada
  const frameRef      = useRef(0)
  const modoRef       = useRef('idle')   // idle | chuva | escoamento
  const mmRef         = useRef(80)
  const filtroRef     = useRef(null)     // células destacadas pelo filtro ativo

  const [cidade,       setCidade]       = useState('ouro_branco')
  const [precipitacao, setPrecipitacao] = useState(80)
  const [dias,         setDias]         = useState(3)
  const [iteracoes,    setIteracoes]    = useState(5)
  const [saturado,     setSaturado]     = useState(false)
  const [simulando,    setSimulando]    = useState(false)
  const [buscando,     setBuscando]     = useState(false)
  const [animando,     setAnimando]     = useState(false)
  const [resultado,    setResultado]    = useState(null)
  const [previsao,     setPrevisao]     = useState(null)
  const [workerAtivo,  setWorkerAtivo]  = useState(false)
  const [ruasStatus,   setRuasStatus]   = useState('idle')
  const [filtroAtivo,  setFiltroAtivo]  = useState(null)  // 'media'|'max'|'altos'|'criticos'|'depressoes'
  const [erro,         setErro]         = useState('')

  useEffect(() => { mmRef.current = precipitacao }, [precipitacao])

  // ── mapa Leaflet ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapInst.current) return
    const { lat, lng } = getCidadeCoords(cidade)
    const map = L.map(mapRef.current, { zoomControl: true }).setView([lat, lng], 14)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)
    mapInst.current = map

    const sync = () => {
      const c = canvasRef.current; if (!c) return
      const r = mapRef.current.getBoundingClientRect()
      c.width = r.width; c.height = r.height
    }
    map.on('resize move zoom', sync)
    sync()
    return () => { map.remove(); mapInst.current = null }
  }, [])

  useEffect(() => {
    if (!mapInst.current) return
    const { lat, lng } = getCidadeCoords(cidade)
    mapInst.current.setView([lat, lng], 14)
    pararTudo()
    ruasRef.current = []; gridRef.current = null
    setResultado(null); setPrevisao(null); setErro(''); setRuasStatus('idle')
  }, [cidade])

  // ── busca ruas OSM + adiciona elevação por segmento ───────────────────────
  async function buscarRuasComElevacao(lat, lng, cells) {
    setRuasStatus('carregando')
    try {
      const query = `[out:json][timeout:20];
        way["highway"~"primary|secondary|tertiary|residential|unclassified|service|trunk"](around:2500,${lat},${lng});
        out geom;`
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST', body: query,
        signal: AbortSignal.timeout(25000),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()

      // enriquece cada segmento com elevação nos extremos (usa grid D8)
      const ruas = data.elements
        .filter(e => e.geometry?.length > 1)
        .map(rua => {
          const geom     = rua.geometry
          const elevStart = getElevInterpolated(geom[0].lat,               geom[0].lon,                           cells)
          const elevEnd   = getElevInterpolated(geom[geom.length-1].lat,   geom[geom.length-1].lon,               cells)
          const slopePct  = (elevStart - elevEnd) / Math.max(1,
            distanciaM(geom[0].lat, geom[0].lon, geom[geom.length-1].lat, geom[geom.length-1].lon))
          return {
            ...rua,
            elevStart, elevEnd,
            slopePct,                              // positivo = desce nessa direção
            flowForward: elevStart >= elevEnd,     // se água vai do node[0] → node[N]
            hw: rua.tags?.highway || 'residential',
          }
        })

      ruasRef.current = ruas
      setRuasStatus('ok')
    } catch {
      setRuasStatus('erro')
    }
  }

  // distância em metros entre dois pontos lat/lng
  function distanciaM(la1, lo1, la2, lo2) {
    const R = 6371000
    const dlat = (la2 - la1) * Math.PI / 180
    const dlng = (lo2 - lo1) * Math.PI / 180
    const a = Math.sin(dlat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dlng/2)**2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  }

  // ── loop canvas ────────────────────────────────────────────────────────────
  const loopCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const map    = mapInst.current
    if (!canvas || !map) return

    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const modo = modoRef.current
    frameRef.current++

    // SEMPRE limpar completamente — mapa sempre visível
    ctx.clearRect(0, 0, W, H)

    if (modo === 'idle') { rafRef.current = requestAnimationFrame(loopCanvas); return }

    const intens = Math.min(1, mmRef.current / 150)
    const cells  = gridRef.current || []
    const ruas   = ruasRef.current

    // ── CAMADA 1: chuva caindo (gotas) ────────────────────────────────────
    gotasRef.current.forEach(g => {
      g.x += g.vx; g.y += g.vy * (0.4 + intens * 0.9)
      if (g.y > H + g.len) { g.y = -g.len; g.x = Math.random() * W }
      if (g.x < -20) g.x = W + 20

      ctx.save()
      ctx.globalAlpha = g.op * (0.3 + intens * 0.7)
      ctx.beginPath()
      ctx.moveTo(g.x, g.y)
      ctx.lineTo(g.x + g.vx * 2, g.y + g.len)
      ctx.strokeStyle = '#93c5fd'
      ctx.lineWidth = 1.1
      ctx.stroke()
      ctx.restore()
    })

    if (modo === 'escoamento' && cells.length > 0) {

      // pré-cálculos compartilhados entre camadas
      const maxFA  = Math.max(...cells.map(c => c.fa || 1))
      const logMax = Math.log2(Math.max(maxFA, 2))

      // ── CAMADA 2: zonas de inundação (baseadas em FA + acumulado) ────────
      // Renderiza do menos crítico para o mais crítico (painter's algorithm)
      const cellsSorted = [...cells].sort((a, b) => a.risco - b.risco)

      cellsSorted.forEach(cell => {
        if (!cell.risco || cell.risco < 0.15) return

        const pt    = map.latLngToContainerPoint([cell.lat, cell.lng])
        const { fill, stroke } = corZonaInundacao(cell.risco, cell.acumulado)

        // raio proporcional à área contribuinte (FA)
        const faNorm = Math.sqrt((cell.fa || 1) / Math.max(maxFA, 1))
        const r      = 22 + faNorm * 55 + cell.risco * 20
        const alpha  = Math.min(0.45, 0.08 + cell.risco * 0.40)

        // gradiente radial suave
        ctx.save()
        ctx.globalAlpha = alpha
        const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r)
        grad.addColorStop(0, fill)
        grad.addColorStop(0.6, fill)
        grad.addColorStop(1, 'transparent')
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.fill()
        ctx.restore()

        // borda nas zonas críticas
        if (cell.risco > 0.65) {
          ctx.save()
          ctx.globalAlpha = 0.35
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, r * 0.55, 0, Math.PI * 2)
          ctx.strokeStyle = stroke
          ctx.lineWidth   = 1.5
          ctx.setLineDash([4, 4])
          ctx.stroke()
          ctx.setLineDash([])
          ctx.restore()
        }
      })

      // ── CAMADA 3: depressões — pontos de alagamento ───────────────────
      cells.forEach(cell => {
        if (!cell.depressao || cell.acumulado < 20) return
        const pt    = map.latLngToContainerPoint([cell.lat, cell.lng])
        const pulse = 0.5 + 0.5 * Math.sin(frameRef.current * 0.06)
        const r     = 10 + pulse * 6

        ctx.save()
        ctx.globalAlpha = 0.55 + pulse * 0.25
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2)
        ctx.fillStyle   = '#7c3aed'
        ctx.fill()
        ctx.globalAlpha = 0.85
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#fff'
        ctx.fill()
        ctx.restore()
      })

      // ── CAMADA 4: ruas como contexto visual estático (sem direção de trânsito) ─
      // Apenas canal leve — a direção da água é dada pelo D8, não pela rua
      if (ruas.length > 0) {
        ruas.forEach(rua => {
          const pts = rua.geometry
            .map(p => map.latLngToContainerPoint([p.lat, p.lon]))
            .filter(p => p.x > -60 && p.x < W + 60 && p.y > -60 && p.y < H + 60)
          if (pts.length < 2) return
          const hw = rua.hw || 'residential'
          const lw = hw === 'primary' || hw === 'trunk' ? 2.5 : hw === 'secondary' ? 2 : 1.2
          ctx.save()
          ctx.globalAlpha = 0.12 * intens + 0.05
          ctx.beginPath()
          pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
          ctx.strokeStyle = '#38bdf8'
          ctx.lineWidth   = lw
          ctx.lineCap     = 'round'
          ctx.lineJoin    = 'round'
          ctx.stroke()
          ctx.restore()
        })
      }

      // ── CAMADA 5: REDE DE DRENAGEM D8 (toda a superfície — ruas E terreno) ──
      // Cada célula → sua vizinha D8 mais baixa. Largura e cor ∝ FA (área contribuinte)
      // Isso é a rede de rios/córregos "natural" do terreno.

      // ordena do menor FA (nascentes) para o maior (rios principais) — painter's
      const cellsOrdenadas = [...cells].filter(c => c.fluxo && c.fa >= 1).sort((a, b) => a.fa - b.fa)

      cellsOrdenadas.forEach(cell => {
        if (!cell.fluxo) return
        const o = map.latLngToContainerPoint([cell.lat,       cell.lng])
        const d = map.latLngToContainerPoint([cell.fluxo.lat, cell.fluxo.lng])

        // só desenha se pelo menos um ponto estiver na tela
        if (o.x < -20 && d.x < -20) return
        if (o.x > W + 20 && d.x > W + 20) return

        // escala logarítmica do FA → espessura (0.4 a 5 px)
        const faLog = Math.log2(Math.max(cell.fa, 1))
        const lw    = Math.min(5.5, 0.4 + faLog * 0.65)

        // cor: nascente (azul claro) → canal principal (azul escuro)
        const t = Math.min(1, faLog / logMax)
        const r = Math.round(147 - t * 110)  // 147→37
        const g = Math.round(197 - t * 100)  // 197→97
        const b = Math.round(253 - t * 55)   // 253→198

        // velocidade do dash ∝ declividade D8
        const slope   = cell.slopeD8 || 0
        const vel     = 0.4 + slope * 18
        const dashLen = Math.max(4, 10 - faLog * 1.2)  // nascentes: dash curto; rios: dash longo
        const gapLen  = dashLen * 0.8
        const off     = -(frameRef.current * vel * 0.07) % (dashLen + gapLen)

        // opacidade: nascentes = discreta, rios principais = bem visível
        const alpha = Math.min(0.88, 0.15 + t * 0.60 + (cell.risco || 0) * 0.18)

        ctx.save()
        ctx.globalAlpha = alpha
        ctx.setLineDash([dashLen, gapLen])
        ctx.lineDashOffset = off
        ctx.beginPath()
        ctx.moveTo(o.x, o.y)
        ctx.lineTo(d.x, d.y)
        ctx.strokeStyle = `rgb(${r},${g},${b})`
        ctx.lineWidth   = lw
        ctx.lineCap     = 'round'
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      })

      // ── CAMADA 6: partículas fluindo pela rede D8 ─────────────────────
      const vivos = []
      particulasRef.current.forEach(p => {
        p.vida--
        if (p.vida <= 0 || !p.cell?.fluxo) return
        // velocidade da partícula ∝ declividade + FA (rios = mais rápidos)
        const slope  = p.cell.slopeD8 || 0.01
        const faBoost = Math.min(2, Math.log2(Math.max(p.cell.fa, 1)) / 4)
        p.t += (0.005 + slope * 0.045) * (1 + faBoost)
        if (p.t >= 1) {
          p.cell = p.cell.fluxo; p.t = 0
          if (!p.cell.fluxo) return
        }

        const o  = map.latLngToContainerPoint([p.cell.lat,       p.cell.lng])
        const d  = map.latLngToContainerPoint([p.cell.fluxo.lat, p.cell.fluxo.lng])
        const px = o.x + (d.x - o.x) * p.t
        const py = o.y + (d.y - o.y) * p.t

        // tamanho ∝ FA (rios = partículas maiores)
        const faR = Math.min(4, 1.5 + Math.log2(Math.max(p.cell.fa, 1)) * 0.35)
        // cor ∝ declividade (rápido = quente, lento = azul)
        const cor = slope > 0.20 ? '#ef4444' : slope > 0.10 ? '#fb923c' : slope > 0.05 ? '#facc15' : '#38bdf8'

        ctx.save()
        ctx.globalAlpha = Math.min(0.92, 0.25 + p.vida / p.vidaMax * 0.67)
        ctx.beginPath()
        ctx.arc(px, py, faR, 0, Math.PI * 2)
        ctx.fillStyle = cor
        ctx.fill()
        ctx.restore()
        vivos.push(p)
      })
      particulasRef.current = vivos

      // reinjetar partículas — mais fontes para grade 20×20
      if (particulasRef.current.length < 160 && cells.length > 0) {
        particulasRef.current.push(...criarParticulas(cells).slice(0, 55))
      }

      // ── CAMADA 7: destaque do filtro ativo ────────────────────────────
      const filtradas = filtroRef.current
      if (filtradas?.length > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(frameRef.current * 0.08)
        filtradas.forEach((cell, idx) => {
          const pt = map.latLngToContainerPoint([cell.lat, cell.lng])
          const r  = 28 + pulse * 12

          // anel pulsante externo
          ctx.save()
          ctx.globalAlpha = 0.25 + pulse * 0.35
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2)
          ctx.strokeStyle = cell.depressao ? '#7c3aed' : cell.risco > 0.65 ? '#dc2626' : cell.risco > 0.40 ? '#f97316' : '#2563eb'
          ctx.lineWidth   = 2.5
          ctx.stroke()
          ctx.restore()

          // círculo sólido interno
          ctx.save()
          ctx.globalAlpha = 0.55 + pulse * 0.25
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2)
          ctx.fillStyle = cell.depressao ? '#7c3aed' : cell.risco > 0.65 ? '#dc2626' : cell.risco > 0.40 ? '#f97316' : '#2563eb'
          ctx.fill()
          ctx.restore()

          // número do índice
          ctx.save()
          ctx.globalAlpha = 1
          ctx.font        = 'bold 9px sans-serif'
          ctx.fillStyle   = '#fff'
          ctx.textAlign   = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(idx + 1, pt.x, pt.y)
          ctx.restore()

          // rótulo com valor (acumulado ou tipo)
          const label = cell.depressao
            ? `⚠ Alagamento\n${cell.acumulado.toFixed(0)} mm`
            : `${cell.acumulado.toFixed(0)} mm`
          const lines = label.split('\n')
          ctx.save()
          ctx.globalAlpha = 0.92
          ctx.font        = 'bold 10px sans-serif'
          const maxW = Math.max(...lines.map(l => ctx.measureText(l).width))
          const bw = maxW + 12, bh = lines.length * 14 + 6
          const bx = pt.x - bw / 2, by = pt.y + 16
          ctx.fillStyle = 'rgba(15,23,42,0.85)'
          ctx.beginPath()
          ctx.roundRect(bx, by, bw, bh, 5)
          ctx.fill()
          ctx.fillStyle = '#fff'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          lines.forEach((line, li) => ctx.fillText(line, pt.x, by + 3 + li * 14))
          ctx.restore()
        })
      }
    }

    rafRef.current = requestAnimationFrame(loopCanvas)
  }, [])

  function iniciarLoop() { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(loopCanvas) }

  // ── filtro: ao clicar num card, destacar e centralizar as células ─────────
  function irParaFiltro(tipo) {
    const cells = gridRef.current
    if (!cells?.length || !mapInst.current) return

    // toggle — se já está ativo, desliga
    if (filtroAtivo === tipo) {
      filtroRef.current = null
      setFiltroAtivo(null)
      return
    }

    let selecionadas = []
    if (tipo === 'criticos')   selecionadas = cells.filter(c => c.risco > 0.65).sort((a, b) => b.risco - a.risco)
    if (tipo === 'altos')      selecionadas = cells.filter(c => c.risco > 0.40 && c.risco <= 0.65).sort((a, b) => b.risco - a.risco)
    if (tipo === 'depressoes') selecionadas = cells.filter(c => c.depressao && c.acumulado >= 20).sort((a, b) => b.acumulado - a.acumulado)
    if (tipo === 'max') {
      const maxAcum = Math.max(...cells.map(c => c.acumulado))
      selecionadas = cells.filter(c => c.acumulado >= maxAcum * 0.85).sort((a, b) => b.acumulado - a.acumulado)
    }
    if (tipo === 'media') {
      const med = cells.reduce((s, c) => s + c.acumulado, 0) / cells.length
      // mostra as células mais próximas da média
      selecionadas = [...cells].sort((a, b) => Math.abs(a.acumulado - med) - Math.abs(b.acumulado - med)).slice(0, 6)
    }

    if (selecionadas.length === 0) return

    filtroRef.current = selecionadas
    setFiltroAtivo(tipo)

    // zoom para o grupo de células destacadas
    if (selecionadas.length === 1) {
      mapInst.current.setView([selecionadas[0].lat, selecionadas[0].lng], 15, { animate: true })
    } else {
      const lats = selecionadas.map(c => c.lat)
      const lngs = selecionadas.map(c => c.lng)
      const bounds = L.latLngBounds(
        [Math.min(...lats) - 0.003, Math.min(...lngs) - 0.003],
        [Math.max(...lats) + 0.003, Math.max(...lngs) + 0.003]
      )
      mapInst.current.fitBounds(bounds, { animate: true, padding: [40, 40] })
    }
  }

  function pararTudo() {
    modoRef.current = 'idle'
    cancelAnimationFrame(rafRef.current)
    gotasRef.current = []; particulasRef.current = []; frameRef.current = 0
    setAnimando(false)
    const cv = canvasRef.current
    if (cv) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height)
  }

  // ── elevação por batch ─────────────────────────────────────────────────────
  async function buscarElevacao(pontos) {
    const BATCH = 50, elev = []
    for (let i = 0; i < pontos.length; i += BATCH) {
      const lote = pontos.slice(i, i + BATCH)
      const lats = lote.map(p => p.lat.toFixed(6)).join(',')
      const lngs = lote.map(p => p.lng.toFixed(6)).join(',')
      const res  = await fetch(`${API_BASE}/elevation?latitude=${lats}&longitude=${lngs}`)
      if (!res.ok) throw new Error('Falha na API de elevação')
      const data = await res.json()
      elev.push(...(data.elevation || lote.map(() => 800)))
    }
    return elev
  }

  // ── D8 flow direction ──────────────────────────────────────────────────────
  function calcularFluxoD8(cells) {
    const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
    cells.forEach(cell => {
      let melhor = null, maxSlope = -Infinity
      dirs.forEach(([dr, dc]) => {
        const viz = cells.find(v => v.row === cell.row + dr && v.col === cell.col + dc)
        if (!viz) return
        const dist  = (Math.abs(dr) + Math.abs(dc) === 2) ? 1.414 : 1
        const slope = (cell.elev - viz.elev) / (dist * GRID_SPACING * 111000)
        if (slope > maxSlope) { maxSlope = slope; melhor = viz }
      })
      cell.fluxo   = melhor
      cell.slopeD8 = Math.max(0, maxSlope)
    })
  }

  // ── simulação principal ────────────────────────────────────────────────────
  async function simular(mmDia, numDias, isSaturado) {
    setSimulando(true); setErro(''); pararTudo()

    const { lat, lng } = getCidadeCoords(cidade)
    const offset = Math.floor(GRID_N / 2) * GRID_SPACING

    const pontos = []
    for (let i = 0; i < GRID_N; i++)
      for (let j = 0; j < GRID_N; j++)
        pontos.push({ lat: lat - offset + i * GRID_SPACING, lng: lng - offset + j * GRID_SPACING, row: i, col: j })

    try {
      const elevacoes = await buscarElevacao(pontos)

      const cells = pontos.map((p, idx) => {
        const elev    = elevacoes[idx] ?? 800
        const vizElev = pontos
          .filter(v => Math.abs(v.row - p.row) <= 1 && Math.abs(v.col - p.col) <= 1 && v !== p)
          .map(v => elevacoes[pontos.indexOf(v)] ?? 800)
        const elevMax  = vizElev.length ? Math.max(...vizElev) : elev
        const deltaH   = Math.max(0, elevMax - elev)
        const slopeDeg = Math.atan(deltaH / (GRID_SPACING * 111000)) * (180 / Math.PI)
        const coef     = slopeDeg < 10 ? 0.30 : slopeDeg < 20 ? 0.50 : slopeDeg < 45 ? 0.70 : 0.90
        const infil    = isSaturado ? 0.08 : 0.38
        const fatSat   = isSaturado ? 1.55 : 1.00
        const agua     = mmDia * numDias * coef * fatSat * (1 - infil)
        return { ...p, elev, agua, acumulado: agua, slopeDeg, slopeD8: 0, coef, fluxo: null, fa: 1, risco: 0, depressao: false }
      })

      calcularFluxoD8(cells)

      // chuva começa imediatamente (responsividade visual)
      const cv = canvasRef.current
      const W = cv?.width || 800, H = cv?.height || 600
      gotasRef.current = criarGotas(Math.floor(mmDia * 2.8 + 200), W, H)
      modoRef.current  = 'chuva'
      iniciarLoop()

      // busca ruas OSM (em paralelo, não bloqueia)
      buscarRuasComElevacao(lat, lng, cells).catch(() => {})

      // worker calcula FA + risco + transferência D8
      workerRef.current?.terminate()
      const worker = new Worker('/workers/simWorker.js')
      workerRef.current = worker
      setWorkerAtivo(true)

      const onResult = (result) => {
        worker.terminate(); workerRef.current = null; setWorkerAtivo(false)
        gridRef.current       = result
        particulasRef.current = criarParticulas(result)
        modoRef.current       = 'escoamento'

        const criticos    = result.filter(c => c.risco > 0.65).length
        const muitoAltos  = result.filter(c => c.risco > 0.40 && c.risco <= 0.65).length
        const depressoes  = result.filter(c => c.depressao).length
        const maxAcum     = Math.max(...result.map(c => c.acumulado))
        const mediaAcum   = result.reduce((s, c) => s + c.acumulado, 0) / result.length

        setResultado({ criticos, muitoAltos, depressoes, maxAcum: maxAcum.toFixed(1), mediaAcum: mediaAcum.toFixed(1), total: result.length, mmDia, numDias, isSaturado })
        setAnimando(true)
        setSimulando(false)
      }
      worker.onmessage = e => onResult(e.data)
      worker.onerror   = ()  => onResult(cells)
      worker.postMessage({ cells, iteracoes })

    } catch {
      setErro('Erro ao buscar dados de elevação. Verifique a conexão.')
      modoRef.current = 'idle'; setSimulando(false)
    }
  }

  // ── previsão real (proxy via backend) ────────────────────────────────────
  async function usarPrevisaoReal() {
    setBuscando(true); setErro('')
    try {
      const { lat, lng } = getCidadeCoords(cidade)
      const res = await fetch(`${API_BASE}/previsao?lat=${lat}&lng=${lng}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const d    = data.daily
      const valores = d.precipitation_sum
      const totalMm  = valores.reduce((a, b) => a + (b || 0), 0)
      const mediaDia = totalMm / valores.length
      const autoSat  = totalMm > 100
      setPrevisao({
        dias:        d.time,
        valores,
        probChuva:   d.precipitation_probability_max || [],
        tempMax:     d.temperature_2m_max            || [],
        tempMin:     d.temperature_2m_min            || [],
        weatherCode: d.weather_code                  || [],
        total:       totalMm.toFixed(1),
        mediaDia:    mediaDia.toFixed(1),
      })
      setPrecipitacao(Math.round(mediaDia))
      setDias(valores.length)
      setSaturado(autoSat)
      // inicia simulação logo após mostrar previsão
      await simular(mediaDia, valores.length, autoSat)
    } catch (e) {
      setErro(`Erro ao buscar previsão: ${e.message}`)
    }
    setBuscando(false)
  }

  // ── exportar ───────────────────────────────────────────────────────────────
  function exportarRelatorio() {
    if (!resultado) return
    const { lat, lng, nome } = getCidadeCoords(cidade)
    const txt = [
      '═══════════════════════════════════════════════════════════════',
      '              RELATÓRIO DE SIMULAÇÃO DE INUNDAÇÃO',
      '              Geovistorias — Defesa Civil MG',
      '═══════════════════════════════════════════════════════════════',
      `Município : ${nome}`,
      `Data/Hora : ${new Date().toLocaleString('pt-BR')}`,
      `Coord.    : Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}`,
      `Ruas OSM  : ${ruasRef.current.length} segmentos com fluxo calculado`,
      '',
      `Precipitação : ${resultado.mmDia.toFixed(1)} mm/dia × ${resultado.numDias} dias = ${(resultado.mmDia*resultado.numDias).toFixed(1)} mm`,
      `Solo saturado: ${resultado.isSaturado ? 'Sim (infiltração reduzida 92%)' : 'Não'}`,
      '',
      '── Zonas de Risco ──────────────────────────────────────────────',
      `Pontos analisados : ${resultado.total}`,
      `Acumulado médio   : ${resultado.mediaAcum} mm`,
      `Acumulado máximo  : ${resultado.maxAcum} mm`,
      `Zonas críticas    : ${resultado.criticos}`,
      `Zonas altas       : ${resultado.muitoAltos}`,
      `Depressões/pontos de alagamento: ${resultado.depressoes}`,
      '',
      resultado.criticos > 0
        ? `⚠ ATENÇÃO: ${resultado.criticos} zona(s) CRÍTICA(S) — acionar plano de contingência!`
        : '✔ Nenhuma zona crítica identificada neste evento.',
      '',
      '  Metodologia: D8 Flow Direction + Flow Accumulation + OSM Streets',
      '  Classificação: NBR 11682:2009 / IPT-Defesa Civil',
      '═══════════════════════════════════════════════════════════════',
    ].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }))
    a.download = `inundacao_${nome.split(' ')[0].toLowerCase()}_${Date.now()}.txt`
    a.click()
  }

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); workerRef.current?.terminate() }, [])

  const totalMm = precipitacao * dias

  return (
    <div className={styles.container}>
      <Sidebar />
      <div className={styles.conteudo}>

        {/* Header */}
        <div className={styles.header}>
          <Link to='/' className={styles.btnVoltar}><FiArrowLeft size={15} /> Mapa</Link>
          <FiDroplet size={19} color='#2563eb' />
          <h1 className={styles.titulo}>Simulação de Inundação</h1>
          {animando && <span className={styles.liveBadge}><span className={styles.liveDot} /> AO VIVO</span>}
        </div>

        <div className={styles.corpo}>

          {/* ─── Painel esquerdo ─── */}
          <div className={styles.painel}>

            <div className={styles.secao}>
              <p className={styles.secTitulo}>Município</p>
              <select className={styles.select} value={cidade} onChange={e => setCidade(e.target.value)}>
                <option value='ouro_branco'>Ouro Branco - MG</option>
                <option value='congonhas'>Congonhas - MG</option>
              </select>
            </div>

            <div className={styles.secao}>
              <p className={styles.secTitulo}>Precipitação</p>
              <label className={styles.label}>mm por dia</label>
              <input type='number' min={1} max={500} className={styles.input}
                value={precipitacao} onChange={e => setPrecipitacao(Number(e.target.value))} />
              <label className={styles.label}>Dias consecutivos</label>
              <input type='number' min={1} max={30} className={styles.input}
                value={dias} onChange={e => setDias(Number(e.target.value))} />
              <div className={styles.checkRow}>
                <input type='checkbox' id='sat' checked={saturado} onChange={e => setSaturado(e.target.checked)} />
                <label htmlFor='sat' className={styles.checkLabel}>Solo saturado (+55% escoamento)</label>
              </div>
              <div className={styles.totalBadge}>
                Total: <strong>{totalMm.toFixed(0)} mm</strong>
              </div>
            </div>

            <div className={styles.secao}>
              <p className={styles.secTitulo}>Avançado</p>
              <label className={styles.label}>Iterações D8</label>
              <div className={styles.rangeRow}>
                <input type='range' min={1} max={10} step={1} value={iteracoes}
                  onChange={e => setIteracoes(Number(e.target.value))} />
                <span className={styles.rangeVal}>{iteracoes}×</span>
              </div>
              <div className={styles.workerBadge}>
                <FiCpu size={11} /> Grade {GRID_N}×{GRID_N} · Worker D8+FA
              </div>
              <div className={styles.workerBadge} style={{
                background: ruasStatus === 'ok' ? '#f0fdf4' : ruasStatus === 'carregando' ? '#fffbeb' : '#f8fafc',
                color: ruasStatus === 'ok' ? '#166534' : ruasStatus === 'carregando' ? '#92400e' : '#64748b',
              }}>
                🛣️ {ruasStatus === 'ok' ? `${ruasRef.current.length} ruas com declividade` : ruasStatus === 'carregando' ? 'carregando ruas OSM...' : 'ruas carregadas ao simular'}
              </div>
            </div>

            <div className={styles.secao}>
              <button className={styles.btnPrimario} onClick={() => simular(precipitacao, dias, saturado)} disabled={simulando || buscando}>
                <FiPlay size={13} /> {simulando ? 'Calculando...' : 'Simular inundação'}
              </button>
              <button className={styles.btnSecundario} onClick={usarPrevisaoReal} disabled={buscando || simulando}>
                <FiCloud size={13} /> {buscando ? 'Buscando...' : 'Previsão real (7 dias)'}
              </button>
            </div>

            {previsao && (
              <div className={styles.secao}>
                <p className={styles.secTitulo}>
                  🌧️ Previsão 7 dias — <strong>{previsao.total} mm</strong> total
                  &nbsp;<span style={{ color:'#64748b', fontWeight:400 }}>({previsao.mediaDia} mm/dia)</span>
                </p>
                <div className={styles.tabelaPrevisao}>
                  {previsao.dias.map((dia, i) => {
                    const mm      = previsao.valores[i]   || 0
                    const prob    = previsao.probChuva[i] ?? null
                    const tmax    = previsao.tempMax[i]   ?? null
                    const tmin    = previsao.tempMin[i]   ?? null
                    const wc      = previsao.weatherCode[i] ?? 0
                    // ícone simplificado pelo WMO weather code
                    const icone = wc === 0 ? '☀️' : wc <= 3 ? '⛅' : wc <= 49 ? '🌫️' : wc <= 69 ? '🌧️' : wc <= 79 ? '🌨️' : wc <= 99 ? '⛈️' : '🌧️'
                    return (
                      <div key={dia} className={styles.linhaDia}>
                        <span className={styles.diaIcone}>{icone}</span>
                        <span className={styles.diaNome}>
                          {new Date(dia + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })}
                        </span>
                        <div className={styles.diaInfo}>
                          <div className={styles.barraWrap}>
                            <div className={styles.barra} style={{ width: `${Math.min(100, mm * 2.5)}%`, background: corAgua(mm) }} />
                          </div>
                          <div className={styles.diaMeta}>
                            <span className={styles.mmDia} style={{ color: corAgua(mm) }}>{mm.toFixed(1)} mm</span>
                            {prob !== null && <span className={styles.prob}>💧{prob}%</span>}
                            {tmax !== null && <span className={styles.temp}>{Math.round(tmin)}–{Math.round(tmax)}°C</span>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {previsao.total > 0 && (
                  <div className={styles.alertaPrevisao} style={{
                    background: Number(previsao.total) > 150 ? '#fef2f2' : Number(previsao.total) > 80 ? '#fffbeb' : '#f0fdf4',
                    borderColor: Number(previsao.total) > 150 ? '#fca5a5' : Number(previsao.total) > 80 ? '#fde68a' : '#bbf7d0',
                    color: Number(previsao.total) > 150 ? '#991b1b' : Number(previsao.total) > 80 ? '#92400e' : '#166534',
                  }}>
                    {Number(previsao.total) > 150
                      ? `⚠️ Chuva intensa prevista (${previsao.total} mm). Alto risco de inundação.`
                      : Number(previsao.total) > 80
                        ? `⚡ Chuva moderada a forte (${previsao.total} mm). Monitorar áreas de risco.`
                        : `✔️ Precipitação normal (${previsao.total} mm). Baixo risco de inundação.`}
                  </div>
                )}
              </div>
            )}

            {resultado && (
              <div className={styles.secao}>
                <button className={styles.btnAux} onClick={animando ? pararTudo : iniciarLoop}>
                  {animando ? <><FiX size={13} /> Parar animação</> : <><FiZap size={13} /> Retomar</>}
                </button>
                <button className={styles.btnAux} onClick={exportarRelatorio}>
                  <FiDownload size={13} /> Exportar relatório
                </button>
              </div>
            )}

            {erro && <div className={styles.erro}>{erro}</div>}

            {/* Legenda */}
            <div className={styles.secao}>
              <p className={styles.secTitulo}>Legenda — Zonas de inundação</p>
              {[
                { cor: '#bfdbfe', label: 'Baixo risco'       },
                { cor: '#3b82f6', label: 'Risco médio'       },
                { cor: '#1d4ed8', label: 'Risco alto'        },
                { cor: '#7c3aed', label: 'Risco crítico'     },
              ].map(l => (
                <div key={l.cor} className={styles.legItem}>
                  <span className={styles.legCor} style={{ background: l.cor }} />
                  <span className={styles.legTexto}>{l.label}</span>
                </div>
              ))}
              <div className={styles.legItem}>
                <span className={styles.legCor} style={{ background: '#7c3aed', borderRadius: '50%', border: '2px solid #4c1d95' }} />
                <span className={styles.legTexto}>⚪ Depressão (ponto de alagamento)</span>
              </div>
              <div className={styles.legFluxo} style={{ marginTop: 6 }}>
                <span style={{ color:'#00e5ff' }}>━━</span> Escoamento na rua (declividade real)&nbsp;&nbsp;
                <span style={{ color:'#38bdf8' }}>●</span> Escoamento no terreno (D8)
              </div>
              <p className={styles.dica}>Fluxo nas ruas segue a declividade real do terreno</p>
            </div>

          </div>

          {/* ─── Mapa + Canvas ─── */}
          <div className={styles.direitaWrap}>
            <div className={styles.mapaWrap}>
              <div ref={mapRef} className={styles.mapa} />
              <canvas ref={canvasRef} className={styles.canvasOverlay} />

              {(simulando || buscando) && (
                <div className={styles.overlay}>
                  <div className={styles.spinner} />
                  <p>
                    {workerAtivo
                      ? 'Calculando D8 + acumulação de fluxo...'
                      : simulando
                        ? 'Buscando dados de elevação (SRTM)...'
                        : 'Buscando previsão meteorológica...'}
                  </p>
                </div>
              )}
            </div>

            {resultado && (
              <div className={styles.barraResultado}>

                <button
                  className={`${styles.card} ${filtroAtivo === 'media' ? styles.cardAtivo : ''}`}
                  onClick={() => irParaFiltro('media')}
                  title="Clique para ver locais com acúmulo médio no mapa"
                >
                  <span className={styles.cardVal} style={{ color:'#2563eb' }}>{resultado.mediaAcum} mm</span>
                  <span className={styles.cardLabel}>Acúmulo médio</span>
                  <span className={styles.cardDica}>{filtroAtivo === 'media' ? '✕ fechar' : '📍 ver no mapa'}</span>
                </button>

                <button
                  className={`${styles.card} ${filtroAtivo === 'max' ? styles.cardAtivo : ''}`}
                  onClick={() => irParaFiltro('max')}
                  title="Clique para ver o local de acúmulo máximo no mapa"
                >
                  <span className={styles.cardVal} style={{ color:'#7c3aed' }}>{resultado.maxAcum} mm</span>
                  <span className={styles.cardLabel}>Máximo</span>
                  <span className={styles.cardDica}>{filtroAtivo === 'max' ? '✕ fechar' : '📍 ver no mapa'}</span>
                </button>

                <button
                  className={`${styles.card} ${filtroAtivo === 'altos' ? styles.cardAtivo : ''}`}
                  onClick={() => irParaFiltro('altos')}
                  title="Clique para ver as zonas de alto risco no mapa"
                  disabled={resultado.muitoAltos === 0}
                >
                  <span className={styles.cardVal} style={{ color: resultado.muitoAltos > 0 ? '#f97316' : '#22c55e' }}>
                    {resultado.muitoAltos}
                  </span>
                  <span className={styles.cardLabel}>Zonas altas</span>
                  <span className={styles.cardDica}>{filtroAtivo === 'altos' ? '✕ fechar' : resultado.muitoAltos > 0 ? '📍 ver no mapa' : '—'}</span>
                </button>

                <button
                  className={`${styles.card} ${filtroAtivo === 'criticos' ? styles.cardAtivo : ''}`}
                  onClick={() => irParaFiltro('criticos')}
                  title="Clique para ver as zonas críticas no mapa"
                  disabled={resultado.criticos === 0}
                >
                  <span className={styles.cardVal} style={{ color: resultado.criticos > 0 ? '#dc2626' : '#22c55e' }}>
                    {resultado.criticos}
                  </span>
                  <span className={styles.cardLabel}>Críticos</span>
                  <span className={styles.cardDica}>{filtroAtivo === 'criticos' ? '✕ fechar' : resultado.criticos > 0 ? '📍 ver no mapa' : '—'}</span>
                </button>

                <button
                  className={`${styles.card} ${filtroAtivo === 'depressoes' ? styles.cardAtivo : ''}`}
                  onClick={() => irParaFiltro('depressoes')}
                  title="Clique para ver as depressões e pontos de alagamento no mapa"
                  disabled={resultado.depressoes === 0}
                >
                  <span className={styles.cardVal} style={{ color: resultado.depressoes > 0 ? '#7c3aed' : '#22c55e' }}>
                    <FiAlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                    {resultado.depressoes}
                  </span>
                  <span className={styles.cardLabel}>Depressões</span>
                  <span className={styles.cardDica}>{filtroAtivo === 'depressoes' ? '✕ fechar' : resultado.depressoes > 0 ? '📍 ver no mapa' : '—'}</span>
                </button>

              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
