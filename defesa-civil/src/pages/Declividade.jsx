import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as turf from '@turf/turf'
import Chart from 'chart.js/auto'
import { CIDADES, CIDADE_PADRAO } from '../data/cidades'
import Sidebar from '../components/Sidebar'
import styles from './Declividade.module.css'
import { FiTrendingUp, FiTrash2, FiActivity, FiZap, FiEye, FiEyeOff, FiMaximize2, FiBox, FiEdit3 } from 'react-icons/fi'
import TerrainProfile3D from '../components/TerrainProfile3D'

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

function getNBRClass(slopePct) {
  if (slopePct < 30)  return { nivel: 'R1', risco: 'Baixo',      desc: 'Terreno estável — sem restrições imediatas',              acao: 'Monitoramento preventivo periódico',                             fs: '≥ 1,5',  cor: '#22c55e' }
  if (slopePct < 60)  return { nivel: 'R2', risco: 'Médio',      desc: 'Instabilidade potencial em períodos chuvosos',             acao: 'Investigação geotécnica + plano de contingência',               fs: '1,3 – 1,5', cor: '#eab308' }
  if (slopePct < 100) return { nivel: 'R3', risco: 'Alto',       desc: 'Risco elevado — possibilidade de escorregamentos',         acao: 'Obras de contenção urgentes + evacuação preventiva',            fs: '1,0 – 1,3', cor: '#f97316' }
  return               { nivel: 'R4', risco: 'Muito Alto', desc: 'Risco geológico severo — área crítica de desastre natural',   acao: 'Interdição + remoção imediata das famílias',                    fs: '< 1,0',  cor: '#ef4444' }
}

function detectContourInterval(elevations) {
  const range = Math.max(...elevations) - Math.min(...elevations)
  if (range < 200) return 10
  return 20
}

// ── Perfil Longitudinal SVG ───────────────────────────────────
function PerfilLongitudinal({ perfil, cotaA, cotaB, distHorizM, cor, segmentos10m }) {
  if (!perfil || perfil.length < 2) return null

  // ── dimensões do gráfico de perfil ──────────────────────────
  const W = 278, Hp = 200
  const padL = 40, padR = 10, padT = 16, padB = 28
  const plotW = W - padL - padR
  const plotH = Hp - padT - padB

  const rawMin = Math.min(...perfil.map(p => p.elev))
  const rawMax = Math.max(...perfil.map(p => p.elev))
  const minElev = rawMin - 1, maxElev = rawMax + 1
  const elevRange = Math.max(maxElev - minElev, 1)
  const maxDist   = perfil[perfil.length - 1].dist || 1

  const toX = d => padL + (d / maxDist) * plotW
  const toY = e => padT + plotH - ((e - minElev) / elevRange) * plotH

  const pts   = perfil.map(p => `${toX(p.dist).toFixed(1)},${toY(p.elev).toFixed(1)}`).join(' L ')
  const pathD = `M ${pts}`
  const areaD = `${pathD} L ${toX(maxDist).toFixed(1)},${(padT + plotH).toFixed(1)} L ${toX(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`

  const yLabelStep = elevRange <= 25 ? 5 : elevRange <= 60 ? 10 : elevRange <= 150 ? 20 : 50
  const yTicks = []; for (let e = Math.ceil(minElev); e <= Math.floor(maxElev); e++) yTicks.push(e)
  const xLabelStep = maxDist <= 50 ? 5 : maxDist <= 150 ? 10 : maxDist <= 300 ? 25 : maxDist <= 600 ? 50 : maxDist <= 1500 ? 100 : 200
  const xTicks = []; for (let d = 0; d <= maxDist; d++) xTicks.push(d)

  const yA = toY(cotaA), xA = toX(0)
  const yB = toY(cotaB), xB = toX(maxDist)
  const peakPt   = perfil.reduce((a, b) => b.elev > a.elev ? b : a)
  const valleyPt = perfil.reduce((a, b) => b.elev < a.elev ? b : a)
  const showPeak   = peakPt.dist > 5  && peakPt.dist < maxDist - 5
  const showValley = valleyPt.dist > 5 && valleyPt.dist < maxDist - 5 && valleyPt.elev < peakPt.elev

  // ── segmentos 10m críticos para destacar no perfil ───────────
  const criticos10 = segmentos10m?.filter(s => s.slope >= 20) || []
  // índice do pior segmento
  const worstIdx = segmentos10m
    ? segmentos10m.reduce((bi, s, i) => s.slope > segmentos10m[bi].slope ? i : bi, 0)
    : -1

  // ── gráfico de barras de declividade (abaixo do perfil) ──────
  const BH = 56    // altura do gráfico de barras
  const BpadT = 6, BpadB = 14
  const bPlotH = BH - BpadT - BpadB
  const maxSlope = segmentos10m ? Math.max(...segmentos10m.map(s => s.slope), 20) : 100
  const toBarH = s => BpadT + bPlotH - (s / maxSlope) * bPlotH
  const barW   = segmentos10m?.length > 0 ? plotW / segmentos10m.length : 4

  const totalH = Hp + (segmentos10m?.length > 0 ? BH + 6 : 0)

  return (
    <svg viewBox={`0 0 ${W} ${totalH}`} style={{ width: '100%', height: totalH, display: 'block' }}>

      {/* ── Fundo de zonas críticas no perfil ─────────────────── */}
      {criticos10.map((s, i) => (
        <rect key={`crit${i}`}
          x={toX(s.d0)} y={padT}
          width={Math.max(toX(s.d1) - toX(s.d0), 2)}
          height={plotH}
          fill={s.classif.cor + '28'}
        />
      ))}

      {/* Grade horizontal */}
      {yTicks.map(e => {
        const isMajor = e % yLabelStep === 0
        return <line key={`yg${e}`} x1={padL} y1={toY(e)} x2={padL + plotW} y2={toY(e)}
          stroke={isMajor ? '#243450' : '#1a2540'} strokeWidth={isMajor ? 0.8 : 0.4} strokeDasharray={isMajor ? '4,3' : '2,4'} />
      })}
      {/* Grade vertical */}
      {xTicks.map(d => {
        const isMajor = d % xLabelStep === 0
        return <line key={`xg${d}`} x1={toX(d)} y1={padT} x2={toX(d)} y2={padT + plotH}
          stroke={isMajor ? '#243450' : '#1a2540'} strokeWidth={isMajor ? 0.8 : 0.3} strokeDasharray={isMajor ? '4,3' : '1,5'} />
      })}

      {/* Área preenchida e linha do perfil */}
      <path d={areaD} fill={cor + '1a'} />
      <path d={pathD} fill="none" stroke={cor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      {/* Pontos do perfil (apenas se não for muito denso) */}
      {perfil.length <= 200 && perfil.map((p, i) =>
        <circle key={i} cx={toX(p.dist)} cy={toY(p.elev)} r="1.1" fill={cor} opacity="0.6" />
      )}

      {/* Eixo Y */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#475569" strokeWidth="1.2" />
      {yTicks.filter(e => e % yLabelStep === 0).map(e => (
        <g key={`yl${e}`}>
          <line x1={padL - 4} y1={toY(e)} x2={padL} y2={toY(e)} stroke="#64748b" strokeWidth="1" />
          <text x={padL - 6} y={toY(e) + 3.5} fontSize="8" fill="#94a3b8" textAnchor="end" fontFamily="monospace">{e}</text>
        </g>
      ))}
      <text x={10} y={padT + plotH / 2} fontSize="7.5" fill="#64748b" textAnchor="middle"
        transform={`rotate(-90,10,${padT + plotH / 2})`}>Cota (m)</text>

      {/* Eixo X */}
      <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#475569" strokeWidth="1.2" />
      {xTicks.filter(d => d % xLabelStep === 0).map(d => (
        <g key={`xl${d}`}>
          <line x1={toX(d)} y1={padT + plotH} x2={toX(d)} y2={padT + plotH + 4} stroke="#64748b" strokeWidth="1" />
          <text x={toX(d)} y={padT + plotH + 13} fontSize="7.5" fill="#94a3b8" textAnchor="middle" fontFamily="monospace">
            {d >= 1000 ? `${(d/1000).toFixed(1)}k` : `${d}m`}
          </text>
        </g>
      ))}
      <text x={padL + plotW / 2} y={Hp - 3} fontSize="7.5" fill="#64748b" textAnchor="middle">Distância (m)</text>

      {/* Ponto A */}
      <circle cx={xA} cy={yA} r="5" fill="#a78bfa" stroke="#0f172a" strokeWidth="2" />
      <text x={xA + 7} y={yA - 6} fontSize="9.5" fill="#a78bfa" fontWeight="bold">A</text>
      <text x={xA + 7} y={yA + 5} fontSize="8" fill="#a78bfa" fontFamily="monospace">{cotaA} m</text>

      {/* Ponto B */}
      <circle cx={xB} cy={yB} r="5" fill="#f0abfc" stroke="#0f172a" strokeWidth="2" />
      <text x={xB - 8} y={yB - 6} fontSize="9.5" fill="#f0abfc" fontWeight="bold" textAnchor="end">B</text>
      <text x={xB - 8} y={yB + 5} fontSize="8" fill="#f0abfc" fontFamily="monospace" textAnchor="end">{cotaB} m</text>

      {/* Pico */}
      {showPeak && (
        <g>
          <circle cx={toX(peakPt.dist)} cy={toY(peakPt.elev)} r="3.5" fill="#fbbf24" stroke="#0f172a" strokeWidth="1.5" />
          <text x={toX(peakPt.dist)} y={toY(peakPt.elev) - 7} fontSize="7.5" fill="#fbbf24" textAnchor="middle" fontFamily="monospace">{peakPt.elev}m</text>
        </g>
      )}
      {/* Vale */}
      {showValley && (
        <g>
          <circle cx={toX(valleyPt.dist)} cy={toY(valleyPt.elev)} r="3.5" fill="#38bdf8" stroke="#0f172a" strokeWidth="1.5" />
          <text x={toX(valleyPt.dist)} y={toY(valleyPt.elev) + 14} fontSize="7.5" fill="#38bdf8" textAnchor="middle" fontFamily="monospace">{valleyPt.elev}m</text>
        </g>
      )}

      {/* ── Gráfico de barras de declividade por 10m ─────────── */}
      {segmentos10m?.length > 0 && (() => {
        const BY = Hp + 6
        return (
          <>
            {/* Título */}
            <text x={padL} y={BY + 4} fontSize="7" fill="#64748b" fontWeight="600">Declividade por trecho 10m</text>
            <text x={padL + plotW} y={BY + 4} fontSize="7" fill="#475569" textAnchor="end">máx: {maxSlope.toFixed(0)}%</text>

            {/* Fundo */}
            <rect x={padL} y={BY + BpadT} width={plotW} height={bPlotH} fill="#0f172a" rx="2" />

            {/* Linha de referência 20% */}
            {maxSlope > 20 && (() => {
              const refY = BY + toBarH(20)
              return <>
                <line x1={padL} y1={refY} x2={padL + plotW} y2={refY} stroke="#334155" strokeWidth="0.7" strokeDasharray="3,2" />
                <text x={padL + plotW + 2} y={refY + 3} fontSize="6.5" fill="#475569">20%</text>
              </>
            })()}

            {/* Barras */}
            {segmentos10m.map((s, i) => {
              const bx   = toX(s.d0)
              const bw   = Math.max(toX(s.d1) - toX(s.d0) - 0.5, 1)
              const by   = BY + toBarH(s.slope)
              const bh   = bPlotH - (toBarH(s.slope) - BpadT)
              const isW  = i === worstIdx
              return (
                <g key={`bar${i}`}>
                  <rect x={bx} y={by} width={bw} height={Math.max(bh, 1)}
                    fill={s.classif.cor} opacity={isW ? 1 : 0.75}
                    stroke={isW ? '#fff' : 'none'} strokeWidth={isW ? 0.5 : 0}
                  />
                  {/* Label do pior */}
                  {isW && (
                    <>
                      <line x1={bx + bw/2} y1={by - 2} x2={bx + bw/2} y2={BY + BpadT + 2}
                        stroke="#fff" strokeWidth="0.7" strokeDasharray="2,1" />
                      <text x={bx + bw/2} y={BY + BpadT - 1} fontSize="7" fill="#fff" textAnchor="middle" fontWeight="bold">
                        {s.slope.toFixed(0)}%
                      </text>
                    </>
                  )}
                </g>
              )
            })}

            {/* Eixo X das barras */}
            <line x1={padL} y1={BY + BpadT + bPlotH} x2={padL + plotW} y2={BY + BpadT + bPlotH} stroke="#334155" strokeWidth="0.8" />
            <text x={padL + plotW / 2} y={BY + BH - 2} fontSize="6.5" fill="#475569" textAnchor="middle">
              {segmentos10m.length} segmentos de 10m
            </text>
          </>
        )
      })()}
    </svg>
  )
}

// ── Triângulo de declividade SVG ─────────────────────────────
function TrianguloSlope({ interval, distHoriz, slopePct, slopeGrau, cor }) {
  const H_px = Math.min(Math.max((slopePct / 100) * 90, 14), 62)
  const BLx = 15, BLy = 82, BRx = 155, BRy = 82, TRx = 155, TRy = 82 - H_px
  const midHypX = (BLx + TRx) / 2, midHypY = (BLy + TRy) / 2
  const arcR = 18
  const angleRad = Math.atan2(H_px, BRx - BLx)
  const arcEndX = BLx + arcR * Math.cos(-angleRad)
  const arcEndY = BLy + arcR * Math.sin(-angleRad)
  return (
    <svg viewBox="0 0 210 100" style={{ width: '100%', maxHeight: 95 }}>
      <polygon points={`${BLx},${BLy} ${BRx},${BRy} ${TRx},${TRy}`} fill={cor + '18'} />
      <line x1={BLx} y1={BLy} x2={TRx} y2={TRy} stroke={cor} strokeWidth="2" strokeDasharray="6,3" />
      <line x1={BLx} y1={BLy} x2={BRx} y2={BRy} stroke="#334155" strokeWidth="1.5" />
      <line x1={TRx} y1={TRy} x2={BRx} y2={BRy} stroke={cor} strokeWidth="2.5" />
      <path d={`M ${BLx + arcR},${BLy} A ${arcR},${arcR} 0 0,0 ${arcEndX},${arcEndY}`} fill="none" stroke={cor} strokeWidth="1.3" />
      <text x={arcEndX + 3} y={BLy - 5} fontSize="9" fill={cor}>{slopeGrau.toFixed(1)}°</text>
      <text x={TRx + 5} y={(TRy + BRy) / 2 + 4} fontSize="10" fontWeight="bold" fill={cor}>H={interval}m</text>
      <text x={(BLx + BRx) / 2} y={BRy + 13} fontSize="9" fill="#64748b" textAnchor="middle">{distHoriz >= 1000 ? (distHoriz/1000).toFixed(2)+'km' : distHoriz+'m'}</text>
      <text x={midHypX - 6} y={midHypY - 3} fontSize="10" fontWeight="bold" fill={cor} textAnchor="middle">{slopePct.toFixed(1)}%</text>
    </svg>
  )
}

// ── Elevação API (OpenTopoData SRTM 30m → fallback Open-Meteo) ─
async function fetchElevations(points) {
  const locations = points.map(p => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join('|')
  try {
    const res = await fetch(
      `https://api.opentopodata.org/v1/srtm30m?locations=${locations}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (res.ok) {
      const data = await res.json()
      if (data.results?.length === points.length) return data.results.map(r => r.elevation ?? 0)
    }
  } catch (_) {}
  const lats = points.map(p => p[1].toFixed(6)).join(',')
  const lngs = points.map(p => p[0].toFixed(6)).join(',')
  const res2 = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`)
  if (!res2.ok) throw new Error(`API de elevação retornou ${res2.status}`)
  const data2 = await res2.json()
  if (!data2.elevation) throw new Error('Resposta inválida da API de elevação')
  return data2.elevation
}

// ── Batch paralelo (lotes de 100 simultâneos) ────────────────
async function fetchElevationsBatched(points) {
  const batches = []
  for (let i = 0; i < points.length; i += 100) batches.push(points.slice(i, i + 100))
  const results = await Promise.all(batches.map(fetchElevations))
  return results.flat()
}

// ── Calcula segmentos de declividade a cada stepM metros ──────
function calcSegmentos(elevations, sampleDists, stepM) {
  const maxDist = sampleDists[sampleDists.length - 1]
  const segs = []
  for (let d = 0; d + stepM <= maxDist + 0.5; d += stepM) {
    const d0  = d, d1 = Math.min(d + stepM, maxDist)
    // Índice do ponto mais próximo de d0 e d1
    const i0  = sampleDists.reduce((best, v, i) => Math.abs(v - d0) < Math.abs(sampleDists[best] - d0) ? i : best, 0)
    const i1  = sampleDists.reduce((best, v, i) => Math.abs(v - d1) < Math.abs(sampleDists[best] - d1) ? i : best, 0)
    const dh  = Math.abs(elevations[i1] - elevations[i0])
    const hdist = Math.max(sampleDists[i1] - sampleDists[i0], 0.1)
    const slope = (dh / hdist) * 100
    segs.push({
      d0: Math.round(d0), d1: Math.round(d1),
      midDist: (d0 + d1) / 2,
      elev0: Math.round(elevations[i0]), elev1: Math.round(elevations[i1]),
      dh: Math.round(dh * 10) / 10,
      slope: Math.round(slope * 10) / 10,
      classif: classifySlope(slope),
    })
  }
  return segs
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

function pointAlongLine(turfLine, distM) {
  const km = distM / 1000
  const len = turf.length(turfLine, { units: 'kilometers' })
  const safeDist = Math.min(Math.max(km, 0), len)
  return turf.along(turfLine, safeDist, { units: 'kilometers' }).geometry.coordinates
}

// ─────────────────────────────────────────────────────────────
export default function Declividade() {
  const mapRef           = useRef(null)
  const leafletRef       = useRef(null)
  const tileLayerRef     = useRef(null)
  const drawLayerRef     = useRef(null)
  const resultsLayerRef  = useRef(null)
  const chartRef         = useRef(null)
  const chartInstanceRef = useRef(null)
  const drawnPolygonsRef = useRef([])

  // Medir state
  const modoMedirRef  = useRef(false)
  const medirStateRef = useRef({ pt1: null, pt1Marker: null, linhaMedir: null, pt2Marker: null, previewLine: null })

  // Polygon drawing state
  const polyDrawRef     = useRef({ ativo: false, vertices: [], markers: [], line: null, preview: null, closeLine: null, filledPoly: null, firstMarker: null })
  const modoPoligonoRef = useRef(false)

  const [cidade,          setCidade]          = useState(CIDADE_PADRAO)
  const [camada,          setCamada]          = useState('topo')
  const [modoMedir,       setModoMedir]       = useState(false)
  const [modoPoligono,    setModoPoligono]    = useState(false)  // drawing polygon
  const [poligono,        setPoligono]        = useState(null)   // closed polygon vertices
  const [carregando,      setCarregando]      = useState(false)
  const [carregandoAuto,  setCarregandoAuto]  = useState(false)
  const [carregandoMedir, setCarregandoMedir] = useState(false)
  const [modoAtivo,       setModoAtivo]       = useState(null)   // 'poligono' | 'auto' | 'medir'
  const [resultado,       setResultado]       = useState(null)
  const [autoResultado,   setAutoResultado]   = useState(null)
  const [medicaoResult,   setMedicaoResult]   = useState(null)
  const [classesVisiveis, setClassesVisiveis] = useState(() => new Set(SLOPE_CLASSES.map(c => c.label)))
  const [show3D,          setShow3D]          = useState(false)

  useEffect(() => { modoMedirRef.current  = modoMedir },  [modoMedir])
  useEffect(() => { modoPoligonoRef.current = modoPoligono }, [modoPoligono])

  // Abre 3D automaticamente após análise do polígono
  useEffect(() => {
    if (resultado && !resultado.erro && modoAtivo === 'poligono') {
      setShow3D(true)
    }
  }, [resultado])

  // ── Toggle visibilidade por classe ───────────────────────────
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

  // ── Init mapa ────────────────────────────────────────────────
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
    tileLayerRef.current   = L.tileLayer(LAYERS[0].url, { attribution: LAYERS[0].attribution, maxZoom: LAYERS[0].maxZoom }).addTo(map)
    drawLayerRef.current   = L.layerGroup().addTo(map)
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
    if (!mapRef.current || !leafletRef.current) return
    const map = leafletRef.current
    if (modoPoligono || modoMedir) {
      map.dragging.disable()
      map.boxZoom.disable()
      mapRef.current.style.cursor = 'crosshair'
    } else {
      map.dragging.enable()
      map.boxZoom.enable()
      mapRef.current.style.cursor = ''
    }
  }, [modoPoligono, modoMedir])

  // ── Eventos de mapa ──────────────────────────────────────────
  function handleClick(e) {
    // Modo medir
    if (modoMedirRef.current) {
      const ms = medirStateRef.current
      if (!ms.pt1) {
        ms.pt1 = e.latlng
        ms.pt1Marker = L.circleMarker(e.latlng, { radius: 7, color: '#a78bfa', fillColor: '#a78bfa', fillOpacity: 1, weight: 2 }).bindTooltip('Ponto A').addTo(drawLayerRef.current)
      } else {
        const pt2 = e.latlng
        if (ms.previewLine) { drawLayerRef.current.removeLayer(ms.previewLine); ms.previewLine = null }
        ms.linhaMedir = L.polyline([ms.pt1, pt2], { color: '#a78bfa', weight: 3, opacity: 0.95, dashArray: '8,4' }).addTo(drawLayerRef.current)
        ms.pt2Marker  = L.circleMarker(pt2, { radius: 7, color: '#a78bfa', fillColor: '#f0abfc', fillOpacity: 1, weight: 2 }).bindTooltip('Ponto B').addTo(drawLayerRef.current)
        setModoMedir(false)
        calcularDeclividade(ms.pt1, pt2)
      }
      return
    }

    // Modo polígono
    if (modoPoligonoRef.current) {
      addPolyVertex(e.latlng)
      return
    }
  }

  function handleDblClick(e) {
    if (modoMedirRef.current) return
    if (modoPoligonoRef.current) {
      L.DomEvent.stop(e)
      finalizarPoligono()
      return
    }
  }

  function handleMouseMove(e) {
    // Preview modo medir
    if (modoMedirRef.current) {
      const ms = medirStateRef.current
      if (!ms.pt1) return
      if (!ms.previewLine) {
        ms.previewLine = L.polyline([], { color: '#a78bfa', weight: 1.5, dashArray: '4,4', opacity: 0.6 }).addTo(drawLayerRef.current)
      }
      ms.previewLine.setLatLngs([ms.pt1, e.latlng])
      return
    }

    // Preview modo polígono
    if (modoPoligonoRef.current) {
      const pd = polyDrawRef.current
      if (pd.vertices.length === 0) return
      const last = pd.vertices[pd.vertices.length - 1]
      if (!pd.preview) {
        pd.preview = L.polyline([], { color: '#a78bfa', weight: 1.5, dashArray: '5,5', opacity: 0.7 }).addTo(drawLayerRef.current)
      }
      pd.preview.setLatLngs([last, e.latlng])

      // Linha de fechamento (do cursor de volta ao 1º vértice)
      if (pd.vertices.length >= 2) {
        const first = pd.vertices[0]
        if (!pd.closeLine) {
          pd.closeLine = L.polyline([], { color: '#a78bfa', weight: 1, dashArray: '3,6', opacity: 0.4 }).addTo(drawLayerRef.current)
        }
        pd.closeLine.setLatLngs([e.latlng, first])
      }
      return
    }
  }

  // ── Polígono: adicionar vértice ──────────────────────────────
  function addPolyVertex(latlng) {
    const pd = polyDrawRef.current
    pd.vertices.push(latlng)

    const isFirst = pd.vertices.length === 1
    const cor = '#a78bfa'
    const m = L.circleMarker(latlng, {
      radius: isFirst ? 9 : 5,
      color: isFirst ? '#22c55e' : cor,
      fillColor: isFirst ? '#22c55e' : cor,
      fillOpacity: 1, weight: 2.5,
    }).bindTooltip(isFirst ? 'Clique aqui para fechar o polígono' : `Vértice ${pd.vertices.length}`)
      .addTo(drawLayerRef.current)

    if (isFirst) {
      pd.firstMarker = m
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        if (polyDrawRef.current.vertices.length >= 3) {
          finalizarPoligono()
        }
      })
    }

    pd.markers.push(m)

    // Atualiza polyline de contorno
    if (pd.line) drawLayerRef.current.removeLayer(pd.line)
    if (pd.vertices.length >= 2) {
      pd.line = L.polyline(pd.vertices, { color: cor, weight: 2.5, opacity: 0.9 }).addTo(drawLayerRef.current)
    }
  }

  // ── Polígono: finalizar (fechar e analisar) ──────────────────
  function finalizarPoligono() {
    const pd = polyDrawRef.current
    if (pd.vertices.length < 3) {
      alert('Desenhe pelo menos 3 vértices para criar o polígono.')
      return
    }
    const vertices = [...pd.vertices]

    // Desenha polígono fechado no mapa
    if (pd.filledPoly) drawLayerRef.current.removeLayer(pd.filledPoly)
    pd.filledPoly = L.polygon(vertices.map(v => [v.lat, v.lng]), {
      color: '#a78bfa', fillColor: '#a78bfa', fillOpacity: 0.15, weight: 2.5, opacity: 0.85, dashArray: '8,4'
    }).bindTooltip('Polígono desenhado — aguarde análise…').addTo(drawLayerRef.current)

    // Para o modo de desenho
    setModoPoligono(false)
    polyDrawRef.current.ativo = false
    setPoligono(vertices)
    analisarPoligono(vertices)
  }

  // ── Limpar preview de polígono ───────────────────────────────
  function limparPoligonoPreview() {
    const pd = polyDrawRef.current
    pd.markers.forEach(m => drawLayerRef.current?.removeLayer(m))
    if (pd.line)      drawLayerRef.current?.removeLayer(pd.line)
    if (pd.preview)   drawLayerRef.current?.removeLayer(pd.preview)
    if (pd.closeLine) drawLayerRef.current?.removeLayer(pd.closeLine)
    if (pd.filledPoly) drawLayerRef.current?.removeLayer(pd.filledPoly)
    polyDrawRef.current = { ativo: false, vertices: [], markers: [], line: null, preview: null, closeLine: null, filledPoly: null, firstMarker: null }
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
    limparPoligonoPreview()
    limparMedicao()
    resultsLayerRef.current?.clearLayers()
    drawnPolygonsRef.current = []
    setPoligono(null)
    setModoPoligono(false)
    setModoAtivo(null)
    setResultado(null)
    setAutoResultado(null)
    if (chartInstanceRef.current) { chartInstanceRef.current.destroy(); chartInstanceRef.current = null }
    setClassesVisiveis(new Set(SLOPE_CLASSES.map(c => c.label)))
  }

  // ── Análise do polígono ──────────────────────────────────────
  async function analisarPoligono(vertices) {
    setCarregando(true)
    resultsLayerRef.current?.clearLayers()
    drawnPolygonsRef.current = []
    setResultado(null)

    try {
      // 1. Turf polygon
      const ring = [...vertices.map(v => [v.lng, v.lat]), [vertices[0].lng, vertices[0].lat]]
      const turfPoly = turf.polygon([ring])
      const bbox = turf.bbox(turfPoly) // [minLng, minLat, maxLng, maxLat]

      // 2. Bbox dimensions (metros)
      const bboxW = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'kilometers' }) * 1000
      const bboxH = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'kilometers' }) * 1000

      // 3. Grade proporcional ao bbox (máx 10×10 = 100 pts, 1 chamada à API)
      const ratio  = bboxW / Math.max(bboxH, 1)
      const GCOLS  = Math.max(4, Math.min(10, Math.round(10 * Math.sqrt(ratio))))
      const GROWS  = Math.max(4, Math.min(10, Math.round(10 / Math.sqrt(ratio))))

      // 4. Gera grade completa sobre o bbox
      const gridPts = []
      for (let row = 0; row < GROWS; row++) {
        for (let col = 0; col < GCOLS; col++) {
          const lng = bbox[0] + (GCOLS > 1 ? col / (GCOLS - 1) : 0.5) * (bbox[2] - bbox[0])
          const lat = bbox[1] + (GROWS > 1 ? row / (GROWS - 1) : 0.5) * (bbox[3] - bbox[1])
          gridPts.push({ lng, lat, row, col })
        }
      }

      // 5. Busca elevações da grade (em lotes de 100)
      const gridCoords = gridPts.map(p => [p.lng, p.lat])
      const gridElevs  = await fetchElevationsBatched(gridCoords)
      gridPts.forEach((p, i) => {
        p.elev   = Math.round(gridElevs[i] ?? 0)
        p.inside = turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), turfPoly)
      })

      const insidePts   = gridPts.filter(p => p.inside)
      const elevSample  = insidePts.length > 2 ? insidePts.map(p => p.elev) : gridPts.map(p => p.elev)
      const minElev     = Math.min(...elevSample)
      const maxElev     = Math.max(...elevSample)
      const interval    = detectContourInterval(elevSample)

      // 6. Amostra arestas do polígono para cruzamentos de curvas de nível
      const lateralDists  = []
      const allCrossings  = []
      const edgeSamplePts = []
      const edgeMeta      = []

      for (let i = 0; i < vertices.length; i++) {
        const v1 = vertices[i]
        const v2 = vertices[(i + 1) % vertices.length]
        const edgeLine = turf.lineString([[v1.lng, v1.lat], [v2.lng, v2.lat]])
        const lenM     = turf.length(edgeLine, { units: 'kilometers' }) * 1000
        lateralDists.push({ from: i + 1, to: (i + 1) % vertices.length + 1, dist: Math.round(lenM) })

        const nSamples = Math.max(2, Math.min(50, Math.round(lenM / 1)))
        const pts = [], dists = []
        for (let j = 0; j < nSamples; j++) {
          const d = (j / (nSamples - 1)) * lenM
          pts.push(pointAlongLine(edgeLine, d))
          dists.push(d)
        }
        edgeMeta.push({ idx: i, lenM, dists, nSamples })
        edgeSamplePts.push(...pts)
      }

      // 7. Busca elevações das arestas em lotes
      const edgeElevsAll = await fetchElevationsBatched(edgeSamplePts)

      // 8. Cruzamentos por aresta
      let offset = 0
      edgeMeta.forEach(({ idx, lenM, dists, nSamples }) => {
        const v1 = vertices[idx], v2 = vertices[(idx + 1) % vertices.length]
        const edgeLine = turf.lineString([[v1.lng, v1.lat], [v2.lng, v2.lat]])
        const elevs    = edgeElevsAll.slice(offset, offset + nSamples)
        offset        += nSamples
        const crossings = findContourCrossings(elevs, dists, interval)
        crossings.forEach(c => {
          const coord = pointAlongLine(edgeLine, c.dist)
          allCrossings.push({ elevation: c.elevation, dist: Math.round(c.dist), edgeLen: Math.round(lenM), edge: idx + 1, coord })
          L.circleMarker([coord[1], coord[0]], {
            radius: 4, color: '#fff', fillColor: '#a78bfa', fillOpacity: 1, weight: 1.5,
          }).bindTooltip(`⛰ ${c.elevation} m — ${Math.round(c.dist)} m ao longo da aresta ${idx + 1}`, { sticky: true })
            .addTo(resultsLayerRef.current)
        })
      })
      allCrossings.sort((a, b) => a.elevation - b.elevation)

      // 9. Colore células da grade por declividade
      const classCounts = Object.fromEntries(SLOPE_CLASSES.map(c => [c.label, 0]))
      const segmentos   = []
      let drawnCount    = 0

      for (let row = 0; row < GROWS - 1; row++) {
        for (let col = 0; col < GCOLS - 1; col++) {
          const p00 = gridPts[row * GCOLS + col]
          const p10 = gridPts[row * GCOLS + (col + 1)]
          const p01 = gridPts[(row + 1) * GCOLS + col]
          const p11 = gridPts[(row + 1) * GCOLS + (col + 1)]

          const insideCount = [p00, p10, p01, p11].filter(p => p.inside).length
          if (insideCount < 2) continue

          const dElev = Math.max(
            Math.abs(p10.elev - p00.elev), Math.abs(p01.elev - p00.elev),
            Math.abs(p11.elev - p10.elev), Math.abs(p11.elev - p01.elev),
          )
          const cellW  = turf.distance([p00.lng, p00.lat], [p10.lng, p10.lat], { units: 'kilometers' }) * 1000
          const cellH  = turf.distance([p00.lng, p00.lat], [p01.lng, p01.lat], { units: 'kilometers' }) * 1000
          const diag   = Math.max(Math.sqrt(cellW ** 2 + cellH ** 2), 1)
          const slopePct = (dElev / diag) * 100
          const classif  = classifySlope(slopePct)
          classCounts[classif.label] = (classCounts[classif.label] || 0) + 1
          drawnCount++
          segmentos.push({ slopePct, slopeGrau: Math.atan(dElev / diag) * (180 / Math.PI), classif })

          const layer = L.polygon(
            [[p00.lat, p00.lng], [p10.lat, p10.lng], [p11.lat, p11.lng], [p01.lat, p01.lng]],
            { color: classif.cor, fillColor: classif.cor, fillOpacity: 0.52, weight: 0.5, opacity: 0.15 }
          ).bindTooltip(`${classif.label} · ${slopePct.toFixed(1)}%`, { sticky: true })
          layer.addTo(resultsLayerRef.current)
          drawnPolygonsRef.current.push({ layer, classLabel: classif.label })
        }
      }

      // 10. Curvas de nível (isolines Turf) sobre a grade
      try {
        const turfPts = turf.featureCollection(
          gridPts.map(p => turf.point([p.lng, p.lat], { elevation: p.elev }))
        )
        const breaks = []
        for (let e = Math.ceil(minElev / interval) * interval; e <= maxElev; e += interval) breaks.push(e)
        if (breaks.length >= 2) {
          const isoLines = turf.isolines(turfPts, breaks, { zProperty: 'elevation' })
          L.geoJSON(isoLines, {
            style: f => {
              const major = f.properties.elevation % (interval * 5) === 0
              return { color: '#e2e8f0', weight: major ? 2 : 0.9, opacity: major ? 0.85 : 0.5 }
            },
            onEachFeature: (f, l) => l.bindTooltip(`⛰ ${f.properties.elevation} m`, { sticky: true }),
          }).addTo(resultsLayerRef.current)
        }
      } catch (_) {}

      // 11. Contorno do polígono (borda visível)
      L.polygon(vertices.map(v => [v.lat, v.lng]), {
        color: '#a78bfa', fill: false, weight: 2.5, opacity: 0.9,
      }).addTo(resultsLayerRef.current)

      // 12. Marcadores de vértice numerados
      vertices.forEach((v, i) => {
        L.circleMarker([v.lat, v.lng], {
          radius: 5, color: '#fff', fillColor: '#a78bfa', fillOpacity: 1, weight: 2,
        }).bindTooltip(`Vértice ${i + 1}`).addTo(resultsLayerRef.current)
      })

      // 13. Grade 3D em coordenadas locais (metros a partir do canto SW do bbox)
      const origin = [bbox[0], bbox[1]]
      const grid3D = gridPts.map(p => {
        const x = turf.distance(origin, [p.lng, origin[1]], { units: 'kilometers' }) * 1000
        const z = turf.distance(origin, [origin[0], p.lat], { units: 'kilometers' }) * 1000
        return { x, y: p.elev, z, inside: p.inside }
      })

      const segMaxSlope  = segmentos.length > 0 ? segmentos.reduce((a, b) => a.slopePct > b.slopePct ? a : b) : null
      const totalCells   = Object.values(classCounts).reduce((s, v) => s + v, 0)
      const perimeterM   = Math.round(lateralDists.reduce((s, d) => s + d.dist, 0))
      const areaM2       = Math.round(turf.area(turfPoly))

      setModoAtivo('poligono')
      setResultado({
        type: 'poligono',
        minElev, maxElev, interval,
        drawnCount, classCounts, totalCells,
        segMaxSlope, allCrossings, lateralDists,
        perimeterM, areaM2,
        grid3D: { points: grid3D, cols: GCOLS, rows: GROWS, minE: minElev, maxE: maxElev },
      })

    } catch (e) {
      setResultado({ erro: e.message })
    } finally {
      setCarregando(false)
    }
  }

  // ── Cálculo declividade (2 pontos — modo Medir) ──────────────
  async function calcularDeclividade(pt1, pt2) {
    setCarregandoMedir(true)
    setMedicaoResult(null)
    try {
      const tLine      = turf.lineString([[pt1.lng, pt1.lat], [pt2.lng, pt2.lat]])
      const distHorizM = turf.length(tLine, { units: 'kilometers' }) * 1000

      // 1 ponto por metro, mínimo 2, máximo 1000
      const nPts = Math.max(2, Math.min(Math.round(distHorizM), 1000))
      const sampleCoords = [], sampleDists = []
      for (let i = 0; i < nPts; i++) {
        const d = (i / (nPts - 1)) * distHorizM
        sampleCoords.push(pointAlongLine(tLine, d))
        sampleDists.push(d)
      }

      // Busca elevações em paralelo (lotes de 100)
      const elevations = await fetchElevationsBatched(sampleCoords)

      const cotaA    = Math.round(elevations[0])
      const cotaB    = Math.round(elevations[elevations.length - 1])
      const deltaH   = Math.abs(cotaB - cotaA)
      const slopePct  = distHorizM > 0 ? (deltaH / distHorizM) * 100 : 0
      const slopeGrau = Math.atan(deltaH / distHorizM) * (180 / Math.PI)
      const classif   = classifySlope(slopePct)
      const perfil    = sampleCoords.map((_, i) => ({
        dist: Math.round(sampleDists[i]),
        elev: Math.round(elevations[i]),
      }))

      // Declividade a cada 10m
      const STEP = 10
      const segmentos10m = calcSegmentos(elevations, sampleDists, STEP)

      // Pontos críticos = segmentos com declividade >= 20% (Ondulado+), top 20 mais altos
      const criticos = [...segmentos10m]
        .filter(s => s.slope >= 20)
        .sort((a, b) => b.slope - a.slope)
        .slice(0, 20)

      // Marca pontos críticos no mapa
      const layer = drawLayerRef.current
      if (layer) {
        criticos.forEach((s, idx) => {
          const coord = pointAlongLine(tLine, s.midDist)
          const nbr   = getNBRClass(s.slope)
          L.circleMarker([coord[1], coord[0]], {
            radius: idx === 0 ? 9 : 6,
            fillColor: s.classif.cor,
            color: '#0f172a',
            fillOpacity: 0.9,
            weight: 2,
          })
            .bindTooltip(
              `⚠ ${s.slope.toFixed(1)}% · ${s.classif.label}<br>` +
              `Δh = ${s.dh} m em ${STEP} m<br>` +
              `${Math.round(s.midDist)} m desde A`,
              { sticky: true }
            )
            .addTo(layer)
        })
      }

      const ms = medirStateRef.current
      if (ms.pt1Marker) ms.pt1Marker.setTooltipContent(`A  Lat: ${pt1.lat.toFixed(6)}\nLng: ${pt1.lng.toFixed(6)}\nCota: ${cotaA} m`)
      if (ms.pt2Marker) ms.pt2Marker.setTooltipContent(`B  Lat: ${pt2.lat.toFixed(6)}\nLng: ${pt2.lng.toFixed(6)}\nCota: ${cotaB} m`)
      if (ms.linhaMedir) ms.linhaMedir.bindTooltip(
        `↕ ${deltaH} m · ${slopePct.toFixed(1)}% · ${slopeGrau.toFixed(1)}° · ${classif.label}` +
        (criticos.length ? ` · ⚠ ${criticos.length} trecho(s) crítico(s)` : ''),
        { permanent: true, direction: 'center' }
      ).openTooltip()

      setModoAtivo('medir')
      setMedicaoResult({
        coordA: { lat: pt1.lat, lng: pt1.lng },
        coordB: { lat: pt2.lat, lng: pt2.lng },
        cotaA, cotaB, deltaH,
        distHorizM: Math.round(distHorizM),
        slopePct, slopeGrau, classif, perfil,
        segmentos10m, criticos,
        nPts, stepM: STEP,
      })
    } catch (e) {
      setMedicaoResult({ erro: e.message })
    } finally {
      setCarregandoMedir(false)
    }
  }

  // ── Análise automática ───────────────────────────────────────
  async function analisarAuto() {
    setCarregandoAuto(true); setAutoResultado(null)
    resultsLayerRef.current?.clearLayers()
    drawLayerRef.current?.clearLayers()
    drawnPolygonsRef.current = []
    limparPoligonoPreview()
    setPoligono(null)
    setModoPoligono(false)

    try {
      const map    = leafletRef.current
      const bounds = map.getBounds()
      const N = bounds.getNorth(), S = bounds.getSouth()
      const W = bounds.getWest(),  E = bounds.getEast()
      const GRID   = 10
      const grid1  = [], grid2 = []
      const stepLat = (N - S) / (GRID - 1)
      const stepLng = (E - W) / (GRID - 1)
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          grid1.push([W + c * stepLng, S + r * stepLat])
          const lat2 = S + (r + 0.5) * stepLat, lng2 = W + (c + 0.5) * stepLng
          if (lat2 < N && lng2 < E) grid2.push([lng2, lat2])
        }
      }
      const [elevs1, elevs2] = await Promise.all([fetchElevations(grid1), fetchElevations(grid2.slice(0, 100))])
      const allTurfPts = turf.featureCollection([
        ...grid1.map((c, i) => turf.point(c, { elevation: elevs1[i] })),
        ...grid2.slice(0, elevs2.length).map((c, i) => turf.point(c, { elevation: elevs2[i] })),
      ])
      const allElevs = [...elevs1, ...elevs2]
      const minElev  = Math.min(...allElevs), maxElev = Math.max(...allElevs)
      const range    = maxElev - minElev
      let interval = 5
      if (range > 80)  interval = 10
      if (range > 200) interval = 20
      if (range > 400) interval = 50
      const cellH = turf.distance(grid1[0], grid1[GRID], { units: 'meters' }) * 1000
      const cellW = turf.distance(grid1[0], grid1[1],    { units: 'meters' }) * 1000
      const slopeAtPt = grid1.map((_, idx) => {
        const row = Math.floor(idx / GRID), col = idx % GRID
        const Lv = col > 0      ? elevs1[row*GRID+(col-1)] : elevs1[idx]
        const Rv = col < GRID-1 ? elevs1[row*GRID+(col+1)] : elevs1[idx]
        const Uv = row > 0      ? elevs1[(row-1)*GRID+col] : elevs1[idx]
        const Dv = row < GRID-1 ? elevs1[(row+1)*GRID+col] : elevs1[idx]
        const dx = (col > 0 && col < GRID-1) ? 2*cellW : cellW
        const dy = (row > 0 && row < GRID-1) ? 2*cellH : cellH
        return Math.sqrt(((Rv-Lv)/dx)**2 + ((Dv-Uv)/dy)**2) * 100
      })
      const slopeTurfPts = turf.featureCollection(grid1.map((c, i) => turf.point(c, { slope: slopeAtPt[i] })))
      const lonKm  = (E - W) * Math.cos(((N+S)/2) * Math.PI/180) * 111.32
      const latKm  = (N - S) * 111.32
      const cellKm = Math.max(Math.min(lonKm, latKm) / 30, 0.1)
      let densePts = allTurfPts
      try { densePts = turf.interpolate(allTurfPts, cellKm, { gridType: 'point', property: 'elevation', units: 'kilometers', weight: 3 }) } catch (_) {}
      const breaks = []
      for (let e = Math.ceil(minElev/interval)*interval; e <= Math.floor(maxElev/interval)*interval; e += interval) breaks.push(e)
      if (breaks.length < 2) { breaks.push(Math.round(minElev), Math.round(maxElev)) }
      let bands = null
      try { bands = turf.isobands(densePts, breaks, { zProperty: 'elevation' }) } catch (_) {
        try { bands = turf.isobands(allTurfPts, breaks, { zProperty: 'elevation' }) } catch (_2) {}
      }
      const classCounts = Object.fromEntries(SLOPE_CLASSES.map(c => [c.label, 0]))
      if (bands?.features?.length) {
        bands.features.forEach(feature => {
          try {
            let avgSlope = 20
            try {
              const inside = turf.pointsWithinPolygon(slopeTurfPts, feature)
              avgSlope = inside.features.length > 0
                ? inside.features.reduce((s, f) => s + f.properties.slope, 0) / inside.features.length
                : turf.nearestPoint(turf.centroid(feature), slopeTurfPts).properties.slope
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
      try {
        const isoLines = turf.isolines(densePts, breaks, { zProperty: 'elevation' })
        L.geoJSON(isoLines, {
          style: f => {
            const master = f.properties.elevation % (interval * 5) === 0
            return { color: '#0f172a', weight: master ? 2 : 0.8, opacity: master ? 0.9 : 0.5 }
          },
          onEachFeature: (f, layer) => layer.bindTooltip(`⛰ ${f.properties.elevation} m`, { sticky: true }),
        }).addTo(resultsLayerRef.current)
      } catch (_) {}
      let maxIdx = 0
      elevs1.forEach((e, i) => { if (e > elevs1[maxIdx]) maxIdx = i })
      const path = [{ lat: grid1[maxIdx][1], lng: grid1[maxIdx][0], elev: elevs1[maxIdx], row: Math.floor(maxIdx/GRID), col: maxIdx%GRID }]
      const visited = new Set([maxIdx])
      while (true) {
        const curr = path[path.length - 1]
        const nbrs = [[curr.row-1,curr.col],[curr.row+1,curr.col],[curr.row,curr.col-1],[curr.row,curr.col+1],[curr.row-1,curr.col-1],[curr.row-1,curr.col+1],[curr.row+1,curr.col-1],[curr.row+1,curr.col+1]].filter(([r,c]) => r>=0&&r<GRID&&c>=0&&c<GRID)
        let best = null, bestElev = curr.elev
        for (const [r, c] of nbrs) {
          const idx = r*GRID+c
          if (!visited.has(idx) && elevs1[idx] < bestElev) { bestElev = elevs1[idx]; best = { lat: grid1[idx][1], lng: grid1[idx][0], elev: elevs1[idx], row: r, col: c, idx } }
        }
        if (!best) break; visited.add(best.idx); path.push(best)
      }
      if (path.length >= 2) {
        L.polyline(path.map(p => [p.lat, p.lng]), { color: '#fff', weight: 4, opacity: 0.95, dashArray: '10,5' }).bindTooltip('Caminho de maior declive').addTo(resultsLayerRef.current)
        L.circleMarker([path[0].lat, path[0].lng], { radius: 9, color: '#fff', fillColor: '#ef4444', fillOpacity: 1, weight: 2.5 }).bindTooltip(`▲ ${Math.round(path[0].elev)} m`).addTo(resultsLayerRef.current)
        L.circleMarker([path[path.length-1].lat, path[path.length-1].lng], { radius: 9, color: '#fff', fillColor: '#22c55e', fillOpacity: 1, weight: 2.5 }).bindTooltip(`▼ ${Math.round(path[path.length-1].elev)} m`).addTo(resultsLayerRef.current)
      }
      const totalCells = Object.values(classCounts).reduce((s,v) => s+v, 0)
      setModoAtivo('auto')
      setAutoResultado({ minElev: Math.round(minElev), maxElev: Math.round(maxElev), interval, numBreaks: breaks.length, classCounts, totalCells, maxSlopePct: Math.max(...slopeAtPt), avgSlopePct: slopeAtPt.reduce((s,v) => s+v, 0) / slopeAtPt.length })
    } catch (e) {
      setAutoResultado({ erro: e.message })
    } finally { setCarregandoAuto(false) }
  }

  const isLoading = carregando || carregandoAuto || carregandoMedir
  const poligonoFechado = !!poligono

  const hintMsg = carregandoMedir
    ? '⏳ Buscando cotas de elevação…'
    : carregandoAuto
      ? '⏳ Calculando grade de elevação e isobands…'
      : carregando
        ? '⏳ Analisando polígono — buscando cotas na grade e arestas…'
        : modoMedir && !medirStateRef.current.pt1
          ? '🟣 Clique no mapa para marcar o Ponto A'
          : modoMedir && medirStateRef.current.pt1
            ? '🟣 Clique para marcar o Ponto B — a declividade será calculada automaticamente'
            : modoPoligono
              ? `🟣 Clique para adicionar vértices (${polyDrawRef.current.vertices.length} marcados) · Clique na bolinha verde para fechar`
              : modoAtivo === 'medir'
                ? 'Linha medida · clique em Medir para nova medição'
                : modoAtivo === 'poligono'
                  ? 'Relevo 3D calculado a partir do polígono'
                  : modoAtivo === 'auto'
                    ? 'Isobands coloridos por declividade · linha branca = maior declive'
                    : 'Escolha Medir, Auto ou Polígono para delimitar a área de análise'

  return (
    <>
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
              {/* Medir */}
              <button
                className={`${styles.btn} ${modoMedir ? styles.btnMedirActive : styles.btnMedir}`}
                onClick={() => { if (modoMedir) { limparMedicao(); return }; limparTudo(); setModoMedir(true) }}
                disabled={isLoading && !modoMedir}
              >
                <FiMaximize2 size={12} />
                {carregandoMedir ? 'Calculando…' : modoMedir ? 'Cancelar' : 'Medir'}
              </button>

              <span style={{ color: '#334155', fontSize: 14 }}>|</span>

              {/* Auto */}
              <button
                className={`${styles.btn} ${modoAtivo === 'auto' ? styles.btnAutoActive : styles.btnAuto}`}
                onClick={() => modoAtivo === 'auto' ? limparTudo() : analisarAuto()}
                disabled={isLoading}
              >
                <FiZap size={12} />
                {carregandoAuto ? 'Analisando…' : modoAtivo === 'auto' ? 'Limpar' : 'Auto'}
              </button>

              <span style={{ color: '#334155', fontSize: 14 }}>|</span>

              {/* Polígono */}
              <button
                className={`${styles.btn} ${modoPoligono ? styles.btnDrawActive : poligonoFechado ? styles.btnLineBDone : styles.btnDraw}`}
                onClick={() => {
                  if (modoPoligono) {
                    limparPoligonoPreview()
                    setModoPoligono(false)
                    return
                  }
                  limparTudo()
                  setModoPoligono(true)
                  polyDrawRef.current.ativo = true
                }}
                disabled={isLoading}
              >
                <FiEdit3 size={12} />
                {modoPoligono
                  ? `Desenhando… (${polyDrawRef.current.vertices.length} pts)`
                  : poligonoFechado ? '✓ Polígono' : 'Polígono'}
              </button>

              {/* Limpar */}
              {(modoAtivo || modoPoligono || modoMedir || poligonoFechado) && (
                <button className={`${styles.btn} ${styles.btnClear}`} onClick={limparTudo} disabled={isLoading && !modoMedir}>
                  <FiTrash2 size={12} />
                </button>
              )}
            </div>

            <span className={`${styles.hint} ${(modoPoligono || modoMedir) ? styles.hintActive : ''} ${isLoading ? styles.hintLoading : ''}`}>
              {hintMsg}
            </span>
          </div>

          <div ref={mapRef} className={styles.mapEl} />
        </div>

        {/* ── Painel lateral ─────────────────────────────── */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <FiActivity size={14} color="#38bdf8" />
            <span className={styles.panelTitle}>
              {modoAtivo === 'poligono' ? 'Análise de Polígono' : modoAtivo === 'auto' ? 'Análise Automática' : 'Resultado'}
            </span>
            {isLoading && <span className={styles.loadingDot} />}
          </div>

          <div className={styles.panelBody}>

            {/* Loading */}
            {isLoading && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>⏳</div>
                <div>{carregandoAuto ? 'Calculando isobands e grade de elevação…' : carregando ? 'Calculando grade interna, arestas e cruzamentos de curvas de nível…' : 'Calculando…'}</div>
                <div style={{ fontSize: 11, color: '#475569' }}>SRTM 30m · OpenTopoData</div>
              </div>
            )}

            {/* Instruções default */}
            {!isLoading && !modoAtivo && !modoPoligono && !modoMedir && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>🗺️</div>
                <div style={{ fontWeight: 600, color: '#94a3b8' }}>Modos de análise</div>
                <div style={{ marginTop: 8 }}>
                  <b style={{ color: '#f59e0b' }}>⚡ Auto</b> — analisa a vista atual, colore as faixas entre curvas de nível.
                </div>
                <div style={{ marginTop: 8 }}>
                  <b style={{ color: '#a78bfa' }}>✏ Polígono</b> — desenhe uma área no mapa. O sistema calcula as cotas internas, distâncias laterais, cruzamentos de curvas de nível e o modelo 3D do terreno.
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: '#475569' }}>
                  Clique na bolinha verde do 1º ponto para fechar o polígono.
                </div>
              </div>
            )}

            {/* Instrução modo medir */}
            {!isLoading && modoMedir && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>📏</div>
                <div style={{ fontWeight: 600, color: '#a78bfa' }}>
                  {medirStateRef.current.pt1 ? 'Agora clique no Ponto B' : 'Clique no Ponto A'}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5 }}>
                  {medirStateRef.current.pt1 ? 'Um clique encerra a linha e calcula a declividade.' : 'Marque o início da linha no mapa.'}
                </div>
              </div>
            )}

            {/* Instrução durante desenho do polígono */}
            {!isLoading && modoPoligono && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>✏️</div>
                <div style={{ fontWeight: 600, color: '#a78bfa' }}>Desenhando Polígono</div>
                <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6 }}>
                  Clique no mapa para adicionar vértices. Ao terminar, <b>dê duplo clique</b> para fechar o polígono e iniciar a análise.
                </div>
                <div style={{ marginTop: 8, background: '#1e293b', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#a78bfa' }}>
                  {polyDrawRef.current.vertices.length < 3
                    ? `${polyDrawRef.current.vertices.length} vértice(s) — mínimo 3`
                    : `${polyDrawRef.current.vertices.length} vértices — duplo clique para fechar`}
                </div>
              </div>
            )}

            {/* Erro */}
            {!isLoading && (resultado?.erro || autoResultado?.erro || medicaoResult?.erro) && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>⚠️</div>
                <div style={{ color: '#f97316' }}>{resultado?.erro || autoResultado?.erro || medicaoResult?.erro}</div>
              </div>
            )}

            {/* ── Resultado Medir ──────────────────────────── */}
            {!isLoading && modoAtivo === 'medir' && medicaoResult && !medicaoResult.erro && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: medicaoResult.classif.cor, display: 'inline-block' }} />
                  <span style={{ fontWeight: 700, color: medicaoResult.classif.cor, fontSize: 15 }}>{medicaoResult.classif.label}</span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>{medicaoResult.classif.desc}</span>
                </div>
                {medicaoResult.coordA && medicaoResult.coordB && (
                  <div style={{ background: '#1e293b', border: '1px solid #1e3a5f', borderRadius: 8, padding: '9px 11px', fontSize: 11 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid #162035' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#a78bfa', display: 'inline-block' }} />
                      <span style={{ color: '#a78bfa', fontWeight: 700, marginRight: 4 }}>A</span>
                      <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 10 }}>{medicaoResult.coordA.lat.toFixed(6)}, {medicaoResult.coordA.lng.toFixed(6)}</span>
                      <span style={{ marginLeft: 'auto', color: '#a78bfa', fontWeight: 700 }}>{medicaoResult.cotaA} m</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f0abfc', display: 'inline-block' }} />
                      <span style={{ color: '#f0abfc', fontWeight: 700, marginRight: 4 }}>B</span>
                      <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 10 }}>{medicaoResult.coordB.lat.toFixed(6)}, {medicaoResult.coordB.lng.toFixed(6)}</span>
                      <span style={{ marginLeft: 'auto', color: '#f0abfc', fontWeight: 700 }}>{medicaoResult.cotaB} m</span>
                    </div>
                  </div>
                )}
                <div className={styles.statsGrid}>
                  <div className={styles.statCard}><div className={styles.statLabel}>Declividade</div><div className={styles.statValue} style={{ color: medicaoResult.classif.cor }}>{medicaoResult.slopePct.toFixed(1)}<span className={styles.statUnit}> %</span></div></div>
                  <div className={styles.statCard}><div className={styles.statLabel}>Ângulo</div><div className={styles.statValue} style={{ color: medicaoResult.classif.cor }}>{medicaoResult.slopeGrau.toFixed(1)}<span className={styles.statUnit}> °</span></div></div>
                  <div className={styles.statCard}><div className={styles.statLabel}>Desnível (Δh)</div><div className={styles.statValue}>{medicaoResult.deltaH}<span className={styles.statUnit}> m</span></div></div>
                  <div className={styles.statCard}><div className={styles.statLabel}>Dist. horizontal</div><div className={styles.statValue}>{medicaoResult.distHorizM >= 1000 ? (medicaoResult.distHorizM/1000).toFixed(2) : medicaoResult.distHorizM}<span className={styles.statUnit}> {medicaoResult.distHorizM >= 1000 ? 'km' : 'm'}</span></div></div>
                </div>
                <div style={{ background: medicaoResult.classif.cor + '18', border: `1px solid ${medicaoResult.classif.cor}44`, borderRadius: 8, padding: '8px 11px', fontSize: 11, color: '#e2e8f0' }}>
                  <b style={{ color: medicaoResult.classif.cor }}>Declividade</b> = (Δh / dist) × 100 = ({medicaoResult.deltaH} / {medicaoResult.distHorizM}) × 100 = <b style={{ color: medicaoResult.classif.cor }}>{medicaoResult.slopePct.toFixed(2)}%</b>
                </div>
                {/* Corte longitudinal + barras de declividade 10m */}
                <div>
                  <div className={styles.chartTitle}>
                    Corte Longitudinal — {medicaoResult.perfil?.length} pts &nbsp;·&nbsp;
                    <span style={{ color: '#64748b', fontWeight: 400 }}>
                      {medicaoResult.segmentos10m?.length} segmentos de 10m
                    </span>
                  </div>
                  <div style={{ background: '#1e293b', border: `1px solid ${medicaoResult.classif.cor}33`, borderRadius: 8, padding: '10px 8px 4px' }}>
                    <PerfilLongitudinal
                      perfil={medicaoResult.perfil}
                      cotaA={medicaoResult.cotaA}
                      cotaB={medicaoResult.cotaB}
                      distHorizM={medicaoResult.distHorizM}
                      cor={medicaoResult.classif.cor}
                      segmentos10m={medicaoResult.segmentos10m}
                    />
                  </div>
                </div>

                {/* Pontos críticos */}
                {medicaoResult.criticos?.length > 0 && (
                  <div style={{ background: '#1a0a00', border: '1px solid #7c2d12', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{
                      padding: '8px 12px', borderBottom: '1px solid #7c2d12',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ fontSize: 13 }}>⚠</span>
                      <span style={{ color: '#fb923c', fontWeight: 700, fontSize: 12 }}>
                        {medicaoResult.criticos.length} Trechos Críticos (≥ 20% / 10m)
                      </span>
                      <span style={{ color: '#64748b', fontSize: 10, marginLeft: 'auto' }}>ordenado por declividade</span>
                    </div>
                    <div style={{ maxHeight: 210, overflowY: 'auto' }}>
                      {medicaoResult.criticos.map((s, i) => {
                        const nbr = getNBRClass(s.slope)
                        return (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 12px',
                            borderBottom: '1px solid #1c1007',
                            background: i === 0 ? s.classif.cor + '18' : 'transparent',
                          }}>
                            {/* Rank */}
                            <span style={{
                              fontSize: 10, fontWeight: 700, color: i === 0 ? '#fff' : '#64748b',
                              background: i === 0 ? s.classif.cor : '#1e293b',
                              borderRadius: 4, padding: '1px 6px', flexShrink: 0,
                            }}>#{i + 1}</span>

                            {/* Posição */}
                            <span style={{ color: '#94a3b8', fontSize: 10, fontFamily: 'monospace' }}>
                              {s.d0}–{s.d1} m
                            </span>

                            {/* Δh */}
                            <span style={{ color: '#64748b', fontSize: 10 }}>
                              Δh {s.dh} m
                            </span>

                            {/* Declividade */}
                            <span style={{
                              marginLeft: 'auto', fontWeight: 700,
                              color: s.classif.cor, fontFamily: 'monospace', fontSize: 12,
                            }}>
                              {s.slope.toFixed(1)}%
                            </span>

                            {/* Classificação */}
                            <span style={{
                              background: s.classif.cor + '22',
                              border: `1px solid ${s.classif.cor}55`,
                              color: s.classif.cor, borderRadius: 4,
                              padding: '1px 6px', fontSize: 9, fontWeight: 700,
                              flexShrink: 0,
                            }}>
                              {nbr.nivel}
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    {/* Resumo por classe */}
                    <div style={{ padding: '8px 12px', borderTop: '1px solid #7c2d12', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {SLOPE_CLASSES.filter(c => c.max < Infinity).map(cls => {
                        const cnt = medicaoResult.segmentos10m?.filter(s => s.classif.label === cls.label).length || 0
                        if (!cnt) return null
                        return (
                          <div key={cls.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: cls.cor, display: 'inline-block' }} />
                            <span style={{ color: cls.cor }}>{cls.label}</span>
                            <span style={{ color: '#475569' }}>{cnt}×</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Nenhum trecho crítico */}
                {medicaoResult.criticos?.length === 0 && medicaoResult.segmentos10m?.length > 0 && (
                  <div style={{
                    background: '#064e3b', border: '1px solid #065f46', borderRadius: 8,
                    padding: '8px 12px', fontSize: 11, color: '#6ee7b7',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span>✓</span>
                    <span>Nenhum trecho com declividade crítica (≥ 20%) em segmentos de 10m.</span>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className={`${styles.btn} ${styles.btnMedir}`} style={{ flex: 1, justifyContent: 'center', background: '#1e3a5f', borderColor: '#3b82f6', color: '#93c5fd' }} onClick={() => setShow3D(true)}>
                    <FiBox size={12} /> Ver em 3D
                  </button>
                  <button className={`${styles.btn} ${styles.btnMedir}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => { limparMedicao(); setModoAtivo(null); setModoMedir(true) }}>
                    <FiMaximize2 size={12} /> Nova medição
                  </button>
                </div>
              </>
            )}

            {/* ── Legenda com toggle ───────────────────────── */}
            {!isLoading && modoAtivo && modoAtivo !== 'medir' && !resultado?.erro && !autoResultado?.erro && (
              <div>
                <div className={styles.chartTitle}>Legenda — clique para mostrar/ocultar</div>
                <div className={styles.legendToggleList}>
                  {SLOPE_CLASSES.map(cls => {
                    const visible = classesVisiveis.has(cls.label)
                    const count   = modoAtivo === 'poligono' ? resultado?.classCounts?.[cls.label] || 0 : autoResultado?.classCounts?.[cls.label] || 0
                    return (
                      <button key={cls.label} className={`${styles.legendToggleBtn} ${visible ? styles.legendToggleBtnOn : styles.legendToggleBtnOff}`} style={{ borderColor: visible ? cls.cor : '#334155' }}
                        onClick={() => setClassesVisiveis(prev => { const next = new Set(prev); if (next.has(cls.label)) next.delete(cls.label); else next.add(cls.label); return next })}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: visible ? cls.cor : '#334155', display: 'inline-block' }} />
                        <span style={{ flex: 1, textAlign: 'left', color: visible ? cls.cor : '#475569' }}>{cls.label}</span>
                        <span style={{ color: visible ? '#94a3b8' : '#334155', fontSize: 10 }}>{count > 0 ? count : ''}</span>
                        {visible ? <FiEye size={11} color="#94a3b8" /> : <FiEyeOff size={11} color="#334155" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Resultado Polígono ───────────────────────── */}
            {!isLoading && modoAtivo === 'poligono' && resultado && !resultado.erro && (
              <>
                {/* Stats gerais */}
                <div className={styles.statsGrid}>
                  <div className={styles.statCard}><div className={styles.statLabel}>Alt. mín</div><div className={styles.statValue}>{resultado.minElev}<span className={styles.statUnit}> m</span></div></div>
                  <div className={styles.statCard}><div className={styles.statLabel}>Alt. máx</div><div className={styles.statValue}>{resultado.maxElev}<span className={styles.statUnit}> m</span></div></div>
                  <div className={styles.statCard}><div className={styles.statLabel}>Perímetro</div><div className={styles.statValue}>{resultado.perimeterM >= 1000 ? (resultado.perimeterM/1000).toFixed(2) : resultado.perimeterM}<span className={styles.statUnit}> {resultado.perimeterM >= 1000 ? 'km' : 'm'}</span></div></div>
                  <div className={styles.statCard}><div className={styles.statLabel}>Área</div><div className={styles.statValue}>{resultado.areaM2 >= 10000 ? (resultado.areaM2/10000).toFixed(2) : resultado.areaM2}<span className={styles.statUnit}> {resultado.areaM2 >= 10000 ? 'ha' : 'm²'}</span></div></div>
                </div>

                {/* Botão 3D */}
                <button
                  className={`${styles.btn} ${styles.btnMedir}`}
                  style={{ width: '100%', justifyContent: 'center', background: '#1e3a5f', borderColor: '#3b82f6', color: '#93c5fd' }}
                  onClick={() => setShow3D(true)}
                >
                  <FiBox size={12} /> Ver Relevo 3D do Polígono
                </button>

                {/* Classificação NBR do trecho mais crítico */}
                {resultado.segMaxSlope && (() => {
                  const nbr = getNBRClass(resultado.segMaxSlope.slopePct)
                  return (
                    <div style={{ background: nbr.cor + '15', border: `1px solid ${nbr.cor}55`, borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ background: nbr.cor, color: '#000', fontWeight: 900, fontSize: 12, borderRadius: 6, padding: '2px 8px' }}>{nbr.nivel}</div>
                        <div style={{ fontWeight: 700, color: nbr.cor, fontSize: 14 }}>Risco {nbr.risco}</div>
                        <div style={{ marginLeft: 'auto', fontSize: 10, color: '#64748b' }}>NBR 11682 / IPT</div>
                      </div>
                      <div style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 4 }}>{nbr.desc}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        <div style={{ background: '#0f172a', borderRadius: 6, padding: '6px 8px' }}>
                          <div style={{ fontSize: 9, color: '#475569', marginBottom: 2 }}>FATOR DE SEGURANÇA</div>
                          <div style={{ fontWeight: 700, color: nbr.cor }}>{nbr.fs}</div>
                        </div>
                        <div style={{ background: '#0f172a', borderRadius: 6, padding: '6px 8px' }}>
                          <div style={{ fontSize: 9, color: '#475569', marginBottom: 2 }}>DECLIV. MÁXIMA</div>
                          <div style={{ fontWeight: 700, color: nbr.cor }}>{resultado.segMaxSlope.slopePct.toFixed(1)}%</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 8, background: '#0f172a', borderRadius: 6, padding: '6px 8px', borderLeft: `3px solid ${nbr.cor}` }}>
                        <div style={{ fontSize: 9, color: '#475569', marginBottom: 2 }}>AÇÃO RECOMENDADA</div>
                        <div style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 600 }}>{nbr.acao}</div>
                      </div>
                    </div>
                  )
                })()}

                {/* Triângulo maior declividade */}
                {resultado.segMaxSlope && (
                  <div>
                    <div className={styles.chartTitle}>Maior declividade identificada</div>
                    <div style={{ background: '#1e293b', border: `1px solid ${resultado.segMaxSlope.classif.cor}55`, borderRadius: 8, padding: '10px 10px 4px' }}>
                      <TrianguloSlope
                        interval={resultado.interval}
                        distHoriz={100}
                        slopePct={resultado.segMaxSlope.slopePct}
                        slopeGrau={resultado.segMaxSlope.slopeGrau || Math.atan(resultado.segMaxSlope.slopePct / 100) * (180 / Math.PI)}
                        cor={resultado.segMaxSlope.classif.cor}
                      />
                      <div style={{ textAlign: 'center', fontSize: 11, color: resultado.segMaxSlope.classif.cor, fontWeight: 700, paddingBottom: 6 }}>
                        {resultado.segMaxSlope.classif.label} — {resultado.segMaxSlope.classif.desc}
                      </div>
                    </div>
                  </div>
                )}

                {/* Distâncias laterais (arestas) */}
                {resultado.lateralDists?.length > 0 && (
                  <div>
                    <div className={styles.chartTitle}>Distâncias laterais — arestas do polígono</div>
                    <div className={styles.segTable}>
                      <div className={styles.segHeader} style={{ gridTemplateColumns: '1fr 1fr' }}>
                        <span>Aresta</span><span>Comprimento</span>
                      </div>
                      {resultado.lateralDists.map((d, i) => (
                        <div key={i} className={styles.segRow} style={{ gridTemplateColumns: '1fr 1fr' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#a78bfa', display: 'inline-block' }} />
                            {d.from} → {d.to}
                          </span>
                          <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                            {d.dist >= 1000 ? (d.dist/1000).toFixed(3)+' km' : d.dist+' m'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cruzamentos de curvas de nível nas arestas */}
                {resultado.allCrossings?.length > 0 && (
                  <div>
                    <div className={styles.chartTitle}>Cruzamentos de curvas de nível (Δh = {resultado.interval} m)</div>
                    <div className={styles.segTable}>
                      <div className={styles.segHeader} style={{ gridTemplateColumns: '1.2fr 1fr 1.2fr' }}>
                        <span>Cota</span><span>Aresta</span><span>Dist. na aresta</span>
                      </div>
                      {resultado.allCrossings.map((c, i) => (
                        <div key={i} className={styles.segRow} style={{ gridTemplateColumns: '1.2fr 1fr 1.2fr' }}>
                          <span style={{ color: '#a78bfa', fontWeight: 700 }}>⛰ {c.elevation} m</span>
                          <span style={{ color: '#94a3b8' }}>#{c.edge}</span>
                          <span style={{ color: '#38bdf8' }}>{c.dist} / {c.edgeLen} m</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Distribuição de risco */}
                <div>
                  <div className={styles.chartTitle}>Distribuição de declividade no polígono</div>
                  <div className={styles.riskBars}>
                    {SLOPE_CLASSES.map(cls => {
                      const count = resultado.classCounts?.[cls.label] || 0
                      const pct   = resultado.totalCells > 0 ? (count / resultado.totalCells) * 100 : 0
                      if (pct === 0) return null
                      return (
                        <div key={cls.label} className={styles.riskBarRow}>
                          <div className={styles.riskBarLabel}><span style={{ width: 9, height: 9, borderRadius: '50%', background: cls.cor, display: 'inline-block' }} /><span>{cls.label}</span></div>
                          <div className={styles.riskBarTrack}><div className={styles.riskBarFill} style={{ width: `${pct}%`, background: cls.cor }} /></div>
                          <span className={styles.riskBarPct}>{pct.toFixed(0)}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            {/* ── Resultado Auto ───────────────────────────── */}
            {!isLoading && modoAtivo === 'auto' && autoResultado && !autoResultado.erro && (
              <>
                <div className={styles.statsGrid}>
                  <div className={styles.statCard}><div className={styles.statLabel}>Alt. mín</div><div className={styles.statValue}>{autoResultado.minElev}<span className={styles.statUnit}> m</span></div></div>
                  <div className={styles.statCard}><div className={styles.statLabel}>Alt. máx</div><div className={styles.statValue}>{autoResultado.maxElev}<span className={styles.statUnit}> m</span></div></div>
                  <div className={styles.statCard}><div className={styles.statLabel}>Decliv. máx.</div><div className={styles.statValue} style={{ color: classifySlope(autoResultado.maxSlopePct).cor }}>{autoResultado.maxSlopePct.toFixed(1)}<span className={styles.statUnit}> %</span></div></div>
                  <div className={styles.statCard}><div className={styles.statLabel}>Decliv. média</div><div className={styles.statValue} style={{ color: classifySlope(autoResultado.avgSlopePct).cor }}>{autoResultado.avgSlopePct.toFixed(1)}<span className={styles.statUnit}> %</span></div></div>
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
                          <div className={styles.riskBarLabel}><span style={{ width: 9, height: 9, borderRadius: '50%', background: cls.cor, display: 'inline-block' }} /><span>{cls.label}</span></div>
                          <div className={styles.riskBarTrack}><div className={styles.riskBarFill} style={{ width: `${pct}%`, background: cls.cor }} /></div>
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

    {/* ── Visualização 3D ────────────────────────────────── */}
    {show3D && (
      <TerrainProfile3D
        mode={modoAtivo === 'poligono' ? 'poligono' : 'medir'}
        perfil={modoAtivo === 'medir' ? medicaoResult?.perfil : undefined}
        gridData={modoAtivo === 'poligono' ? resultado?.grid3D : undefined}
        lateralDists={modoAtivo === 'poligono' ? resultado?.lateralDists : undefined}
        onClose={() => setShow3D(false)}
      />
    )}
    </>
  )
}
