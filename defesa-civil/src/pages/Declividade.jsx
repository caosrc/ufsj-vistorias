import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as turf from '@turf/turf'
import Chart from 'chart.js/auto'
import { CIDADES, CIDADE_PADRAO } from '../data/cidades'
import Sidebar from '../components/Sidebar'
import styles from './Declividade.module.css'
import { FiTrendingUp, FiTrash2, FiActivity, FiEye, FiEyeOff, FiMaximize2, FiBox, FiEdit3, FiDownload } from 'react-icons/fi'
import TerrainProfile3D from '../components/TerrainProfile3D'
import { api, API_BASE } from '../services/api'
import { getElevationsBatchWithFallback, getElevationsBatchDEM, getElevationDEMRaw, getElevationsBatchDEMRaw, getElevationsBatchDEMBicubic, getElevationsBatchCopernicus, savitzkyGolay } from '../services/terrainDEM'
import JSZip from 'jszip'
import { parseTif, tifElevAt, sampleTifGrid, calcularSlope, calcularHillshade, suavizacaoAdaptativa, baixarDEMOpenTopography } from '../services/tifElevation'
import { saveTif, loadTif, removeTif as removeTifIDB } from '../services/tifStorage'

const LAYERS = [
  {
    // OpenTopoMap — curvas de nível reais com relevo sombreado (mesmo modelo do topographic-map.com)
    id: 'topo', label: 'Topografia', icone: '⛰️',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    maxZoom: 17, maxNativeZoom: 17,
  },
  {
    // ESRI World TopoMap — usa Copernicus DEM GLO-30
    id: 'topo_esri', label: 'Topo ESRI', icone: '🗾',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Copernicus DEM',
    maxZoom: 22, maxNativeZoom: 19,
  },
  {
    id: 'ruas', label: 'Ruas', icone: '🗺️',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap', maxZoom: 22, maxNativeZoom: 19,
  },
  {
    id: 'satelite', label: 'Satélite', icone: '🛰️',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri', maxZoom: 22, maxNativeZoom: 19,
  },
]

const SLOPE_CLASSES = [
  { max: 3,        label: 'Plano',           desc: 'Sem restrições',                        cor: '#22c55e' },
  { max: 8,        label: 'Suave ondulado',  desc: 'Pequena limitação agrícola',             cor: '#84cc16' },
  { max: 20,       label: 'Ondulado',        desc: 'Requer práticas conservacionistas',      cor: '#eab308' },
  { max: 45,       label: 'Forte ondulado',  desc: 'Risco de erosão',                       cor: '#f97316' },
  { max: 75,       label: 'Montanhoso',      desc: 'Evitar construções',                    cor: '#ef4444' },
  { max: 567,      label: 'Escarpado',       desc: 'Risco geológico severo',                cor: '#7c3aed' },
  { max: Infinity, label: 'Vertical',        desc: 'Superfície subvertical / corte rochoso', cor: '#dc2626' },
]

const ANGLE_CATS = [
  { label: '0° – 10°',  minDeg: 0,  maxDeg: 10,       cor: '#22c55e' },
  { label: '11° – 17°', minDeg: 11, maxDeg: 17,       cor: '#84cc16' },
  { label: '18° – 30°', minDeg: 18, maxDeg: 30,       cor: '#eab308' },
  { label: '31° – 60°', minDeg: 31, maxDeg: 60,       cor: '#f97316' },
  { label: '61° – 84°', minDeg: 61, maxDeg: 84,       cor: '#7c3aed' },
  { label: '≥ 85°',     minDeg: 85, maxDeg: Infinity, cor: '#dc2626' },
]

function segAngleDeg(slopePct) {
  return Math.atan(slopePct / 100) * (180 / Math.PI)
}

// Mapeia qualquer ângulo decimal para exatamente uma categoria (sem gaps)
function getAngleCat(angDeg) {
  if (angDeg <= 10) return 0
  if (angDeg <= 17) return 1
  if (angDeg <= 30) return 2
  if (angDeg <= 60) return 3
  if (angDeg <= 84) return 4
  return 5
}

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
function PerfilLongitudinal({ perfil, cotaA, cotaB, distHorizM, cor, segmentos10m, vistoriaZones, segSelecionado, onCursorMove, contourInterval }) {
  const scrollRef = useRef(null)
  const [cursorDist, setCursorDist] = useState(null)

  useEffect(() => {
    if (!segSelecionado || !scrollRef.current || !perfil) return
    const maxDist = perfil[perfil.length - 1]?.dist || 1
    const plotW   = Math.max(400, Math.round(maxDist * Math.max(2.5, Math.min(12, 600 / maxDist))))
    const padL    = 44
    const xPos    = padL + (segSelecionado.d0 / maxDist) * plotW
    scrollRef.current.scrollTo({ left: Math.max(0, xPos - 80), behavior: 'smooth' })
  }, [segSelecionado])

  if (!perfil || perfil.length < 2) return null

  const rawMin = Math.min(...perfil.map(p => p.elev))
  const rawMax = Math.max(...perfil.map(p => p.elev))
  const minElev = Math.floor(rawMin) - 1
  const maxElev = Math.ceil(rawMax) + 1
  const elevRange = Math.max(maxElev - minElev, 1)
  const maxDist   = perfil[perfil.length - 1].dist || 1

  // ── Escala igual X e Y: 1m = pxPerM pixels ──────────────────
  const pxPerM = Math.max(2.5, Math.min(12, 600 / maxDist))
  const padL = 44, padR = 14, padT = 18, padB = 30
  const plotW = Math.max(400, Math.round(maxDist * pxPerM))
  const plotH = Math.max(80,  Math.round(elevRange * pxPerM))
  const W  = plotW + padL + padR
  const Hp = plotH + padT + padB

  const toX = d => padL + (d / maxDist) * plotW
  const toY = e => padT + plotH - ((e - minElev) / elevRange) * plotH

  const pts   = perfil.map(p => `${toX(p.dist).toFixed(1)},${toY(p.elev).toFixed(1)}`).join(' L ')
  const pathD = `M ${pts}`
  const areaD = `${pathD} L ${toX(maxDist).toFixed(1)},${(padT + plotH).toFixed(1)} L ${toX(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`

  // Ticks de 1 em 1 metro (ou de 5 em 5 se muito denso) — respeita intervalo das curvas TIF se fornecido
  const yStepAuto = pxPerM >= 5 ? 1 : (pxPerM >= 2.5 ? 2 : 5)
  const yStep = (contourInterval && contourInterval > 0) ? contourInterval : yStepAuto
  const xStep = pxPerM >= 5 ? 1 : (pxPerM >= 3 ? 2 : (maxDist <= 200 ? 5 : 10))
  const yTicks = []
  for (let e = Math.ceil(minElev); e <= maxElev + 0.01; e += yStep) yTicks.push(Math.round(e))
  const xTicks = []
  for (let d = 0; d <= maxDist + 0.01; d += xStep) xTicks.push(Math.round(d * 10) / 10)

  const yA = toY(cotaA), xA = toX(0)
  const yB = toY(cotaB), xB = toX(maxDist)
  const peakPt   = perfil.reduce((a, b) => b.elev > a.elev ? b : a)
  const valleyPt = perfil.reduce((a, b) => b.elev < a.elev ? b : a)
  const showPeak   = peakPt.dist > 5  && peakPt.dist < maxDist - 5
  const showValley = valleyPt.dist > 5 && valleyPt.dist < maxDist - 5 && valleyPt.elev < peakPt.elev

  // ── segmentos 1m críticos para destacar no perfil ───────────
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

  const totalH = Hp + (segmentos10m?.length > 0 ? BH + 6 : 0)

  function getElevAtDist(d) {
    if (!perfil || perfil.length < 2) return null
    let lo = 0, hi = perfil.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (perfil[mid].dist <= d) lo = mid; else hi = mid
    }
    const seg = perfil[hi].dist - perfil[lo].dist
    const t = seg > 0 ? (d - perfil[lo].dist) / seg : 0
    return parseFloat((perfil[lo].elev + (perfil[hi].elev - perfil[lo].elev) * t).toFixed(1))
  }

  function handleCursorMove(e) {
    const div = scrollRef.current
    if (!div) return
    const rect = div.getBoundingClientRect()
    const svgX = (e.clientX - rect.left) + div.scrollLeft
    const d = Math.max(0, Math.min(maxDist, ((svgX - padL) / plotW) * maxDist))
    setCursorDist(d)
    if (onCursorMove) onCursorMove(d)
  }

  function handleCursorLeave() {
    setCursorDist(null)
    if (onCursorMove) onCursorMove(null)
  }

  return (
    <div ref={scrollRef} style={{ overflowX: 'auto', overflowY: 'hidden', background: '#1e293b', borderRadius: 8, cursor: 'crosshair' }}
      onMouseMove={handleCursorMove} onMouseLeave={handleCursorLeave}>
      <svg viewBox={`0 0 ${W} ${totalH}`} width={W} height={totalH} style={{ display: 'block', minWidth: W }}>

        {/* ── Zonas de vistorias que a linha cruza ───────────── */}
        {vistoriaZones?.map((z, i) => {
          const x0 = toX(z.d0), x1 = toX(Math.min(z.d1, maxDist))
          const zW  = Math.max(x1 - x0, 3)
          const midX = (x0 + x1) / 2
          return (
            <g key={`vz${i}`}>
              <rect x={x0} y={padT} width={zW} height={plotH} fill={z.cor + '22'} />
              <line x1={x0} y1={padT} x2={x0} y2={padT + plotH} stroke={z.cor} strokeWidth="1.5" strokeDasharray="5,3" opacity="0.9" />
              <line x1={x1} y1={padT} x2={x1} y2={padT + plotH} stroke={z.cor} strokeWidth="1.5" strokeDasharray="5,3" opacity="0.9" />
              <rect x={x0 + 1} y={padT} width={zW - 2} height={16} fill={z.cor} rx="2" opacity="0.85" />
              <text x={midX} y={padT + 6.5} fontSize="7.5" fill="#fff" textAnchor="middle" fontWeight="bold">{z.risco}</text>
              <text x={midX} y={padT + 14} fontSize="6.5" fill="#fff" textAnchor="middle" opacity="0.92">{z.nome.length > 14 ? z.nome.slice(0, 13) + '…' : z.nome}</text>
            </g>
          )
        })}

        {/* ── Fundo de zonas críticas no perfil ──────────────── */}
        {criticos10.map((s, i) => (
          <rect key={`crit${i}`}
            x={toX(s.d0)} y={padT}
            width={Math.max(toX(s.d1) - toX(s.d0), 3)}
            height={plotH}
            fill={s.classif.cor + '30'}
          />
        ))}

        {/* Grade horizontal (todos os ticks da cota) */}
        {yTicks.map(e => (
          <line key={`yg${e}`} x1={padL} y1={toY(e)} x2={padL + plotW} y2={toY(e)}
            stroke="#243450" strokeWidth={0.6} strokeDasharray="4,3" />
        ))}
        {/* Grade vertical (todos os ticks de distância) */}
        {xTicks.map(d => (
          <line key={`xg${d}`} x1={toX(d)} y1={padT} x2={toX(d)} y2={padT + plotH}
            stroke="#243450" strokeWidth={0.6} strokeDasharray="4,3" />
        ))}

        {/* ── Segmento selecionado — highlight ────────────────── */}
        {segSelecionado && (() => {
          const sx0 = toX(segSelecionado.d0)
          const sx1 = toX(segSelecionado.d1)
          const segCor = segSelecionado.classif?.cor || cor
          const midX   = (sx0 + sx1) / 2
          const labelY = padT - 4
          return (
            <g>
              <rect x={sx0} y={padT} width={Math.max(sx1 - sx0, 3)} height={plotH}
                fill={segCor + '30'} />
              <line x1={sx0} y1={padT} x2={sx0} y2={padT + plotH}
                stroke={segCor} strokeWidth="1.5" strokeDasharray="4,2" opacity="0.9" />
              <line x1={sx1} y1={padT} x2={sx1} y2={padT + plotH}
                stroke={segCor} strokeWidth="1.5" strokeDasharray="4,2" opacity="0.9" />
              <rect x={midX - 26} y={labelY - 10} width={52} height={12} rx="3"
                fill={segCor} opacity="0.92" />
              <text x={midX} y={labelY} fontSize="8.5" fill="#fff" textAnchor="middle" fontWeight="bold">
                {segSelecionado.angDeg.toFixed(1)}° · {segSelecionado.slope.toFixed(1)}%
              </text>
            </g>
          )
        })()}

        {/* Área preenchida e linha do perfil */}
        <path d={areaD} fill={cor + '1e'} />
        <path d={pathD} fill="none" stroke={cor} strokeWidth="2" strokeLinejoin="miter" strokeLinecap="square" />

        {/* Pontos do perfil (apenas se não for muito denso) */}
        {perfil.length <= 300 && perfil.map((p, i) =>
          <circle key={i} cx={toX(p.dist)} cy={toY(p.elev)} r="1.2" fill={cor} opacity="0.55" />
        )}

        {/* Eixo Y */}
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#475569" strokeWidth="1.2" />
        {yTicks.map(e => (
          <g key={`yl${e}`}>
            <line x1={padL - 4} y1={toY(e)} x2={padL} y2={toY(e)} stroke="#64748b" strokeWidth="1" />
            <text x={padL - 6} y={toY(e) + 3.5} fontSize="8.5" fill="#94a3b8" textAnchor="end" fontFamily="monospace">{Math.round(e)}</text>
          </g>
        ))}
        <text x={11} y={padT + plotH / 2} fontSize="8" fill="#64748b" textAnchor="middle"
          transform={`rotate(-90,11,${padT + plotH / 2})`}>Cota (m)</text>

        {/* Eixo X */}
        <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#475569" strokeWidth="1.2" />
        {xTicks.map(d => (
          <g key={`xl${d}`}>
            <line x1={toX(d)} y1={padT + plotH} x2={toX(d)} y2={padT + plotH + 4} stroke="#64748b" strokeWidth="1" />
            <text x={toX(d)} y={padT + plotH + 13} fontSize="8.5" fill="#94a3b8" textAnchor="middle" fontFamily="monospace">
              {d >= 1000 ? `${(d/1000).toFixed(1)}k` : `${Math.round(d)}`}
            </text>
          </g>
        ))}
        <text x={padL + plotW / 2} y={Hp - 4} fontSize="8" fill="#64748b" textAnchor="middle">Distância (m)</text>

        {/* Escala info */}
        <text x={padL + plotW} y={padT - 4} fontSize="7.5" fill="#475569" textAnchor="end" fontFamily="monospace">
          escala: {pxPerM.toFixed(1)} px/m
        </text>

        {/* Ponto A */}
        <circle cx={xA} cy={yA} r="5.5" fill="#a78bfa" stroke="#0f172a" strokeWidth="2" />
        <text x={xA + 8} y={yA - 7} fontSize="10" fill="#a78bfa" fontWeight="bold">A</text>
        <text x={xA + 8} y={yA + 6} fontSize="8.5" fill="#a78bfa" fontFamily="monospace">{cotaA} m</text>

        {/* Ponto B */}
        <circle cx={xB} cy={yB} r="5.5" fill="#f0abfc" stroke="#0f172a" strokeWidth="2" />
        <text x={xB - 9} y={yB - 7} fontSize="10" fill="#f0abfc" fontWeight="bold" textAnchor="end">B</text>
        <text x={xB - 9} y={yB + 6} fontSize="8.5" fill="#f0abfc" fontFamily="monospace" textAnchor="end">{cotaB} m</text>

        {/* Pico */}
        {showPeak && (
          <g>
            <circle cx={toX(peakPt.dist)} cy={toY(peakPt.elev)} r="4" fill="#fbbf24" stroke="#0f172a" strokeWidth="1.5" />
            <text x={toX(peakPt.dist)} y={toY(peakPt.elev) - 8} fontSize="8" fill="#fbbf24" textAnchor="middle" fontFamily="monospace">{peakPt.elev}m</text>
          </g>
        )}
        {/* Vale */}
        {showValley && (
          <g>
            <circle cx={toX(valleyPt.dist)} cy={toY(valleyPt.elev)} r="4" fill="#38bdf8" stroke="#0f172a" strokeWidth="1.5" />
            <text x={toX(valleyPt.dist)} y={toY(valleyPt.elev) + 16} fontSize="8" fill="#38bdf8" textAnchor="middle" fontFamily="monospace">{valleyPt.elev}m</text>
          </g>
        )}

        {/* ── Barras de declividade por 1m ───────────────────── */}
        {segmentos10m?.length > 0 && (() => {
          const BY = Hp + 6
          return (
            <>
              <text x={padL} y={BY + 5} fontSize="7.5" fill="#64748b" fontWeight="600">Declividade por trecho 1m</text>
              <text x={padL + plotW} y={BY + 5} fontSize="7.5" fill="#475569" textAnchor="end">máx: {maxSlope.toFixed(0)}%</text>

              <rect x={padL} y={BY + BpadT} width={plotW} height={bPlotH} fill="#0f172a" rx="2" />

              {maxSlope > 20 && (() => {
                const refY = BY + toBarH(20)
                return <>
                  <line x1={padL} y1={refY} x2={padL + plotW} y2={refY} stroke="#334155" strokeWidth="0.8" strokeDasharray="3,2" />
                  <text x={padL + plotW + 2} y={refY + 3} fontSize="7" fill="#475569">20%</text>
                </>
              })()}

              {segmentos10m.map((s, i) => {
                const bx    = toX(s.d0)
                const bw    = Math.max(toX(s.d1) - toX(s.d0) - 0.4, 1)
                const by    = BY + toBarH(s.slope)
                const bh    = bPlotH - (toBarH(s.slope) - BpadT)
                const isW   = i === worstIdx
                const ang   = (Math.atan(s.slope / 100) * 180 / Math.PI).toFixed(1)
                const tip   = `${s.slope.toFixed(1)}% · ${ang}°\n${s.d0.toFixed(0)}m → ${s.d1.toFixed(0)}m · Δh=${s.dh}m\n${s.classif.label}`
                return (
                  <g key={`bar${i}`}>
                    <rect x={bx} y={by} width={bw} height={Math.max(bh, 2)}
                      fill={s.classif.cor} opacity={isW ? 1 : 0.78}
                      stroke={isW ? '#fff' : 'none'} strokeWidth={isW ? 0.7 : 0}
                    >
                      <title>{tip}</title>
                    </rect>
                    {isW && (
                      <>
                        <line x1={bx + bw/2} y1={by - 2} x2={bx + bw/2} y2={BY + BpadT + 2}
                          stroke="#fff" strokeWidth="0.8" strokeDasharray="2,1" />
                        <text x={bx + bw/2} y={BY + BpadT - 2} fontSize="7.5" fill="#fff" textAnchor="middle" fontWeight="bold">
                          {s.slope.toFixed(0)}% · {ang}°
                        </text>
                      </>
                    )}
                  </g>
                )
              })}

              <line x1={padL} y1={BY + BpadT + bPlotH} x2={padL + plotW} y2={BY + BpadT + bPlotH} stroke="#334155" strokeWidth="0.8" />
              <text x={padL + plotW / 2} y={BY + BH - 2} fontSize="7" fill="#475569" textAnchor="middle">
                {segmentos10m.length} segmentos de 1m
              </text>
            </>
          )
        })()}

        {/* ── Cursor de altitude draggável A→B ──────────────── */}
        {cursorDist !== null && (() => {
          const cx = toX(cursorDist)
          const elev = getElevAtDist(cursorDist)
          const cy = elev !== null ? toY(elev) : padT + plotH / 2
          const nearRight = cx > padL + plotW - 76
          const labelX = nearRight ? cx - 72 : cx + 8
          const labelY = Math.max(padT + 4, Math.min(cy - 16, padT + plotH - 32))
          return (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={cx} y1={padT} x2={cx} y2={padT + plotH}
                stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="4,2" opacity="0.9" />
              <polygon
                points={`${cx},${padT + plotH + 1} ${cx - 5},${padT + plotH - 6} ${cx + 5},${padT + plotH - 6}`}
                fill="#fbbf24" opacity="0.85"
              />
              <circle cx={cx} cy={cy} r="5" fill="#fbbf24" stroke="#0f172a" strokeWidth="2" />
              <rect x={labelX} y={labelY} width={64} height={28} rx="4"
                fill="#0f172a" stroke="#fbbf24" strokeWidth="1.3" opacity="0.97" />
              <text x={labelX + 6} y={labelY + 12} fontSize="11" fill="#fbbf24" fontFamily="monospace" fontWeight="bold">
                {elev} m
              </text>
              <text x={labelX + 6} y={labelY + 23} fontSize="8.5" fill="#94a3b8" fontFamily="monospace">
                {cursorDist >= 1000 ? `${(cursorDist / 1000).toFixed(2)} km` : `${Math.round(cursorDist)} m`}
              </text>
            </g>
          )
        })()}
      </svg>
    </div>
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

// ── Elevação API via proxy do backend (fallback) ─────────────
async function fetchElevations(points) {
  const lats = points.map(p => p[1].toFixed(6)).join(',')
  const lngs = points.map(p => p[0].toFixed(6)).join(',')
  try {
    const res = await fetch(`${API_BASE}/elevation?latitude=${lats}&longitude=${lngs}`)
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data.elevation) && data.elevation.length > 0) {
        if (data.elevation.length === points.length) {
          return data.elevation.map(e => e ?? 0)
        }
        return points.map((_, i) => {
          const t = points.length > 1 ? i / (points.length - 1) : 0
          const srcIdx = t * (data.elevation.length - 1)
          const lo = Math.floor(srcIdx), hi = Math.min(Math.ceil(srcIdx), data.elevation.length - 1)
          const frac = srcIdx - lo
          return (data.elevation[lo] ?? 0) * (1 - frac) + (data.elevation[hi] ?? data.elevation[lo] ?? 0) * frac
        })
      }
    }
  } catch (err) {
    console.error('[Elevação] erro API:', err)
  }
  // Não lança mais — retorna zeros para garantir que a análise continua
  console.warn('[Elevação] API não respondeu, usando zeros para este lote')
  return points.map(() => 0)
}

// ── Batch sequencial (lotes de 100) — usado como fallback ────
async function fetchElevationsBatched(points) {
  const batches = []
  for (let i = 0; i < points.length; i += 100) batches.push(points.slice(i, i + 100))
  const results = []
  for (const batch of batches) results.push(await fetchElevations(batch))
  return results.flat()
}

// ── Elevação com DEM Terrarium (primário) + fallback API ──────
async function fetchElevWithDEM(points, extentM = null) {
  try {
    const result = await getElevationsBatchWithFallback(
      points,
      fetchElevationsBatched,
      extentM
    )
    return {
      elevations: result.elevations.map(e => (e != null ? e : 0)),
      source: result.source,
    }
  } catch (err) {
    // Fallback final: tenta a API diretamente sem limite de tentativas
    try {
      const elevations = await fetchElevationsBatched(points)
      return { elevations: elevations.map(e => e ?? 0), source: 'api-direto' }
    } catch (_) {
      // Se tudo falhar, retorna zeros para não travar a análise
      console.warn('[Elevação] Todas as fontes falharam — usando zeros', err?.message)
      return { elevations: points.map(() => 0), source: 'offline' }
    }
  }
}

// ── Elevação bicúbica Terrarium — perfil mais suave (Catmull-Rom pixel-level) ─
// Copernicus GLO-30 via /api/elevation — mesmo padrão de fetchElevWithDEMBicubic
async function fetchElevWithCopernicus(points, _extentM = null) {
  try {
    const raw   = await getElevationsBatchCopernicus(points)
    const valid = raw.filter(v => v !== null && v !== undefined).length
    if (valid / raw.length >= 0.7) {
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== null && raw[i] !== undefined) continue
        let lo = i - 1, hi = i + 1
        while (lo >= 0 && (raw[lo] === null || raw[lo] === undefined)) lo--
        while (hi < raw.length && (raw[hi] === null || raw[hi] === undefined)) hi++
        const vlo = lo >= 0 ? raw[lo] : null, vhi = hi < raw.length ? raw[hi] : null
        raw[i] = (vlo !== null && vhi !== null) ? vlo + (vhi - vlo) * (i - lo) / (hi - lo) : (vlo ?? vhi ?? 0)
      }
      return { elevations: raw.map(e => e ?? 0), source: 'Copernicus GLO-30 30m' }
    }
  } catch (_) {}
  // fallback para Terrarium bicúbico
  return fetchElevWithDEMBicubic(points, _extentM)
}

async function fetchElevWithDEMBicubic(points, extentM = null) {
  try {
    const raw = await getElevationsBatchDEMBicubic(points, extentM)
    const valid = raw.filter(v => v !== null).length
    if (valid / raw.length >= 0.7) {
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== null) continue
        let lo = i - 1, hi = i + 1
        while (lo >= 0 && raw[lo] === null) lo--
        while (hi < raw.length && raw[hi] === null) hi++
        const vlo = lo >= 0 ? raw[lo] : null
        const vhi = hi < raw.length ? raw[hi] : null
        if (vlo !== null && vhi !== null) {
          const t = (i - lo) / (hi - lo)
          raw[i] = vlo + (vhi - vlo) * t
        } else {
          raw[i] = vlo ?? vhi ?? 0
        }
      }
      return { elevations: raw.map(e => e ?? 0), source: 'Terrarium bicúbico z16' }
    }
  } catch (_) {}
  return fetchElevWithDEM(points, extentM)
}

// ── SRTM 30m via OpenTopoData (gratuito, sem chave) ──────────
async function fetchElevWithSRTM(points, _extentM = null) {
  try {
    const BATCH = 100
    const all = []
    for (let i = 0; i < points.length; i += BATCH) {
      const chunk = points.slice(i, i + BATCH)
      const locs  = chunk.map(p => `${p[1]},${p[0]}`).join('|')
      const res   = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${locs}`)
      if (!res.ok) throw new Error(`SRTM ${res.status}`)
      const json  = await res.json()
      json.results.forEach(r => all.push(r.elevation ?? null))
    }
    const valid = all.filter(v => v !== null).length
    if (valid / all.length >= 0.7) {
      for (let i = 0; i < all.length; i++) {
        if (all[i] !== null) continue
        let lo = i - 1, hi = i + 1
        while (lo >= 0 && all[lo] === null) lo--
        while (hi < all.length && all[hi] === null) hi++
        all[i] = (lo >= 0 && hi < all.length)
          ? all[lo] + (all[hi] - all[lo]) * (i - lo) / (hi - lo)
          : (lo >= 0 ? all[lo] : (hi < all.length ? all[hi] : 0))
      }
      return { elevations: all.map(e => e ?? 0), source: 'SRTM 30m' }
    }
  } catch (_) {}
  return fetchElevWithCopernicus(points, _extentM)
}

// ── Elevação RAW — pixel bruto Terrarium + fallback API ───────
// Preserva quebras reais do terreno (taludes, rampas, cortes)
async function fetchElevWithDEMRaw(points, extentM = null) {
  try {
    const raw = await getElevationsBatchDEMRaw(points, extentM)
    const valid = raw.filter(v => v !== null).length
    if (valid / raw.length >= 0.7) {
      // Preenche nulos por interpolação linear dos vizinhos
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== null) continue
        let lo = i - 1, hi = i + 1
        while (lo >= 0 && raw[lo] === null) lo--
        while (hi < raw.length && raw[hi] === null) hi++
        const vlo = lo >= 0 ? raw[lo] : null
        const vhi = hi < raw.length ? raw[hi] : null
        if (vlo !== null && vhi !== null) {
          const t = (i - lo) / (hi - lo)
          raw[i] = vlo + (vhi - vlo) * t
        } else {
          raw[i] = vlo ?? vhi ?? 0
        }
      }
      return { elevations: raw.map(e => e ?? 0), source: 'Terrarium raw (pixel real)' }
    }
  } catch (_) {}
  return fetchElevWithDEM(points, extentM)
}

// ── Interpola elevação de um ponto (x,z cena) na grade 3D ────
function interpolateElevFromGrid(sceneX, sceneZ, grid3D, cols, rows) {
  if (!grid3D || grid3D.length < 4) return 0
  const minX = grid3D[0].x
  const maxX = grid3D[cols - 1].x
  const minZ = grid3D[0].z
  const maxZ = grid3D[(rows - 1) * cols].z
  const u = cols > 1 ? (sceneX - minX) / Math.max(maxX - minX, 0.001) * (cols - 1) : 0
  const v = rows > 1 ? (sceneZ - minZ) / Math.max(maxZ - minZ, 0.001) * (rows - 1) : 0
  const c0 = Math.max(0, Math.min(cols - 2, Math.floor(u)))
  const r0 = Math.max(0, Math.min(rows - 2, Math.floor(v)))
  const uf = Math.max(0, Math.min(1, u - c0))
  const vf = Math.max(0, Math.min(1, v - r0))
  const e00 = grid3D[r0 * cols + c0]?.y ?? 0
  const e10 = grid3D[r0 * cols + c0 + 1]?.y ?? e00
  const e01 = grid3D[(r0 + 1) * cols + c0]?.y ?? e00
  const e11 = grid3D[(r0 + 1) * cols + c0 + 1]?.y ?? e00
  return e00 * (1-uf)*(1-vf) + e10 * uf*(1-vf) + e01 * (1-uf)*vf + e11 * uf*vf
}

// Interpolação Catmull-Rom — perfil suave sem artefatos em escada
function catmullRomInterp(srcDists, srcElevs, tgtDists) {
  const n = srcDists.length
  if (n === 0) return tgtDists.map(() => 0)
  if (n === 1) return tgtDists.map(() => srcElevs[0])
  if (n <= 3) {
    return linearInterpRaw(srcDists, srcElevs, tgtDists)
  }
  function catmull(p0, p1, p2, p3, t) {
    return 0.5 * (
      (2 * p1) +
      (p2 - p0) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (3 * p1 - p0 - 3 * p2 + p3) * t * t * t
    )
  }
  function findSeg(td) {
    if (td <= srcDists[0]) return 0
    if (td >= srcDists[n - 1]) return n - 2
    let lo = 0, hi = n - 2
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (srcDists[mid] <= td) lo = mid; else hi = mid - 1
    }
    return lo
  }
  return tgtDists.map(td => {
    if (td <= srcDists[0]) return srcElevs[0]
    if (td >= srcDists[n - 1]) return srcElevs[n - 1]
    const i  = findSeg(td)
    const t  = (td - srcDists[i]) / Math.max(srcDists[i + 1] - srcDists[i], 0.001)
    const p0 = srcElevs[Math.max(0, i - 1)]
    const p1 = srcElevs[i]
    const p2 = srcElevs[Math.min(n - 1, i + 1)]
    const p3 = srcElevs[Math.min(n - 1, i + 2)]
    return catmull(p0, p1, p2, p3, Math.max(0, Math.min(1, t)))
  })
}

// Interpolação linear simples — preserva transições abruptas do terreno real
// (sem suavização Catmull-Rom: áreas planas ficam planas, encostas ficam nítidas)
function linearInterpRaw(srcDists, srcElevs, tgtDists) {
  const n = srcDists.length
  if (n === 0) return tgtDists.map(() => 0)
  if (n === 1) return tgtDists.map(() => srcElevs[0])
  function findBracket(td) {
    if (td <= srcDists[0]) return 0
    if (td >= srcDists[n - 1]) return n - 2
    let lo = 0, hi = n - 2
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (srcDists[mid] <= td) lo = mid; else hi = mid - 1
    }
    return lo
  }
  return tgtDists.map(td => {
    if (td <= srcDists[0]) return srcElevs[0]
    if (td >= srcDists[n - 1]) return srcElevs[n - 1]
    const i   = findBracket(td)
    const seg = srcDists[i + 1] - srcDists[i]
    const t   = seg > 0 ? (td - srcDists[i]) / seg : 0
    return srcElevs[i] + (srcElevs[i + 1] - srcElevs[i]) * t
  })
}

function linearInterp(srcDists, srcElevs, tgtDists) {
  return linearInterpRaw(srcDists, srcElevs, tgtDists)
}

// ── Calcula segmentos de declividade a cada stepM metros ──────
// Otimizado para dados densos regularmente espaçados
function calcSegmentos(elevations, sampleDists, stepM) {
  const n = sampleDists.length
  if (n < 2) return []
  const maxDist = sampleDists[n - 1]
  const minDist = sampleDists[0]
  const span    = maxDist - minDist
  const segs    = []
  // Para dados regularmente espaçados: índice direto (O(1) por segmento)
  const isRegular = Math.abs((sampleDists[1] - sampleDists[0]) - span / (n - 1)) < 0.01
  const regStep   = isRegular ? span / (n - 1) : 0
  function nearestIdx(d) {
    if (isRegular) return Math.max(0, Math.min(n - 1, Math.round((d - minDist) / regStep)))
    return sampleDists.reduce((best, v, i) => Math.abs(v - d) < Math.abs(sampleDists[best] - d) ? i : best, 0)
  }
  for (let d = minDist; d + stepM <= maxDist + 0.01; d += stepM) {
    const d0  = d
    const d1  = Math.min(d + stepM, maxDist)
    const i0  = nearestIdx(d0)
    const i1  = nearestIdx(d1)
    const dh  = Math.abs(elevations[i1] - elevations[i0])
    const hdist = Math.max(Math.abs(sampleDists[i1] - sampleDists[i0]), 0.1)
    const slope = (dh / hdist) * 100
    segs.push({
      d0: parseFloat(d0.toFixed(1)),
      d1: parseFloat(d1.toFixed(1)),
      midDist: (d0 + d1) / 2,
      elev0: parseFloat(elevations[i0].toFixed(1)),
      elev1: parseFloat(elevations[i1].toFixed(1)),
      dh:    parseFloat(dh.toFixed(2)),
      slope: parseFloat(slope.toFixed(1)),
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
  const mapRef            = useRef(null)
  const leafletRef        = useRef(null)
  const tileLayerRef      = useRef(null)
  const drawLayerRef      = useRef(null)
  const resultsLayerRef   = useRef(null)
  const curvasLayerRef    = useRef(null)
  const cotas1mLayerRef   = useRef(null)
  const elevLabelsLayerRef = useRef(null)
  const vistoriasLayerRef = useRef(null)
  const canvasRendererRef = useRef(null)
  const chartRef          = useRef(null)
  const chartInstanceRef  = useRef(null)
  const drawnPolygonsRef  = useRef([])
  const curvasDebounceRef = useRef(null)
  const tifCurvasDebRef   = useRef(null)
  const eleHoverDebRef    = useRef(null)
  const showCurvasRef     = useRef(false)
  const curvasEqRef       = useRef(10)
  const tifCurvasLayerRef = useRef(null)
  const tifMetaRef        = useRef(null)
  const tifCurvasEqRef    = useRef(1)
  const tifCurvasShowRef  = useRef(false)
  const tifFileInputRef        = useRef(null)
  const tifPolyRef             = useRef(null)
  const hillshadeLayerRef      = useRef(null)
  const slopeOverlayLayerRef   = useRef(null)

  // Click elevation marker
  const clickMarkerRef = useRef(null)
  const elevModeRef    = useRef('auto')

  // Profile cursor (linha de medir)
  const profileTLineRef        = useRef(null)
  const profileCursorMarkerRef = useRef(null)

  // Medir state
  const modoMedirRef  = useRef(false)
  const medirStateRef = useRef({ pt1: null, pt1Marker: null, linhaMedir: null, pt2Marker: null, previewLine: null })

  // Polygon drawing state
  const polyDrawRef     = useRef({ ativo: false, vertices: [], markers: [], line: null, preview: null, closeLine: null, filledPoly: null, firstMarker: null })
  const modoPoligonoRef = useRef(false)

  const [cidade,          setCidade]          = useState(CIDADE_PADRAO)
  const [camada,          setCamada]          = useState('topo')
  const [modoMedir,       setModoMedir]       = useState(false)
  const [modoPoligono,    setModoPoligono]    = useState(false)
  const [poligono,        setPoligono]        = useState(null)
  const [carregando,      setCarregando]      = useState(false)
  const [carregandoMedir, setCarregandoMedir] = useState(false)
  const [modoAtivo,       setModoAtivo]       = useState(null)
  const [resultado,       setResultado]       = useState(null)
  const [medicaoResult,   setMedicaoResult]   = useState(null)
  const [geojsonExport,   setGeojsonExport]   = useState(null)
  const [cellSize,        setCellSize]        = useState(30)
  const [classesVisiveis, setClassesVisiveis] = useState(() => new Set(SLOPE_CLASSES.map(c => c.label)))
  const [show3D,          setShow3D]          = useState(false)
  const [showPanel,       setShowPanel]       = useState(false)
  const [showVistorias,      setShowVistorias]      = useState(true)
  const [vistoriaPolygons3D, setVistoriaPolygons3D] = useState([])
  const [monitoramentoMarkers3D, setMonitoramentoMarkers3D] = useState([])
  const [angCatIdx,       setAngCatIdx]       = useState(null)
  const [segSelecionado,  setSegSelecionado]  = useState(null)
  const [showCurvas,      setShowCurvas]      = useState(false)
  const [curvasLoading,   setCurvasLoading]   = useState(false)
  const [curvasEq,        setCurvasEq]        = useState(10)
  const [curvasSrc,       setCurvasSrc]       = useState('')
  const [eleHover,        setEleHover]        = useState(null)
  const [showCotas1m,     setShowCotas1m]     = useState(false)
  const [showElevLabels,  setShowElevLabels]  = useState(false)
  const [cotas1mData,     setCotas1mData]     = useState(null)
  const [elevMode,        setElevMode]        = useState('auto')
  const [perfilStep,      setPerfilStep]      = useState(1)
  const perfilStepRef = useRef(1)
  const [tifInfo,          setTifInfo]          = useState(null)
  const [showTifCurvas,    setShowTifCurvas]    = useState(false)
  const [tifCurvasEq,      setTifCurvasEq]      = useState(1)
  const [tifLoading,       setTifLoading]       = useState(false)
  const [tifCurvasLoading, setTifCurvasLoading] = useState(false)
  const [tifError,         setTifError]         = useState(null)
  const [showHillshade,    setShowHillshade]    = useState(false)
  const [showSlopeOverlay, setShowSlopeOverlay] = useState(false)
  const [overlayLoading,   setOverlayLoading]   = useState(false)
  const [otApiKey,         setOtApiKey]         = useState('')
  const [downloadingDEM,   setDownloadingDEM]   = useState(false)

  useEffect(() => { elevModeRef.current = elevMode }, [elevMode])
  useEffect(() => { modoMedirRef.current  = modoMedir },  [modoMedir])
  useEffect(() => { modoPoligonoRef.current = modoPoligono }, [modoPoligono])
  useEffect(() => { showCurvasRef.current = showCurvas }, [showCurvas])
  useEffect(() => { curvasEqRef.current      = curvasEq      }, [curvasEq])
  useEffect(() => { tifCurvasEqRef.current   = tifCurvasEq   }, [tifCurvasEq])
  useEffect(() => { tifCurvasShowRef.current = showTifCurvas }, [showTifCurvas])
  useEffect(() => { perfilStepRef.current    = perfilStep    }, [perfilStep])

  useEffect(() => {
    if (!hillshadeLayerRef.current) return
    if (showHillshade && tifInfo) renderHillshadeOverlay()
    else hillshadeLayerRef.current.clearLayers()
  }, [showHillshade, tifInfo])

  // Sincroniza passo do corte longitudinal com intervalo das curvas do TIF
  useEffect(() => {
    if (showTifCurvas && tifCurvasEq) {
      setPerfilStep(tifCurvasEq)
      perfilStepRef.current = tifCurvasEq
    }
  }, [showTifCurvas, tifCurvasEq])

  useEffect(() => {
    if (!slopeOverlayLayerRef.current) return
    if (showSlopeOverlay && tifInfo) renderSlopeOverlay()
    else slopeOverlayLayerRef.current.clearLayers()
  }, [showSlopeOverlay, tifInfo])

  // ── Toggle curvas DEM ──────────────────────────────────────
  useEffect(() => {
    const layer = curvasLayerRef.current
    const map   = leafletRef.current
    if (!layer || !map) return
    if (showCurvas) {
      gerarCurvasNivel()
    } else {
      layer.clearLayers()
      setCurvasSrc('')
      if (curvasDebounceRef.current) clearTimeout(curvasDebounceRef.current)
    }
  }, [showCurvas, curvasEq])

  // ── Renderiza curvas de nível 1m dentro do polígono ────────
  function renderCotas1m(data, layer) {
    if (!data || !layer) return
    layer.clearLayers()
    const { turfPts, minElev, maxElev } = data
    const breaks = []
    for (let e = Math.ceil(minElev); e <= Math.floor(maxElev); e++) breaks.push(e)
    if (breaks.length < 2 || breaks.length > 600) return
    try {
      const isoLines = turf.isolines(turfPts, breaks, { zProperty: 'elevation' })
      isoLines.features.forEach(feat => {
        const elev = feat.properties.elevation
        const isMajor = Math.round(elev) % 10 === 0
        const lines = feat.geometry.type === 'LineString'
          ? [feat.geometry.coordinates]
          : feat.geometry.coordinates
        lines.forEach(line => {
          if (line.length < 2) return
          const lls = line.map(([lng, lat]) => [lat, lng])
          L.polyline(lls, {
            color: isMajor ? '#1e40af' : '#3b82f6',
            weight: isMajor ? 1.8 : 0.75,
            opacity: isMajor ? 0.92 : 0.55,
            interactive: false,
            smoothFactor: 0,
          }).addTo(layer)
          if (isMajor && lls.length >= 4) {
            const mid = lls[Math.floor(lls.length / 2)]
            L.marker(mid, {
              icon: L.divIcon({
                className: '',
                html: `<span style="font-size:8px;color:#1e40af;background:rgba(255,255,255,0.88);padding:0 2px;border-radius:2px;font-weight:700;pointer-events:none">${Math.round(elev)}m</span>`,
                iconAnchor: [14, 6],
              }),
              interactive: false,
              zIndexOffset: -400,
            }).addTo(layer)
          }
        })
      })
    } catch (_) {}
  }

  // ── Toggle cotas 1m ────────────────────────────────────────
  useEffect(() => {
    if (showCotas1m && cotas1mData) {
      renderCotas1m(cotas1mData, cotas1mLayerRef.current)
    } else {
      cotas1mLayerRef.current?.clearLayers()
    }
  }, [showCotas1m, cotas1mData])

  // ── Toggle labels de altitude nos pontos do polígono ───────
  useEffect(() => {
    const map = leafletRef.current
    const layer = elevLabelsLayerRef.current
    if (!map || !layer) return
    if (showElevLabels) {
      if (!map.hasLayer(layer)) layer.addTo(map)
    } else {
      if (map.hasLayer(layer)) map.removeLayer(layer)
    }
  }, [showElevLabels])

  // Painel abre automaticamente ao concluir análise do polígono (3D só ao clicar)
  useEffect(() => {
    if (resultado && !resultado.erro && modoAtivo === 'poligono') {
      setShowPanel(true)
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

  // ── Carrega TIF de elevação do IndexedDB ao montar ─────────
  useEffect(() => {
    loadTif().then(stored => {
      if (!stored) return
      setTifLoading(true)
      parseTif(stored.buffer).then(meta => {
        if (!meta.isGeographic) {
          setTifError('CRS não suportado. Converta o arquivo para WGS84 (EPSG:4326) no QGIS antes de importar.')
          setTifLoading(false)
          return
        }
        tifMetaRef.current = meta
        setTifInfo({ name: stored.filename, bbox: meta.bbox, width: meta.width, height: meta.height })
        setTifLoading(false)
      }).catch(err => {
        setTifError('Erro ao ler o arquivo TIF: ' + err.message)
        setTifLoading(false)
      })
    }).catch(() => {})
  }, [])

  // ── Toggle curvas TIF (mapa inteiro sobre área do TIF) ───────
  useEffect(() => {
    if (!tifCurvasLayerRef.current) return
    if (showTifCurvas && tifMetaRef.current) {
      gerarTifCurvas()
    } else {
      tifCurvasLayerRef.current.clearLayers()
    }
  }, [showTifCurvas, tifCurvasEq, tifInfo])

  // ── Download DEM via OpenTopography API ───────────────────────
  async function handleBaixarDEM() {
    if (!otApiKey.trim()) { setTifError('Informe a API Key do OpenTopography (gratuita em portal.opentopography.org/requestApiKey)'); return }
    const map = leafletRef.current
    if (!map) return
    setDownloadingDEM(true)
    setTifError(null)
    try {
      const b     = map.getBounds()
      const south = b.getSouth(), north = b.getNorth()
      const west  = b.getWest(),  east  = b.getEast()
      const ab    = await baixarDEMOpenTopography(south, north, west, east, otApiKey.trim())
      const meta  = await parseTif(ab)
      if (!meta.isGeographic) {
        setTifError('DEM retornado não está em WGS84 — tente novamente.')
        return
      }
      const nome = `COP30_${new Date().toISOString().slice(0,10)}.tif`
      await saveTif(ab, nome)
      tifMetaRef.current = meta
      setTifInfo({ name: nome, bbox: meta.bbox, width: meta.width, height: meta.height })
      setShowTifCurvas(false)
    } catch (err) {
      setTifError('Erro no download: ' + (err.message || String(err)))
    } finally {
      setDownloadingDEM(false)
    }
  }

  // ── Upload de arquivo TIF ─────────────────────────────────────
  async function handleTifUpload(file) {
    setTifError(null)
    setTifLoading(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const meta = await parseTif(arrayBuffer)
      if (!meta.isGeographic) {
        setTifError('CRS não suportado. Converta para WGS84 (EPSG:4326) no QGIS antes de importar.')
        setTifLoading(false)
        return
      }
      await saveTif(arrayBuffer, file.name)
      tifMetaRef.current = meta
      setTifInfo({ name: file.name, bbox: meta.bbox, width: meta.width, height: meta.height })
      setShowTifCurvas(false)
    } catch (err) {
      setTifError('Erro ao processar o arquivo: ' + err.message)
    } finally {
      setTifLoading(false)
    }
  }

  // ── Remove o TIF ──────────────────────────────────────────────
  function handleRemoverTif() {
    tifMetaRef.current = null
    setTifInfo(null)
    setShowTifCurvas(false)
    setShowHillshade(false)
    setShowSlopeOverlay(false)
    setTifError(null)
    tifCurvasLayerRef.current?.clearLayers()
    hillshadeLayerRef.current?.clearLayers()
    slopeOverlayLayerRef.current?.clearLayers()
    removeTifIDB().catch(() => {})
  }

  // ── Helpers raster → canvas data URL ─────────────────────────
  function hexToRgb(hex) {
    return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
  }

  function rasterParaDataURL(width, height, getPixelRGBA) {
    const maxDim = 1024
    const scale  = Math.min(1, maxDim / Math.max(width, height))
    const w = Math.max(1, Math.round(width  * scale))
    const h = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = Math.min(width  - 1, Math.round(x / scale))
        const sy = Math.min(height - 1, Math.round(y / scale))
        const di = (y * w + x) * 4
        const [r, g, b, a] = getPixelRGBA(sy * width + sx)
        img.data[di]=r; img.data[di+1]=g; img.data[di+2]=b; img.data[di+3]=a
      }
    }
    ctx.putImageData(img, 0, 0)
    return canvas.toDataURL('image/png')
  }

  function resolucaoMetrosTif(meta) {
    const [west, south, east, north] = meta.bbox
    const latMid = (south + north) / 2
    const dx = (east  - west)  / meta.width  * 111320 * Math.cos(latMid * Math.PI / 180)
    const dy = (north - south) / meta.height * 111320
    return Math.max(1, (dx + dy) / 2)
  }

  // ── Gerar overlay de hillshade (sombreamento analítico) ───────
  async function renderHillshadeOverlay() {
    const meta  = tifMetaRef.current
    const layer = hillshadeLayerRef.current
    const map   = leafletRef.current
    if (!meta || !layer || !map) return
    setOverlayLoading(true)
    layer.clearLayers()
    try {
      const { band, width, height, bbox } = meta
      const [west, south, east, north] = bbox
      const resM   = resolucaoMetrosTif(meta)
      const smooth = suavizacaoAdaptativa(band, width, height)
      const hs     = calcularHillshade(smooth, width, height, resM)
      const url    = rasterParaDataURL(width, height, (i) => {
        const v = hs[i] ?? 128
        return [v, v, v, v > 20 ? 155 : 0]
      })
      L.imageOverlay(url, [[south, west], [north, east]], { opacity: 0.6, interactive: false }).addTo(layer)
    } catch (err) {
      console.error('[Hillshade]', err)
    } finally {
      setOverlayLoading(false)
    }
  }

  // ── Gerar overlay de declividade colorido (slope) ─────────────
  async function renderSlopeOverlay() {
    const meta  = tifMetaRef.current
    const layer = slopeOverlayLayerRef.current
    const map   = leafletRef.current
    if (!meta || !layer || !map) return
    setOverlayLoading(true)
    layer.clearLayers()
    try {
      const { band, width, height, bbox } = meta
      const [west, south, east, north] = bbox
      const resM  = resolucaoMetrosTif(meta)
      const slope = calcularSlope(band, width, height, resM)
      const url   = rasterParaDataURL(width, height, (i) => {
        const ang = slope[i] ?? 0
        if (ang < 2) return [0, 0, 0, 0]
        const cls = SLOPE_CLASSES.find(c => ang <= c.max) ?? SLOPE_CLASSES[SLOPE_CLASSES.length - 1]
        const [r, g, b] = hexToRgb(cls.cor)
        return [r, g, b, 175]
      })
      L.imageOverlay(url, [[south, west], [north, east]], { opacity: 0.7, interactive: false }).addTo(layer)
    } catch (err) {
      console.error('[Slope Overlay]', err)
    } finally {
      setOverlayLoading(false)
    }
  }

  // ── Gera curvas de nível do TIF no mapa inteiro (área visível) ─
  async function gerarTifCurvas() {
    const map   = leafletRef.current
    const layer = tifCurvasLayerRef.current
    const meta  = tifMetaRef.current
    if (!map || !layer || !meta) return

    setTifCurvasLoading(true)
    layer.clearLayers()

    try {
      const bounds = map.getBounds()
      const s = bounds.getSouth(), n = bounds.getNorth()
      const w = bounds.getWest(),  e = bounds.getEast()

      // Intersecciona visão do mapa com cobertura do TIF (usa meta.bbox corretamente)
      const [tifW, tifS, tifE, tifN] = meta.bbox
      const tWest  = Math.max(w, tifW)
      const tEast  = Math.min(e, tifE)
      const tSouth = Math.max(s, tifS)
      const tNorth = Math.min(n, tifN)

      if (tWest >= tEast || tSouth >= tNorth) {
        // TIF não cobre área visível
        setTifCurvasLoading(false)
        return
      }

      const eq = tifCurvasEqRef.current
      const bboxW = turf.distance([tWest, tSouth], [tEast, tSouth], { units: 'kilometers' }) * 1000
      const bboxH = turf.distance([tWest, tSouth], [tWest, tNorth], { units: 'kilometers' }) * 1000

      // Grade adaptativa segura — turf.isolines tem stack overflow com grades > ~100×100
      // Limites máximos por intervalo para manter qualidade visual sem travar
      const maxCells = eq <= 1 ? 75 : eq <= 5 ? 90 : eq <= 10 ? 100 : 120
      const targetSpacingM = eq <= 1 ? 10 : eq <= 5 ? 15 : eq <= 10 ? 20 : 30
      const rawCols = Math.round(bboxW / targetSpacingM) + 1
      const rawRows = Math.round(bboxH / targetSpacingM) + 1
      // Garante que o produto cols×rows nunca passe do limite seguro
      const scale = Math.sqrt((rawCols * rawRows) / (maxCells * maxCells))
      const cols  = Math.max(10, Math.min(maxCells, scale > 1 ? Math.round(rawCols / scale) : rawCols))
      const rows  = Math.max(10, Math.min(maxCells, scale > 1 ? Math.round(rawRows / scale) : rawRows))

      const dLng = cols > 1 ? (tEast - tWest)   / (cols - 1) : 0
      const dLat = rows > 1 ? (tNorth - tSouth)  / (rows - 1) : 0

      // Amostra elevações do TIF para toda a grade
      const pts = [], elevs = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lng = tWest  + c * dLng
          const lat = tSouth + r * dLat
          pts.push([lng, lat])
          elevs.push(tifElevAt(meta, lat, lng) ?? 0)
        }
      }

      const valid = elevs.filter(v => v > -500)
      if (valid.length < 4) return

      // Usa reduce em vez de spread para evitar stack overflow em arrays grandes
      let minRaw = valid[0], maxRaw = valid[0]
      for (let i = 1; i < valid.length; i++) {
        if (valid[i] < minRaw) minRaw = valid[i]
        if (valid[i] > maxRaw) maxRaw = valid[i]
      }
      const minE = Math.floor(minRaw / eq) * eq
      const maxE = Math.ceil(maxRaw  / eq) * eq

      // Limita breaks a 200 — mais que isso também causa stack overflow no isolines
      const totalBreaks = Math.round((maxE - minE) / eq) + 1
      const effectiveEq = totalBreaks > 200 ? Math.ceil((maxE - minE) / 200) : eq
      const breaks = []
      for (let lv = minE; lv <= maxE + 0.001; lv += effectiveEq) breaks.push(Math.round(lv))
      if (breaks.length < 2) return

      const ptGrid = turf.featureCollection(
        pts.map(([lng, lat], i) => turf.point([lng, lat], { elev: elevs[i] }))
      )

      const isoFC     = turf.isolines(ptGrid, breaks, { zProperty: 'elev' })
      const majorStep = eq * 5

      isoFC.features.forEach(feat => {
        const elev    = feat.properties.elev
        const isMajor = Math.round(elev) % Math.round(majorStep) === 0
        const lines   = feat.geometry.type === 'LineString'
          ? [feat.geometry.coordinates]
          : feat.geometry.coordinates

        lines.forEach(line => {
          if (line.length < 2) return
          const lls = line.map(([lng, lat]) => [lat, lng])
          L.polyline(lls, {
            color:        isMajor ? '#065f46' : '#059669',
            weight:       isMajor ? 2.2 : 0.9,
            opacity:      isMajor ? 0.92 : 0.52,
            interactive:  false,
            smoothFactor: 0.5,
          }).addTo(layer)

          if (isMajor && lls.length >= 4) {
            const mid = lls[Math.floor(lls.length / 2)]
            L.marker(mid, {
              icon: L.divIcon({
                className: '',
                html: `<span style="font-size:8px;color:#065f46;background:rgba(255,255,255,0.85);padding:0 3px;border-radius:2px;font-weight:700;pointer-events:none;white-space:nowrap">${Math.round(elev)}m</span>`,
                iconAnchor: [14, 6],
              }),
              interactive: false,
              zIndexOffset: -400,
            }).addTo(layer)
          }
        })
      })
    } catch (err) {
      console.error('[TIF Curvas]', err)
    } finally {
      setTifCurvasLoading(false)
    }
  }

  // ── Curvas de nível reais — DEM Terrarium + turf.isolines ───
  async function gerarCurvasNivel() {
    const map   = leafletRef.current
    const layer = curvasLayerRef.current
    if (!map || !layer) return

    setCurvasLoading(true)
    layer.clearLayers()

    try {
      const bounds = map.getBounds()
      const zoom   = map.getZoom()

      // Grade adaptativa por zoom
      const cols = zoom >= 15 ? 64 : zoom >= 13 ? 52 : zoom >= 11 ? 40 : 30
      const s = bounds.getSouth(), n = bounds.getNorth()
      const w = bounds.getWest(),  e = bounds.getEast()
      // Corrige proporção lat/lng para a grade ficar uniforme
      const latSpan = n - s
      const lngSpan = e - w
      const rows = Math.max(8, Math.round(cols * latSpan / Math.max(lngSpan, 0.001)))
      const dLat = latSpan / (rows - 1)
      const dLng = lngSpan / (cols - 1)

      // Pontos da grade [lng, lat]
      const pts = []
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          pts.push([w + i * dLng, s + j * dLat])
        }
      }

      // Busca elevações DEM
      const diagM = turf.distance([w, s], [e, n], { units: 'kilometers' }) * 1000
      const elevArr = await getElevationsBatchDEM(pts, diagM)

      // Preenche nulos por média dos vizinhos (evita artefatos no isolines)
      for (let k = 0; k < elevArr.length; k++) {
        if (elevArr[k] !== null) continue
        const row = Math.floor(k / cols), col = k % cols
        const nb = [
          col > 0       ? elevArr[k - 1]    : null,
          col < cols-1  ? elevArr[k + 1]    : null,
          row > 0       ? elevArr[k - cols]  : null,
          row < rows-1  ? elevArr[k + cols]  : null,
        ].filter(v => v !== null)
        elevArr[k] = nb.length ? nb.reduce((a, b) => a + b, 0) / nb.length : 0
      }

      const valid = elevArr.filter(v => v != null && v > -500)
      if (valid.length < 4) return

      const eq      = curvasEqRef.current
      const minE    = Math.floor(Math.min(...valid) / eq) * eq
      const maxE    = Math.ceil(Math.max(...valid)  / eq) * eq
      const breaks  = []
      for (let lv = minE; lv <= maxE; lv += eq) breaks.push(lv)
      if (breaks.length < 2 || breaks.length > 300) return

      // turf.isolines exige FeatureCollection<Point> com propriedade de cota
      const ptGrid = turf.featureCollection(
        pts.map(([lng, lat], idx) =>
          turf.point([lng, lat], { elev: elevArr[idx] ?? 0 })
        )
      )

      const isoFC = turf.isolines(ptGrid, breaks, { zProperty: 'elev' })
      const majorStep = eq * 5

      isoFC.features.forEach(feat => {
        const elev    = feat.properties.elev
        const isMajor = Math.round(elev) % Math.round(majorStep) === 0
        const lines   = feat.geometry.type === 'LineString'
          ? [feat.geometry.coordinates]
          : feat.geometry.coordinates

        lines.forEach(line => {
          if (line.length < 2) return
          const lls = line.map(([lng, lat]) => [lat, lng])
          L.polyline(lls, {
            color:       '#92400e',
            weight:      isMajor ? 1.8 : 0.75,
            opacity:     isMajor ? 0.82 : 0.44,
            interactive: false,
            smoothFactor: 1.2,
          }).addTo(layer)

          // Rótulo de cota nas curvas mestras
          if (isMajor && lls.length >= 6) {
            const mid = lls[Math.floor(lls.length / 2)]
            L.marker(mid, {
              icon: L.divIcon({
                className: '',
                html: `<span style="font-size:8px;color:#78350f;background:rgba(255,255,255,0.76);padding:0 2px;border-radius:2px;font-weight:700;pointer-events:none;white-space:nowrap">${Math.round(elev)}m</span>`,
                iconAnchor: [14, 6],
              }),
              interactive: false,
              zIndexOffset: -500,
            }).addTo(layer)
          }
        })
      })

      setCurvasSrc(`DEM · eq.${eq}m · z${zoom}`)
    } catch (err) {
      console.error('[Curvas DEM]', err)
    } finally {
      setCurvasLoading(false)
    }
  }

  // ── Carrega vistorias no mapa ────────────────────────────────
  async function carregarVistoriasDeclividade() {
    if (!vistoriasLayerRef.current) return
    const layerD = vistoriasLayerRef.current
    layerD.clearLayers()

    const _desenharVistoriaD = (v) => {
      const cor = v.risco === 'R4' ? '#ef4444'
                : v.risco === 'R3' ? '#f97316'
                : v.risco === 'R2' ? '#eab308'
                : '#22c55e'
      const tooltip = `<b>${v.nome || 'Vistoria'}</b><br/>Risco: ${v.risco || 'N/A'}<br/>${v.endereco || ''}`
      const rawVerts = v.area_vertices
      let vertsOk = false
      if (rawVerts) {
        try {
          const verts = typeof rawVerts === 'string' ? JSON.parse(rawVerts) : rawVerts
          if (Array.isArray(verts) && verts.length >= 2) {
            vertsOk = true
            const lls = verts.map(p => [p.lat, p.lng])
            if (verts.length === 2) {
              L.polyline(lls, { color: cor, weight: 3, opacity: 0.9 })
                .bindTooltip(tooltip, { sticky: true }).addTo(layerD)
            } else {
              L.polygon(lls, { color: '#fff', fillColor: 'transparent', fillOpacity: 0, weight: 5, opacity: 0.5, interactive: false }).addTo(layerD)
              L.polygon(lls, { color: cor, fillColor: cor, fillOpacity: 0.16, weight: 2.5 })
                .bindTooltip(tooltip, { sticky: true }).addTo(layerD)
            }
            verts.forEach((p, i) => {
              L.circleMarker([p.lat, p.lng], { radius: 5, color: '#fff', weight: 2, fillColor: cor, fillOpacity: 1 })
                .bindTooltip(`V${i + 1}`, { permanent: false, direction: 'top', offset: [0, -6] })
                .addTo(layerD)
            })
            const cLat = verts.reduce((s, p) => s + p.lat, 0) / verts.length
            const cLng = verts.reduce((s, p) => s + p.lng, 0) / verts.length
            const label = [v.risco, v.nome ? v.nome.slice(0, 18) : ''].filter(Boolean).join(' · ')
            L.marker([cLat, cLng], {
              icon: L.divIcon({
                className: '',
                html: `<div style="background:${cor};color:#fff;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.45);border:1.5px solid #fff">${label}</div>`,
                iconAnchor: [0, 0],
              }),
              interactive: false,
            }).addTo(layerD)
          }
        } catch (_) {}
      }
      if (!vertsOk && v.lat != null && v.lng != null) {
        L.circleMarker([v.lat, v.lng], { radius: 6, color: '#fff', weight: 2, fillColor: cor, fillOpacity: 1 })
          .bindTooltip(tooltip, { sticky: true }).addTo(layerD)
      }
    }

    let apiVistorias = []
    try { apiVistorias = await api.getVistorias() } catch (_) {}
    const lsVistorias = JSON.parse(localStorage.getItem('vistorias') || '[]')
    const apiIds = new Set(apiVistorias.map(v => String(v.id)))
    const merged = [...apiVistorias, ...lsVistorias.filter(v => !apiIds.has(String(v.id)))]
    merged.forEach(v => _desenharVistoriaD(v))
  }

  // ── Init mapa ────────────────────────────────────────────────
  useEffect(() => {
    if (leafletRef.current) return
    const c = CIDADES[cidade]
    const [lng, lat] = c.center
    const canvas = L.canvas({ padding: 0.5 })
    canvasRendererRef.current = canvas
    const map = L.map(mapRef.current, {
      center: [lat, lng], zoom: 13,
      zoomControl: false, doubleClickZoom: false,
      renderer: canvas,
    })
    L.control.zoom({ position: 'topright' }).addTo(map)
    L.control.scale({ metric: true, imperial: false }).addTo(map)
    tileLayerRef.current    = L.tileLayer(LAYERS[0].url, { attribution: LAYERS[0].attribution, maxZoom: LAYERS[0].maxZoom, maxNativeZoom: LAYERS[0].maxNativeZoom }).addTo(map)
    drawLayerRef.current    = L.layerGroup().addTo(map)
    resultsLayerRef.current = L.layerGroup().addTo(map)
    curvasLayerRef.current  = L.layerGroup().addTo(map)
    cotas1mLayerRef.current   = L.layerGroup().addTo(map)
    tifCurvasLayerRef.current = L.layerGroup().addTo(map)
    hillshadeLayerRef.current    = L.layerGroup().addTo(map)
    slopeOverlayLayerRef.current = L.layerGroup().addTo(map)
    elevLabelsLayerRef.current = L.layerGroup().addTo(map)
    vistoriasLayerRef.current = L.layerGroup().addTo(map)
    map.on('click',     handleClick)
    map.on('dblclick',  handleDblClick)
    map.on('mousemove', handleMouseMove)
    map.on('moveend',   () => {
      if (showCurvasRef.current) {
        if (curvasDebounceRef.current) clearTimeout(curvasDebounceRef.current)
        curvasDebounceRef.current = setTimeout(() => gerarCurvasNivel(), 700)
      }
      if (tifCurvasShowRef.current && tifMetaRef.current) {
        if (tifCurvasDebRef.current) clearTimeout(tifCurvasDebRef.current)
        tifCurvasDebRef.current = setTimeout(() => gerarTifCurvas(), 700)
      }
    })
    leafletRef.current = map
    carregarVistoriasDeclividade()
    return () => { map.remove(); leafletRef.current = null }
  }, [])

  useEffect(() => {
    if (!leafletRef.current || !tileLayerRef.current) return
    const l = LAYERS.find(l => l.id === camada)
    tileLayerRef.current.setUrl(l.url)
    tileLayerRef.current.options.maxZoom = l.maxZoom
    tileLayerRef.current.options.maxNativeZoom = l.maxNativeZoom
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
      const pd = polyDrawRef.current
      // Snap: se clicou perto do 1º vértice (≤20px) e já tem ≥3 pontos → fecha
      if (pd.vertices.length >= 3 && pd.firstMarker) {
        const firstPx = leafletRef.current.latLngToContainerPoint(pd.vertices[0])
        const clickPx = leafletRef.current.latLngToContainerPoint(e.latlng)
        const dist = Math.hypot(firstPx.x - clickPx.x, firstPx.y - clickPx.y)
        if (dist <= 22) { finalizarPoligono(); return }
      }
      addPolyVertex(e.latlng)
      return
    }

    // ── Modo normal: altitude + declividade local + orientação ──────────────
    const map = leafletRef.current
    if (!map) return
    if (clickMarkerRef.current) {
      map.removeLayer(clickMarkerRef.current)
      clickMarkerRef.current = null
    }
    const { lat, lng } = e.latlng

    const loadingMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="position:relative;display:inline-block"><div style="background:#0f172a;color:#64748b;border:2px solid #334155;padding:5px 12px;border-radius:8px;font-size:12px;font-family:monospace;white-space:nowrap;box-shadow:0 3px 12px rgba(0,0,0,0.6)">⏳ consultando…</div><div style="position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:8px solid #334155"></div></div>`,
        iconAnchor: [60, 38], iconSize: [120, 38],
      }),
      zIndexOffset: 1000,
    }).addTo(map)
    clickMarkerRef.current = loadingMarker

    // Amostra 5 pontos: centro + N/S/E/O para calcular declividade e orientação
    const OFF = 0.00025 // ~27.8m em latitude
    const pts = [
      [lng,       lat      ], // 0: centro
      [lng,       lat + OFF], // 1: Norte
      [lng,       lat - OFF], // 2: Sul
      [lng + OFF, lat      ], // 3: Leste
      [lng - OFF, lat      ], // 4: Oeste
    ]

    const mode = elevModeRef.current

    // Prioridade: TIF local → API remota
    const tifCoversPts = (() => {
      const m = tifMetaRef.current
      if (!m) return false
      return pts.every(([pLng, pLat]) => tifElevAt(m, pLat, pLng) !== null)
    })()

    const fetchClick = tifCoversPts
      ? (p) => Promise.resolve(p.map(([pLng, pLat]) => tifElevAt(tifMetaRef.current, pLat, pLng)))
      : mode === 'srtm'
        ? async (p) => {
            const locs = p.map(([lng, lat]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join('|')
            const res  = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${locs}`, { signal: AbortSignal.timeout(12000) })
            if (!res.ok) throw new Error('srtm30m HTTP ' + res.status)
            const data = await res.json()
            return (data.results || []).map(r => r?.elevation ?? null)
          }
        : async (p) => {
            try {
              return await Promise.race([
                getElevationsBatchCopernicus(p),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
              ])
            } catch { return getElevationsBatchDEMBicubic(p) }
          }

    fetchClick(pts).then(results => {
      if (clickMarkerRef.current !== loadingMarker) return
      map.removeLayer(loadingMarker)
      clickMarkerRef.current = null

      const [cen, N, S, E, W] = results
      if (cen === null || cen === undefined || cen < -500 || cen > 9000) return
      const el = (Math.round(cen * 10) / 10).toFixed(1)
      const srcLabel = tifCoversPts ? 'TIF local' : mode === 'srtm' ? 'SRTM 30m (OpenTopoData)' : 'Copernicus GLO-30'

      let slopeStr = '—', aspectStr = '—', slopeColor = '#94a3b8'
      if (N !== null && S !== null && E !== null && W !== null) {
        const dy  = OFF * 111320
        const dx  = OFF * 111320 * Math.cos(lat * Math.PI / 180)
        const gy  = (N - S) / (2 * dy)
        const gx  = (E - W) / (2 * dx)
        const sp  = Math.sqrt(gx * gx + gy * gy) * 100
        slopeStr  = sp.toFixed(1) + '%'
        const nbr = getNBRClass(sp)
        slopeColor = nbr.cor
        if (sp >= 0.2) {
          const aspDeg = ((Math.atan2(-gx, -gy) * 180 / Math.PI) + 360) % 360
          const dirs   = ['Norte','Nordeste','Leste','Sudeste','Sul','Sudoeste','Oeste','Noroeste']
          aspectStr    = dirs[Math.round(aspDeg / 45) % 8]
        }
      }

      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="position:relative;display:inline-block;min-width:162px">
            <div style="background:#0f172a;border:2px solid #38bdf8;padding:8px 13px;border-radius:10px;font-family:monospace;white-space:nowrap;box-shadow:0 4px 18px rgba(0,0,0,0.75);cursor:pointer">
              <div style="font-size:16px;font-weight:800;color:#38bdf8;margin-bottom:4px">⛰ ${el} m</div>
              <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:10px;line-height:1.5">
                <span style="color:#475569">Lat</span><span style="color:#cbd5e1">${lat.toFixed(6)}</span>
                <span style="color:#475569">Lng</span><span style="color:#cbd5e1">${lng.toFixed(6)}</span>
                <span style="color:#475569">Decliv.</span><span style="color:${slopeColor};font-weight:700">${slopeStr}</span>
                <span style="color:#475569">Orient.</span><span style="color:#a78bfa">${aspectStr}</span>
              </div>
              ${srcLabel ? `<div style="margin-top:4px;font-size:8px;color:#334155;text-align:right">${srcLabel}</div>` : ''}
            </div>
            <div style="position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:8px solid #38bdf8"></div>
          </div>`,
          iconAnchor: [81, 80],
          iconSize: [162, 80],
        }),
        zIndexOffset: 1000,
      })
      marker.on('click', () => { map.removeLayer(marker); clickMarkerRef.current = null })
      marker.addTo(map)
      clickMarkerRef.current = marker
    }).catch(() => {
      if (clickMarkerRef.current === loadingMarker) {
        map.removeLayer(loadingMarker)
        clickMarkerRef.current = null
      }
    })
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

    // ── Cota ao passar o mouse (debounce 200ms) ──────────────
    if (eleHoverDebRef.current) clearTimeout(eleHoverDebRef.current)
    eleHoverDebRef.current = setTimeout(async () => {
      try {
        const elev = await getElevationDEM(e.latlng.lat, e.latlng.lng, 16)
        if (elev !== null && elev > -500 && elev < 9000) setEleHover(Math.round(elev))
      } catch (_) {}
    }, 200)
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
    })
    if (isFirst) m.bindTooltip('Clique aqui para fechar o polígono', { direction: 'top' })
    m.addTo(drawLayerRef.current)

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
    setAngCatIdx(null)
    setSegSelecionado(null)
  }

  function limparTudo() {
    limparPoligonoPreview()
    limparMedicao()
    drawLayerRef.current?.clearLayers()
    resultsLayerRef.current?.clearLayers()
    cotas1mLayerRef.current?.clearLayers()
    drawnPolygonsRef.current = []
    setPoligono(null)
    setModoPoligono(false)
    setModoAtivo(null)
    setResultado(null)
    setMedicaoResult(null)
    setGeojsonExport(null)
    setCotas1mData(null)
    setShowCotas1m(false)
    // Curvas de nível TIF NÃO são limpas aqui — só pelo botão "Remover Curvas de Nível"
    localStorage.removeItem('declividade_poligono')
    setShowPanel(false)
    setVistoriaPolygons3D([])
    setAngCatIdx(null)
    setSegSelecionado(null)
    if (chartInstanceRef.current) { chartInstanceRef.current.destroy(); chartInstanceRef.current = null }
    setClassesVisiveis(new Set(SLOPE_CLASSES.map(c => c.label)))
  }

  // ── Exportação GeoJSON ───────────────────────────────────────
  async function exportarKMZ() {
    if (!geojsonExport) return

    const hexToKml = (hex, alpha = 'aa') => {
      const c = hex.replace('#', '')
      return `${alpha}${c.slice(4, 6)}${c.slice(2, 4)}${c.slice(0, 2)}`
    }

    const stylesKml = SLOPE_CLASSES.map(cls => {
      const id = cls.label.replace(/[^a-zA-Z0-9]/g, '_')
      return `  <Style id="s_${id}">
    <LineStyle><color>${hexToKml(cls.cor, 'ff')}</color><width>0.5</width></LineStyle>
    <PolyStyle><color>${hexToKml(cls.cor, '85')}</color></PolyStyle>
  </Style>`
    }).join('\n')

    const placemarks = geojsonExport.features.map(f => {
      const p = f.properties
      const isContorno = p.tipo === 'contorno'
      const styleId = isContorno
        ? 's_contorno'
        : `s_${SLOPE_CLASSES.find(c => c.label === p.classe)?.label.replace(/[^a-zA-Z0-9]/g, '_') || 'default'}`

      if (isContorno) {
        const coords = f.geometry.coordinates[0]
          .map(([lng, lat]) => `${lng.toFixed(7)},${lat.toFixed(7)},0`)
          .join(' ')
        const extData = `<ExtendedData>
          <Data name="area_m2"><value>${p.area_m2}</value></Data>
          <Data name="perimetro_m"><value>${p.perimetro_m}</value></Data>
          <Data name="alt_min_m"><value>${p.alt_min_m}</value></Data>
          <Data name="alt_max_m"><value>${p.alt_max_m}</value></Data>
          <Data name="pontos"><value>${p.celulas}</value></Data>
          <Data name="resolucao_m"><value>${p.resolucao_m}</value></Data>
        </ExtendedData>`
        return `  <Placemark>
    <name>Contorno da Área</name>
    <styleUrl>#s_contorno</styleUrl>
    ${extData}
    <Polygon>
      <altitudeMode>clampToGround</altitudeMode>
      <outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs>
    </Polygon>
  </Placemark>`
      }

      const [lng, lat] = f.geometry.coordinates
      const extData = `<ExtendedData>
          <Data name="declividade_pct"><value>${p.declividade_pct}</value></Data>
          <Data name="declividade_grau"><value>${p.declividade_grau}</value></Data>
          <Data name="classe"><value>${p.classe}</value></Data>
          <Data name="descricao"><value>${p.descricao}</value></Data>
          <Data name="elev_m"><value>${p.elev_m}</value></Data>
        </ExtendedData>`
      return `  <Placemark>
    <name>${p.classe} — ${p.declividade_pct}%</name>
    <styleUrl>#${styleId}</styleUrl>
    ${extData}
    <Point>
      <altitudeMode>clampToGround</altitudeMode>
      <coordinates>${lng.toFixed(7)},${lat.toFixed(7)},${p.elev_m || 0}</coordinates>
    </Point>
  </Placemark>`
    }).join('\n')

    const date = new Date().toISOString().slice(0, 10)
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Declividade — GeoVistorias ${date}</name>
    <description>Análise de declividade — Defesa Civil Ouro Branco / Congonhas MG</description>
${stylesKml}
  <Style id="s_contorno">
    <LineStyle><color>fffa78fa</color><width>2.5</width></LineStyle>
    <PolyStyle><color>00000000</color><fill>0</fill></PolyStyle>
  </Style>
  <Folder>
    <name>Declividade ${date}</name>
${placemarks}
  </Folder>
  </Document>
</kml>`

    const zip  = new JSZip()
    zip.file('doc.kml', kml)
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `declividade_${date}.kmz`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Análise do polígono ──────────────────────────────────────
  // ── Elevação do TIF local (prioritário) ou Copernicus GLO-30 ──
  // Retorna { elevations[], source } igual às funções fetchElevWith*.
  // Se tifMetaRef não existe ou cobertura < 40%, usa Copernicus GLO-30.
  async function fetchElevWithTifOrDEM(points, extentM = null) {
    const meta = tifMetaRef.current
    if (!meta) return fetchElevWithCopernicus(points, extentM)

    const elevs = points.map(([lng, lat]) => tifElevAt(meta, lat, lng))
    const covered = elevs.filter(e => e !== null).length
    const ratio   = covered / points.length

    if (ratio >= 0.95) {
      const avg = elevs.reduce((s, e) => s + (e ?? 0), 0) / points.length
      return { elevations: elevs.map(e => e ?? avg), source: 'TIF local' }
    }

    if (ratio >= 0.4) {
      const nullIdxs = []
      elevs.forEach((e, i) => { if (e === null) nullIdxs.push(i) })
      const { elevations: apiElevs } = await fetchElevWithCopernicus(nullIdxs.map(i => points[i]), extentM)
      nullIdxs.forEach((i, j) => { elevs[i] = apiElevs[j] })
      return { elevations: elevs.map(e => e ?? 0), source: 'TIF + Copernicus' }
    }

    return fetchElevWithCopernicus(points, extentM)
  }

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

      // 3. Grade sempre 5 m/ponto — sem limite de tamanho
      const CELL_M = 5
      const GCOLS  = Math.max(4, Math.ceil(bboxW / CELL_M) + 1)
      const GROWS  = Math.max(4, Math.ceil(bboxH / CELL_M) + 1)

      // 4. Gera grade completa sobre o bbox
      const gridPts = []
      for (let row = 0; row < GROWS; row++) {
        for (let col = 0; col < GCOLS; col++) {
          const lng = bbox[0] + (GCOLS > 1 ? col / (GCOLS - 1) : 0.5) * (bbox[2] - bbox[0])
          const lat = bbox[1] + (GROWS > 1 ? row / (GROWS - 1) : 0.5) * (bbox[3] - bbox[1])
          gridPts.push({ lng, lat, row, col })
        }
      }

      // 5. Busca elevações da grade (TIF local se disponível, senão DEM Terrarium)
      const gridCoords = gridPts.map(p => [p.lng, p.lat])
      const bboxDiagM  = Math.sqrt(bboxW ** 2 + bboxH ** 2)
      const { elevations: gridElevs, source: elevSrc } = await fetchElevWithTifOrDEM(gridCoords, bboxDiagM)
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

      // 7. Busca elevações das arestas (TIF local se disponível, senão DEM)
      const { elevations: edgeElevsAll } = await fetchElevWithTifOrDEM(edgeSamplePts, bboxDiagM)

      // 7b. Elevações dos vértices (primeiro ponto de cada aresta = o próprio vértice)
      const vertexElevs = []
      let vertOff = 0
      edgeMeta.forEach(({ nSamples }) => {
        vertexElevs.push(Math.round(edgeElevsAll[vertOff] ?? minElev))
        vertOff += nSamples
      })

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

      // 9. Ponto por ponto — circleMarker colorido por declividade (sem quadradinhos)
      const classCounts = Object.fromEntries(SLOPE_CLASSES.map(c => [c.label, 0]))
      const segmentos   = []
      let drawnCount    = 0
      const geojsonFeatures = []

      for (let row = 0; row < GROWS; row++) {
        for (let col = 0; col < GCOLS; col++) {
          const p  = gridPts[row * GCOLS + col]
          if (!p.inside) continue

          const pR = col < GCOLS - 1 ? gridPts[row * GCOLS + col + 1]     : null
          const pU = row < GROWS - 1 ? gridPts[(row + 1) * GCOLS + col]   : null
          const pL = col > 0         ? gridPts[row * GCOLS + col - 1]     : null
          const pD = row > 0         ? gridPts[(row - 1) * GCOLS + col]   : null

          const dhX = pR ? Math.abs(pR.elev - p.elev) : (pL ? Math.abs(p.elev - pL.elev) : 0)
          const dhY = pU ? Math.abs(pU.elev - p.elev) : (pD ? Math.abs(p.elev - pD.elev) : 0)
          const dx  = pR ? turf.distance([p.lng, p.lat], [pR.lng, pR.lat], { units: 'kilometers' }) * 1000
                    : (pL ? turf.distance([pL.lng, pL.lat], [p.lng, p.lat], { units: 'kilometers' }) * 1000 : CELL_M)
          const dy  = pU ? turf.distance([p.lng, p.lat], [pU.lng, pU.lat], { units: 'kilometers' }) * 1000
                    : (pD ? turf.distance([pD.lng, pD.lat], [p.lng, p.lat], { units: 'kilometers' }) * 1000 : CELL_M)

          const slopePct = Math.sqrt((dhX / Math.max(dx, 0.1)) ** 2 + (dhY / Math.max(dy, 0.1)) ** 2) * 100
          const classif  = classifySlope(slopePct)
          classCounts[classif.label] = (classCounts[classif.label] || 0) + 1
          drawnCount++
          p.slopePct = slopePct
          segmentos.push({ slopePct, slopeGrau: Math.atan(slopePct / 100) * (180 / Math.PI), classif })

          const dot = L.circleMarker([p.lat, p.lng], {
            radius: 3.5, color: classif.cor, fillColor: classif.cor, fillOpacity: 0.85, weight: 0,
            renderer: canvasRendererRef.current,
          }).bindTooltip(`${classif.label} · ${slopePct.toFixed(1)}% · ${(Math.atan(slopePct / 100) * 180 / Math.PI).toFixed(1)}° · ${p.elev} m`, { sticky: true })
          dot.addTo(resultsLayerRef.current)
          drawnPolygonsRef.current.push({ layer: dot, classLabel: classif.label, row, col })

          geojsonFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            properties: {
              declividade_pct:  parseFloat(slopePct.toFixed(2)),
              declividade_grau: parseFloat((Math.atan(slopePct / 100) * 180 / Math.PI).toFixed(2)),
              classe:           classif.label,
              descricao:        classif.desc,
              cor:              classif.cor,
              elev_m:           p.elev,
            },
          })
        }
      }

      elevLabelsLayerRef.current?.clearLayers()

      // Adiciona o contorno do polígono como feature separada
      geojsonFeatures.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          tipo:         'contorno',
          area_m2:      Math.round(turf.area(turfPoly)),
          perimetro_m:  Math.round(lateralDists.reduce((s, d) => s + d.dist, 0)),
          alt_min_m:    minElev,
          alt_max_m:    maxElev,
          celulas:      drawnCount,
          resolucao_m:  CELL_M,
          gerado_em:    new Date().toISOString(),
        },
      })

      setGeojsonExport({ type: 'FeatureCollection', features: geojsonFeatures })

      // 10. Curvas de nível (isolines Turf) sobre a grade + dados para cotas 1m
      const turfPts1m = turf.featureCollection(
        gridPts.map(p => turf.point([p.lng, p.lat], { elevation: p.elev }))
      )
      // Armazena para o toggle "Cotas 1m"
      setCotas1mData({ turfPts: turfPts1m, minElev, maxElev })
      setShowCotas1m(false)

      try {
        const breaks = []
        for (let e = Math.ceil(minElev / interval) * interval; e <= maxElev; e += interval) breaks.push(e)
        if (breaks.length >= 2) {
          const isoLines = turf.isolines(turfPts1m, breaks, { zProperty: 'elevation' })
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
        return { x, y: p.elev, z, inside: p.inside, slopePct: p.slopePct }
      })

      // 13b. Vértices do polígono em coordenadas 3D locais com elevação real
      const polyVerts3D = vertices.map((v, i) => {
        const x = turf.distance(origin, [v.lng, origin[1]], { units: 'kilometers' }) * 1000
        const z = turf.distance(origin, [origin[0], v.lat], { units: 'kilometers' }) * 1000
        return { x, y: vertexElevs[i] ?? minElev, z }
      })

      const segMaxSlope  = segmentos.length > 0 ? segmentos.reduce((a, b) => a.slopePct > b.slopePct ? a : b) : null
      const totalCells   = Object.values(classCounts).reduce((s, v) => s + v, 0)
      const perimeterM   = Math.round(lateralDists.reduce((s, d) => s + d.dist, 0))
      const areaM2       = Math.round(turf.area(turfPoly))

      localStorage.setItem('declividade_poligono', JSON.stringify(vertices))
      setModoAtivo('poligono')
      setResultado({
        type: 'poligono',
        minElev, maxElev, interval,
        drawnCount, classCounts, totalCells,
        segMaxSlope, allCrossings, lateralDists,
        perimeterM, areaM2,
        grid3D: { points: grid3D, cols: GCOLS, rows: GROWS, minE: minElev, maxE: maxElev, polyVerts: polyVerts3D, bbox },
        elevSource: elevSrc ?? 'DEM remoto',
      })

      // ── Polígonos de vistória para overlay 3D (com elevação real e casa 3D) ─
      ;(async () => {
        try {
          let apiVistorias = []
          try { apiVistorias = await api.getVistorias() } catch (_) {}
          const lsVistorias = JSON.parse(localStorage.getItem('vistorias') || '[]')
          const apiIds = new Set(apiVistorias.map(v => String(v.id)))
          const allVistorias = [...apiVistorias, ...lsVistorias.filter(v => !apiIds.has(String(v.id)))]

          const polys = []
          const pad = 0.005
          allVistorias.forEach(v => {
            if (!v.area_vertices) return
            try {
              const verts = typeof v.area_vertices === 'string' ? JSON.parse(v.area_vertices) : v.area_vertices
              if (!Array.isArray(verts) || verts.length < 3) return
              const inBbox = verts.some(p =>
                p.lng >= bbox[0] - pad && p.lng <= bbox[2] + pad &&
                p.lat >= bbox[1] - pad && p.lat <= bbox[3] + pad
              )
              if (!inBbox) return
              // Verificação precisa: pelo menos um vértice dentro do polígono desenhado
              const algumDentro = verts.some(p =>
                turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), turfPoly)
              )
              if (!algumDentro) return

              const verts3D = verts.map(p => {
                const sx = turf.distance(origin, [p.lng, origin[1]], { units: 'kilometers' }) * 1000
                const sz = turf.distance(origin, [origin[0], p.lat], { units: 'kilometers' }) * 1000
                const sy = interpolateElevFromGrid(sx, sz, grid3D, GCOLS, GROWS)
                return { x: sx, y: sy, z: sz }
              })
              const cor = v.risco === 'R4' ? '#ef4444' : v.risco === 'R3' ? '#f97316'
                        : v.risco === 'R2' ? '#eab308' : '#22c55e'

              // ── Converter anomalias do espaço local (Edificio3D) → terreno ──
              let anomaliasTerreno = []
              let paredesTerreno   = []
              try {
                const construcoes = v.construcoes
                  ? (typeof v.construcoes === 'string' ? JSON.parse(v.construcoes) : v.construcoes)
                  : []
                if (Array.isArray(construcoes) && construcoes.length > 0) {
                  // Mesma fórmula de buildLocalPts no Edificio3D
                  const ref = verts[0]
                  const R_earth = 6371000
                  const cosLat  = Math.cos(ref.lat * Math.PI / 180)
                  const rawPts  = verts.map(vv => ({
                    x: (vv.lng - ref.lng) * cosLat * Math.PI / 180 * R_earth,
                    z: -(vv.lat - ref.lat) * Math.PI / 180 * R_earth,
                  }))
                  const cx_raw  = rawPts.reduce((s, p) => s + p.x, 0) / rawPts.length
                  const cz_raw  = rawPts.reduce((s, p) => s + p.z, 0) / rawPts.length
                  const maxR_ed = Math.max(...rawPts.map(p => Math.sqrt((p.x - cx_raw) ** 2 + (p.z - cz_raw) ** 2)), 0.1)
                  const scale_ed = 12 / maxR_ed
                  // Centróide do imóvel em coordenadas de terreno (antes do flip X)
                  const csx = verts3D.reduce((s, vv) => s + vv.x, 0) / verts3D.length
                  const csz = verts3D.reduce((s, vv) => s + vv.z, 0) / verts3D.length
                  const altH_ed = Math.max(parseFloat(v.alturaImovel || 3) * 1.1, 2.5)

                  anomaliasTerreno = construcoes
                    .filter(a => a?.point)
                    .map(a => ({
                      nome:  a.nome || 'Anomalia',
                      sx:    csx + a.point.x / scale_ed,
                      sz:    csz - a.point.z / scale_ed,
                      yFrac: Math.max(0, Math.min(1, a.point.y / altH_ed)),
                    }))

                  paredesTerreno = construcoes
                    .filter(a => a?.type === 'parede-anomalia' && a?.startPoint && a?.endPoint)
                    .map(a => ({
                      nome:       a.nome || 'P',
                      startSx:    csx + a.startPoint.x / scale_ed,
                      startSz:    csz - a.startPoint.z / scale_ed,
                      endSx:      csx + a.endPoint.x   / scale_ed,
                      endSz:      csz - a.endPoint.z   / scale_ed,
                      yBaseFrac:  Math.max(0, Math.min(1, (a.startPoint.y || 0) / altH_ed)),
                      wallFrac:   Math.max(0.05, Math.min(1, (a.floorHeight || altH_ed) / altH_ed)),
                    }))
                }
              } catch (_) {}

              // ── Edificação (gpsVerts) → coordenadas de terreno ──
              let edificacaoVerts = null
              let edificacaoAltura = null
              try {
                const edifRaw = v.edificacao_planta
                if (edifRaw) {
                  const edif = typeof edifRaw === 'string' ? JSON.parse(edifRaw) : edifRaw
                  if (edif?.gpsVerts?.length >= 3) {
                    edificacaoVerts = edif.gpsVerts.map(p => {
                      const sx = turf.distance(origin, [p.lng, origin[1]], { units: 'kilometers' }) * 1000
                      const sz = turf.distance(origin, [origin[0], p.lat], { units: 'kilometers' }) * 1000
                      const sy = interpolateElevFromGrid(sx, sz, grid3D, GCOLS, GROWS)
                      return { x: sx, y: sy, z: sz }
                    })
                    edificacaoAltura = edif.altura ? parseFloat(edif.altura) : (v.alturaImovel ? parseFloat(v.alturaImovel) : null)
                  }
                }
              } catch (_) {}

              polys.push({
                verts: verts3D, cor,
                nome: v.nome || 'Vistoria',
                risco: v.risco || '—',
                areaM2: v.area_m2 || null,
                alturaImovel: v.alturaImovel ? parseFloat(v.alturaImovel) : null,
                anomalias: anomaliasTerreno,
                paredes: paredesTerreno,
                edificacaoVerts,
                edificacaoAltura,
              })
            } catch (_) {}
          })
          setVistoriaPolygons3D(polys)

          // ── Marcadores de anomalias do Monitoramento no 3D ──
          try {
            const respMon = await fetch(`${API_BASE}/monitoramento`)
            const imoveis = respMon.ok ? await respMon.json() : []
            const monMarkers = []
            const padMon = 0.008
            imoveis.forEach(imovel => {
              if (!imovel.latitude || !imovel.longitude) return
              const lat = parseFloat(imovel.latitude)
              const lng = parseFloat(imovel.longitude)
              const inBbox = lng >= bbox[0] - padMon && lng <= bbox[2] + padMon &&
                             lat >= bbox[1] - padMon && lat <= bbox[3] + padMon
              if (!inBbox) return
              // Coleta todos os códigos de trinca (T1, T2, T3…) de fotos e relatórios
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
              const mx = turf.distance(origin, [lng, origin[1]], { units: 'kilometers' }) * 1000
              const mz = turf.distance(origin, [origin[0], lat], { units: 'kilometers' }) * 1000
              const my = interpolateElevFromGrid(mx, mz, grid3D, GCOLS, GROWS)
              // Converter vertices_casa p/ coordenadas métricas
              const vcRaw = imovel.verticesCasa || []
              const vertsCasa3D = vcRaw.map(v => {
                const vx = turf.distance(origin, [parseFloat(v.lng), origin[1]], { units: 'kilometers' }) * 1000
                const vz = turf.distance(origin, [origin[0], parseFloat(v.lat)], { units: 'kilometers' }) * 1000
                const vy = interpolateElevFromGrid(vx, vz, grid3D, GCOLS, GROWS)
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
            setMonitoramentoMarkers3D(monMarkers)
          } catch (_) {}
        } catch (_) {}
      })()

    } catch (e) {
      setResultado({ erro: e.message })
    } finally {
      setCarregando(false)
    }
  }

  // ── Cursor no mapa sincronizado com o perfil longitudinal ────
  function handleProfileCursorMove(dist) {
    const tLine = profileTLineRef.current
    const drawLayer = drawLayerRef.current
    if (!tLine || !drawLayer) return
    if (dist === null) {
      if (profileCursorMarkerRef.current) {
        drawLayer.removeLayer(profileCursorMarkerRef.current)
        profileCursorMarkerRef.current = null
      }
      return
    }
    const coord = pointAlongLine(tLine, dist)
    const latlng = [coord[1], coord[0]]
    if (profileCursorMarkerRef.current) {
      profileCursorMarkerRef.current.setLatLng(latlng)
    } else {
      profileCursorMarkerRef.current = L.circleMarker(latlng, {
        radius: 9,
        fillColor: '#fbbf24',
        color: '#0f172a',
        fillOpacity: 0.92,
        weight: 2.5,
        interactive: false,
      }).addTo(drawLayer)
    }
  }

  // ── Export CSV do perfil longitudinal ───────────────────────
  function exportarPerfilCSV() {
    const perfil = medicaoResult?.perfil
    if (!perfil) return
    const rows = ['distancia,altitude',
      ...perfil.map(p => `${p.dist.toFixed(1)},${p.elev.toFixed(2)}`)
    ].join('\n')
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([rows], { type: 'text/csv;charset=utf-8' })),
      download: `perfil_longitudinal_${new Date().toISOString().slice(0,10)}.csv`,
    })
    a.click()
  }

  function exportarPerfilGeoJSON() {
    const perfil = medicaoResult?.perfil
    const tLine  = profileTLineRef.current
    if (!perfil || !tLine) return
    const features = perfil.map(p => {
      const [cx, cy] = pointAlongLine(tLine, p.dist)
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [parseFloat(cx.toFixed(7)), parseFloat(cy.toFixed(7)), parseFloat(p.elev.toFixed(2))] },
        properties: { distancia_m: parseFloat(p.dist.toFixed(1)), altitude_m: parseFloat(p.elev.toFixed(2)) },
      }
    })
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], { type: 'application/json' })),
      download: `perfil_longitudinal_${new Date().toISOString().slice(0,10)}.geojson`,
    })
    a.click()
  }

  // ── Cálculo declividade (2 pontos — modo Medir) ──────────────
  async function calcularDeclividade(pt1, pt2) {
    setCarregandoMedir(true)
    setMedicaoResult(null)
    try {
      const tLine      = turf.lineString([[pt1.lng, pt1.lat], [pt2.lng, pt2.lat]])
      const distHorizM = turf.length(tLine, { units: 'kilometers' }) * 1000

      // Salva a linha para uso do cursor no mapa
      profileTLineRef.current = tLine

      // ── 1) Amostra de elevação: TIF (quando curvas ativas) ou API DEM ──
      let rawElevs, elevSource, apiDists
      const tifMeta   = tifMetaRef.current
      const useTifNow = tifMeta && tifCurvasShowRef.current   // usa TIF apenas quando curvas estão visíveis

      if (useTifNow) {
        // 1 ponto por metro direto do TIF — sem suavização, preserva taludes e variações reais
        const nPts = Math.max(2, Math.min(Math.round(distHorizM) + 1, 5000))
        apiDists = Array.from({ length: nPts }, (_, i) =>
          i === nPts - 1 ? distHorizM : (i / (nPts - 1)) * distHorizM
        )
        rawElevs = apiDists.map(d => {
          const [lng, lat] = pointAlongLine(tLine, d)
          return tifElevAt(tifMeta, lat, lng)
        })
        // Interpola linealmente os nulls (pontos fora da borda do TIF)
        for (let i = 0; i < rawElevs.length; i++) {
          if (rawElevs[i] === null) {
            let lo = i - 1, hi = i + 1
            while (lo >= 0 && rawElevs[lo] === null) lo--
            while (hi < rawElevs.length && rawElevs[hi] === null) hi++
            const vlo = lo >= 0 ? rawElevs[lo] : null
            const vhi = hi < rawElevs.length ? rawElevs[hi] : null
            rawElevs[i] = (vlo !== null && vhi !== null)
              ? vlo + (vhi - vlo) * (i - lo) / (hi - lo)
              : (vlo ?? vhi ?? 0)
          }
        }
        elevSource = 'TIF local'
      } else {
        // Amostra em intervalos exatos de perfilStep metros — sem densificação posterior
        const stepM      = perfilStepRef.current   // 1, 2, 5 ou 10 m
        const nApiPts    = Math.max(2, Math.min(Math.ceil(distHorizM / stepM) + 1, 2000))
        const apiCoords  = []
        apiDists = []
        for (let i = 0; i < nApiPts; i++) {
          const d = Math.min(i * stepM, distHorizM)
          apiCoords.push(pointAlongLine(tLine, d))
          apiDists.push(d)
        }
        // Garante ponto final exato
        if (apiDists[apiDists.length - 1] < distHorizM - 0.01) {
          apiCoords.push(pointAlongLine(tLine, distHorizM))
          apiDists.push(distHorizM)
        }
        const fetchProfileFn = elevModeRef.current === 'srtm'
          ? fetchElevWithSRTM
          : fetchElevWithCopernicus
        ;({ elevations: rawElevs, source: elevSource } = await fetchProfileFn(apiCoords, distHorizM))
      }

      // ── 2) Pós-processamento: preserva quebras abruptas (taludes, barragens) ──────
      // COP30 não tem ruído de quantização como Terrarium, então não precisa SG pesado.
      // Aplica suavização mínima (janela=3) só em trechos planos; quebras >1 m/m ficam intactas.
      let denseDists = apiDists
      let denseElevs = (() => {
        const e = rawElevs.slice()
        const BREAK_GRAD = 1.0  // m de desnível por metro de distância = talude real
        for (let i = 1; i < e.length - 1; i++) {
          const dt0 = Math.max(denseDists[i] - denseDists[i - 1], 0.01)
          const dt1 = Math.max(denseDists[i + 1] - denseDists[i], 0.01)
          const g0  = Math.abs(e[i] - e[i - 1]) / dt0
          const g1  = Math.abs(e[i + 1] - e[i]) / dt1
          // Só suaviza (média simples dos 3) se gradiente baixo nos dois lados
          if (g0 < BREAK_GRAD && g1 < BREAK_GRAD) {
            e[i] = (rawElevs[i - 1] + rawElevs[i] + rawElevs[i + 1]) / 3
          }
        }
        return e
      })()

      // ── 3) Cotas e métricas globais ───────────────────────────────
      const cotaA    = parseFloat(denseElevs[0].toFixed(1))
      const cotaB    = parseFloat(denseElevs[denseElevs.length - 1].toFixed(1))
      const deltaH   = parseFloat(Math.abs(cotaB - cotaA).toFixed(1))
      const slopePct  = distHorizM > 0 ? (Math.abs(cotaB - cotaA) / distHorizM) * 100 : 0
      const slopeGrau = Math.atan(Math.abs(cotaB - cotaA) / distHorizM) * (180 / Math.PI)
      const classif   = classifySlope(slopePct)

      // ── 4) Perfil com 1 decimal (para o gráfico ondulado) ────────
      const perfil = denseDists.map((d, i) => ({
        dist: parseFloat(d.toFixed(1)),
        elev: parseFloat(denseElevs[i].toFixed(1)),
      }))

      // ── 5) Segmentos usando o passo escolhido pelo usuário ──────────────
      const STEP = perfilStepRef.current
      const segmentos10m = calcSegmentos(denseElevs, denseDists, STEP)

      // Pontos críticos ≥ 20%, top 30
      const criticos = [...segmentos10m]
        .filter(s => s.slope >= 20)
        .sort((a, b) => b.slope - a.slope)
        .slice(0, 30)

      // Marca pontos críticos no mapa
      const layer = drawLayerRef.current
      if (layer) {
        criticos.forEach((s, idx) => {
          const coord = pointAlongLine(tLine, s.midDist)
          L.circleMarker([coord[1], coord[0]], {
            radius: idx === 0 ? 9 : 6,
            fillColor: s.classif.cor,
            color: '#0f172a',
            fillOpacity: 0.9,
            weight: 2,
          })
            .bindTooltip(
              `⚠ ${s.slope.toFixed(1)}% · ${s.classif.label}<br>` +
              `Δh = ${s.dh} m em 1 m<br>` +
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

      // ── 6) Zonas de vistorias que a linha de Medir atravessa ─────
      let vistoriaZonesMedir = []
      try {
        let apiVist = []
        try { apiVist = await api.getVistorias() } catch (_) {}
        const lsVist   = JSON.parse(localStorage.getItem('vistorias') || '[]')
        const apiIds   = new Set(apiVist.map(v => String(v.id)))
        const allVist  = [...apiVist, ...lsVist.filter(v => !apiIds.has(String(v.id)))]

        allVist.forEach(v => {
          if (!v.area_vertices) return
          try {
            const verts = typeof v.area_vertices === 'string'
              ? JSON.parse(v.area_vertices) : v.area_vertices
            if (!Array.isArray(verts) || verts.length < 3) return

            const ring     = [...verts.map(p => [p.lng, p.lat]), [verts[0].lng, verts[0].lat]]
            const turfPoly = turf.polygon([ring])
            const polyLine = turf.polygonToLine(turfPoly)

            const pt1Inside = turf.booleanPointInPolygon(turf.point([pt1.lng, pt1.lat]), turfPoly)
            const pt2Inside = turf.booleanPointInPolygon(turf.point([pt2.lng, pt2.lat]), turfPoly)

            const intersects = turf.lineIntersect(tLine, polyLine)
            const crossDists = intersects.features
              .map(f => {
                const snap = turf.nearestPointOnLine(tLine, f, { units: 'kilometers' })
                return snap.properties.location * 1000
              })
              .filter(d => d >= 0 && d <= distHorizM)

            // Montar todos os limites candidatos e ordenar
            const allD = [...crossDists]
            if (pt1Inside) allD.push(0)
            if (pt2Inside) allD.push(distHorizM)
            const sorted = [...new Set(allD.map(d => parseFloat(d.toFixed(1))))].sort((a, b) => a - b)

            if (sorted.length < 2 && !(pt1Inside && pt2Inside)) return

            // Se a linha inteira está dentro do polígono
            if (pt1Inside && pt2Inside && sorted.length < 2) {
              const cor = v.risco === 'R4' ? '#ef4444' : v.risco === 'R3' ? '#f97316'
                        : v.risco === 'R2' ? '#eab308' : '#22c55e'
              vistoriaZonesMedir.push({ nome: v.nome || 'Vistoria', risco: v.risco || '—', cor, d0: 0, d1: distHorizM })
              return
            }

            // Para cada par consecutivo, verificar se o ponto médio está dentro
            for (let i = 0; i < sorted.length - 1; i++) {
              const mid   = (sorted[i] + sorted[i + 1]) / 2
              const midPt = pointAlongLine(tLine, mid)
              if (turf.booleanPointInPolygon(turf.point(midPt), turfPoly)) {
                const cor = v.risco === 'R4' ? '#ef4444' : v.risco === 'R3' ? '#f97316'
                          : v.risco === 'R2' ? '#eab308' : '#22c55e'
                vistoriaZonesMedir.push({
                  nome: v.nome || 'Vistoria',
                  risco: v.risco || '—',
                  cor,
                  d0: sorted[i],
                  d1: sorted[i + 1],
                })
              }
            }
          } catch (_) {}
        })
      } catch (_) {}

      setModoAtivo('medir')
      setMedicaoResult({
        coordA: { lat: pt1.lat, lng: pt1.lng },
        coordB: { lat: pt2.lat, lng: pt2.lng },
        cotaA, cotaB, deltaH,
        distHorizM: parseFloat(distHorizM.toFixed(1)),
        slopePct, slopeGrau, classif, perfil,
        segmentos10m, criticos,
        nPts: denseDists.length, stepM: STEP, elevSource,
        vistoriaZonesMedir,
      })
    } catch (e) {
      setMedicaoResult({ erro: e.message })
    } finally {
      setCarregandoMedir(false)
    }
  }

  const isLoading = carregando || carregandoMedir
  const poligonoFechado = !!poligono

  const hintMsg = carregandoMedir
    ? '⏳ Buscando cotas de elevação…'
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
                : 'Escolha Medir ou Polígono para delimitar a área de análise'

  return (
    <>
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f8fafc' }}>
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

              {/* ── Labels de altitude nos pontos ── */}
              {cotas1mData && (
                <button
                  className={`${styles.layerBtn} ${showElevLabels ? styles.layerBtnActive : ''}`}
                  onClick={() => setShowElevLabels(v => !v)}
                  title="Exibir altitude (m) em cada ponto de grade do polígono"
                  style={showElevLabels ? { borderColor: '#f97316', color: '#7c2d12', background: '#ffedd5' } : {}}
                >
                  🏷️ Alt. Pontos
                </button>
              )}

              {/* ── Cotas 1m dentro do polígono ── */}
              {cotas1mData && (
                <button
                  className={`${styles.layerBtn} ${showCotas1m ? styles.layerBtnActive : ''}`}
                  onClick={() => setShowCotas1m(v => !v)}
                  title="Exibir curvas de nível de 1 em 1 metro dentro do polígono (DEM Terrarium)"
                  style={showCotas1m ? { borderColor: '#1e40af', color: '#1e3a8a', background: '#dbeafe' } : {}}
                >
                  📐 Cotas 1m
                </button>
              )}
            </div>

            {/* ── Seção TIF de Elevação ─────────────────────────── */}
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 5,
              padding: '7px 9px',
              background: tifInfo ? '#f0fdf4' : '#f0f9ff',
              border: `1px solid ${tifInfo ? '#86efac' : '#bae6fd'}`,
              borderRadius: 8,
              flexShrink: 0,
            }}>
              {!tifInfo ? (
                <>
                  {/* Linha A: importar TIF local */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: '#0369a1', fontWeight: 700, whiteSpace: 'nowrap' }}>🗺️ Arquivo TIF</span>
                    <button
                      style={{
                        fontSize: 10, background: '#0284c7', color: '#fff',
                        border: 'none', borderRadius: 5, padding: '4px 10px',
                        cursor: (tifLoading || downloadingDEM) ? 'default' : 'pointer', whiteSpace: 'nowrap',
                        opacity: (tifLoading || downloadingDEM) ? 0.7 : 1, fontWeight: 600,
                      }}
                      onClick={() => tifFileInputRef.current?.click()}
                      disabled={tifLoading || downloadingDEM}
                      title="Importar arquivo GeoTIFF de elevação (WGS84) para gerar curvas de nível"
                    >
                      {tifLoading ? '⏳ Lendo…' : '+ Importar .tif'}
                    </button>
                    <input
                      ref={tifFileInputRef}
                      type="file"
                      accept=".tif,.tiff"
                      style={{ display: 'none' }}
                      onChange={e => { if (e.target.files[0]) handleTifUpload(e.target.files[0]); e.target.value = '' }}
                    />
                  </div>

                  {/* Linha B: baixar DEM via OpenTopography */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0 0' }}>
                    <span style={{ fontSize: 9, color: '#0369a1', fontWeight: 700 }}>
                      ⬇️ Baixar DEM automático (Copernicus GLO-30)
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="text"
                        value={otApiKey}
                        onChange={e => setOtApiKey(e.target.value)}
                        placeholder="API Key — portal.opentopography.org"
                        title="Chave gratuita: portal.opentopography.org/requestApiKey"
                        style={{
                          flex: 1, fontSize: 9, padding: '4px 7px', borderRadius: 5,
                          border: '1.5px solid #bae6fd', outline: 'none',
                          background: '#f0f9ff', color: '#0369a1',
                          minWidth: 0,
                        }}
                      />
                      <button
                        onClick={handleBaixarDEM}
                        disabled={downloadingDEM || tifLoading}
                        title="Baixa o DEM Copernicus GLO-30 para a área visível no mapa e salva como TIF"
                        style={{
                          fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap',
                          padding: '4px 9px', borderRadius: 5, cursor: (downloadingDEM || tifLoading) ? 'default' : 'pointer',
                          background: downloadingDEM ? '#7dd3fc' : '#0284c7',
                          border: 'none', color: '#fff',
                          opacity: (downloadingDEM || tifLoading) ? 0.7 : 1,
                          flexShrink: 0,
                        }}
                      >
                        {downloadingDEM ? '⏳ Baixando…' : '⬇️ Baixar'}
                      </button>
                    </div>
                    <span style={{ fontSize: 8, color: '#64748b', lineHeight: 1.4 }}>
                      Centralize o mapa na área desejada antes de baixar.{' '}
                      <a href="https://portal.opentopography.org/requestApiKey" target="_blank" rel="noopener noreferrer"
                        style={{ color: '#0284c7' }}>Obter chave grátis ↗</a>
                    </span>
                  </div>

                  {tifError && (
                    <span
                      style={{ fontSize: 9, color: '#dc2626', cursor: 'help', maxWidth: '100%', wordBreak: 'break-word' }}
                      title={tifError}
                    >⚠️ {tifError}</span>
                  )}
                </>
              ) : (
                <>
                  {/* Linha 1: nome do arquivo + remover */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 10, color: '#166534', fontWeight: 700, whiteSpace: 'nowrap' }}>🗺️ TIF</span>
                    <span
                      style={{ fontSize: 9, color: '#15803d', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={tifInfo.name}
                    >{tifInfo.name}</span>
                    <button
                      onClick={handleRemoverTif}
                      title="Remover arquivo TIF"
                      style={{
                        fontSize: 9, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                        background: '#fee2e2', border: '1px solid #fca5a5', color: '#dc2626',
                        flexShrink: 0,
                      }}
                    >✕</button>
                  </div>

                  {/* Linha 2: seletor de equidistância */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 9, color: '#166534', fontWeight: 600, whiteSpace: 'nowrap' }}>Intervalo:</span>
                    {[1, 5, 10, 30].map(eq => (
                      <button
                        key={eq}
                        onClick={() => setTifCurvasEq(eq)}
                        title={`Curvas de nível de ${eq} em ${eq} metro(s)`}
                        style={{
                          fontSize: 10, padding: '3px 7px', borderRadius: 5, cursor: 'pointer',
                          background:  tifCurvasEq === eq ? '#16a34a' : '#dcfce7',
                          border:      `1.5px solid ${tifCurvasEq === eq ? '#16a34a' : '#86efac'}`,
                          color:       tifCurvasEq === eq ? '#fff' : '#166534',
                          fontWeight:  tifCurvasEq === eq ? 700 : 500,
                          transition:  'all .15s',
                          flex: 1,
                        }}
                      >{eq}m</button>
                    ))}
                  </div>

                  {/* Linha 3: overlays hillshade + slope (só quando TIF carregado) */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => setShowHillshade(v => !v)}
                      disabled={overlayLoading}
                      title="Sombreamento analítico do relevo (hillshade) sobre o mapa"
                      style={{
                        flex: 1, fontSize: 10, fontWeight: 600,
                        padding: '4px 6px', borderRadius: 5, cursor: 'pointer',
                        background: showHillshade ? '#1d4ed8' : '#dbeafe',
                        border: `1.5px solid ${showHillshade ? '#1d4ed8' : '#93c5fd'}`,
                        color: showHillshade ? '#fff' : '#1e3a8a',
                        transition: 'all .15s',
                        opacity: overlayLoading ? 0.6 : 1,
                        whiteSpace: 'nowrap',
                      }}
                    >{overlayLoading ? '⏳' : showHillshade ? '☀️ Hillshade ✓' : '☀️ Hillshade'}</button>
                    <button
                      onClick={() => setShowSlopeOverlay(v => !v)}
                      disabled={overlayLoading}
                      title="Mapa de declividade colorido por classe de risco (NBR 11682)"
                      style={{
                        flex: 1, fontSize: 10, fontWeight: 600,
                        padding: '4px 6px', borderRadius: 5, cursor: 'pointer',
                        background: showSlopeOverlay ? '#b45309' : '#fef3c7',
                        border: `1.5px solid ${showSlopeOverlay ? '#b45309' : '#fcd34d'}`,
                        color: showSlopeOverlay ? '#fff' : '#78350f',
                        transition: 'all .15s',
                        opacity: overlayLoading ? 0.6 : 1,
                        whiteSpace: 'nowrap',
                      }}
                    >{overlayLoading ? '⏳' : showSlopeOverlay ? '⛰️ Slope ✓' : '⛰️ Slope'}</button>
                  </div>

                  {/* Linha 4: botão gerar / ocultar curvas */}
                  {!showTifCurvas ? (
                    <button
                      onClick={() => setShowTifCurvas(true)}
                      disabled={tifCurvasLoading}
                      style={{
                        fontSize: 11, fontWeight: 700,
                        background: tifCurvasLoading ? '#86efac' : '#16a34a',
                        color: '#fff', border: 'none', borderRadius: 6,
                        padding: '6px 0', cursor: tifCurvasLoading ? 'default' : 'pointer',
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                        transition: 'background .15s',
                      }}
                    >
                      {tifCurvasLoading ? '⏳ Gerando…' : '🗂️ Gerar Curvas de Nível'}
                    </button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{
                        fontSize: 10, fontWeight: 600, color: '#166534',
                        background: '#dcfce7', border: '1.5px solid #86efac',
                        borderRadius: 6, padding: '5px 8px',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        {tifCurvasLoading
                          ? '⏳ Atualizando…'
                          : <><span style={{ color: '#16a34a' }}>✓</span> Curvas ativas — {tifCurvasEq}m · use Medir para perfil real</>}
                      </div>
                      <button
                        onClick={() => setShowTifCurvas(false)}
                        style={{
                          fontSize: 11, fontWeight: 700, padding: '6px 0',
                          borderRadius: 6, cursor: 'pointer', width: '100%',
                          background: '#fee2e2', border: '1.5px solid #fca5a5', color: '#991b1b',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                          transition: 'background .15s',
                        }}
                      >🗑️ Remover Curvas de Nível</button>
                    </div>
                  )}
                </>
              )}
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

              {/* Separador + Resultado */}
              {(medicaoResult || resultado) && !isLoading && (
                <>
                  <span style={{ color: '#334155', fontSize: 14 }}>|</span>
                  <button
                    className={`${styles.btn} ${showPanel ? styles.btnResultadoActive : styles.btnResultado}`}
                    onClick={() => {
                      const next = !showPanel
                      setShowPanel(next)
                      if (next && modoAtivo === 'poligono' && resultado && !resultado.erro) {
                        setShow3D(true)
                      }
                    }}
                  >
                    <FiActivity size={12} />
                    Resultado
                  </button>
                </>
              )}

              {/* Limpar */}
              {(modoAtivo || modoPoligono || modoMedir || poligonoFechado) && (
                <button className={`${styles.btn} ${styles.btnClear}`} onClick={limparTudo} disabled={isLoading && !modoMedir}>
                  <FiTrash2 size={12} />
                </button>
              )}
            </div>

            {/* Seletor de fonte de elevação */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderBottom: '1px solid #1e293b' }}>
              <span style={{ fontSize: 9, color: '#475569', fontWeight: 600, letterSpacing: '0.05em', flexShrink: 0 }}>ALTITUDE VIA</span>
              {[
                { key: 'auto',   label: '🤖 Auto',           title: 'Copernicus GLO-30 com fallback automático para Terrarium' },
                { key: 'alta',   label: '🎯 Alta Precisão', title: 'Copernicus GLO-30 via OpenTopoData — 30m, mais preciso em altitude absoluta' },
                { key: 'srtm',   label: '🛰 SRTM 30m',      title: 'SRTM 30m via OpenTopoData — gratuito, sem chave de API' },
              ].map(({ key, label, title }) => (
                <button key={key} title={title}
                  onClick={() => setElevMode(key)}
                  style={{
                    fontSize: 9, padding: '2px 7px', borderRadius: 4, cursor: 'pointer',
                    fontWeight: elevMode === key ? 700 : 400,
                    background:   elevMode === key ? '#1e3a5f' : '#0f172a',
                    border:       `1px solid ${elevMode === key ? '#3b82f6' : '#1e293b'}`,
                    color:        elevMode === key ? '#93c5fd' : '#475569',
                    transition: 'all .15s',
                  }}
                >{label}</button>
              ))}
            </div>

            {/* Seletor de passo do corte longitudinal */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderBottom: '1px solid #1e293b' }}>
              <span style={{ fontSize: 9, color: '#475569', fontWeight: 600, letterSpacing: '0.05em', flexShrink: 0 }}>PASSO CORTE</span>
              {[1, 2, 5, 10, 30].map(s => (
                <button key={s}
                  onClick={() => setPerfilStep(s)}
                  title={`Amostra a cada ${s}m — sem interpolação entre pontos`}
                  style={{
                    fontSize: 9, padding: '2px 7px', borderRadius: 4, cursor: 'pointer',
                    fontWeight: perfilStep === s ? 700 : 400,
                    background:   perfilStep === s ? '#1e3a5f' : '#0f172a',
                    border:       `1px solid ${perfilStep === s ? (showTifCurvas && tifCurvasEq === s ? '#4ade80' : '#a78bfa') : '#1e293b'}`,
                    color:        perfilStep === s ? (showTifCurvas && tifCurvasEq === s ? '#4ade80' : '#c4b5fd') : '#475569',
                    transition: 'all .15s',
                  }}
                >{s}m{showTifCurvas && tifCurvasEq === s ? ' ✓' : ''}</button>
              ))}
              <span style={{ fontSize: 9, color: '#334155', marginLeft: 2 }}
                title="Quebras abruptas de terreno (taludes/barragens) são sempre preservadas">
                (COP30)
              </span>
            </div>

            <span className={`${styles.hint} ${(modoPoligono || modoMedir) ? styles.hintActive : ''} ${isLoading ? styles.hintLoading : ''}`}>
              {hintMsg}
            </span>
          </div>

          <div ref={mapRef} className={styles.mapEl} />

          {/* ── Badge de cota ao hover ── */}
          {eleHover !== null && (
            <div style={{
              position: 'absolute', bottom: 36, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(15,23,42,0.88)', border: '1px solid #334155',
              color: '#f0f9ff', borderRadius: 8, padding: '4px 14px',
              fontSize: 14, fontWeight: 700, fontFamily: 'monospace',
              pointerEvents: 'none', zIndex: 1000, letterSpacing: 1,
              boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
            }}>
              ⛰ {eleHover} m
            </div>
          )}
        </div>

        {/* ── Painel flutuante ───────────────────────────── */}
        {showPanel && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <FiActivity size={14} color="#38bdf8" />
            <span className={styles.panelTitle}>
              {modoAtivo === 'poligono' ? 'Análise de Polígono' : 'Resultado'}
            </span>
            {isLoading && <span className={styles.loadingDot} />}
            <button className={styles.panelClose} onClick={() => setShowPanel(false)} title="Fechar">✕</button>
          </div>

          <div className={styles.panelBody}>

            {/* Loading */}
            {isLoading && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>⏳</div>
                <div>{carregando ? 'Calculando grade interna, arestas e cruzamentos de curvas de nível…' : 'Calculando…'}</div>
                <div style={{ fontSize: 11, color: '#475569' }}>Copernicus GLO-30 · DEM Terrarium z16</div>
              </div>
            )}

            {/* Instruções default */}
            {!isLoading && !modoAtivo && !modoPoligono && !modoMedir && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>🗺️</div>
                <div style={{ fontWeight: 600, color: '#94a3b8' }}>Modos de análise</div>
                <div style={{ marginTop: 8 }}>
                  <b style={{ color: '#a78bfa' }}>📏 Medir</b> — marque dois pontos no mapa para calcular declividade, desnível e gerar o corte longitudinal com segmentos de 1m.
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

                {/* Seletor de resolução de célula */}
                <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                  Resolução da célula
                </div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {[
                    { m: 5,  label: '5 m',  hint: 'alta precisão — lento' },
                    { m: 10, label: '10 m', hint: 'preciso' },
                    { m: 15, label: '15 m', hint: 'equilibrado' },
                    { m: 30, label: '30 m', hint: 'padrão SRTM' },
                  ].map(({ m, label, hint }) => (
                    <button
                      key={m}
                      title={hint}
                      onClick={() => setCellSize(m)}
                      style={{
                        background:   cellSize === m ? '#7c3aed' : '#1e293b',
                        border:       `1px solid ${cellSize === m ? '#a78bfa' : '#334155'}`,
                        color:        cellSize === m ? '#ede9fe' : '#94a3b8',
                        borderRadius: 5,
                        padding:      '3px 9px',
                        fontSize:     11,
                        cursor:       'pointer',
                        fontWeight:   cellSize === m ? 700 : 400,
                        transition:   'all .15s',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 5, fontSize: 10, color: '#475569' }}>
                  {cellSize === 5  && '~96×96 células máx — tiles z=15 (~5 m/pixel)'}
                  {cellSize === 10 && '~64×64 células máx — tiles z=14 (~10 m/pixel)'}
                  {cellSize === 15 && '~48×48 células máx — tiles z=14 (~10 m/pixel)'}
                  {cellSize === 30 && '~32×32 células máx — tiles z=13 (~20 m/pixel)'}
                </div>

                <div style={{ marginTop: 8, background: '#1e293b', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#a78bfa' }}>
                  {polyDrawRef.current.vertices.length < 3
                    ? `${polyDrawRef.current.vertices.length} vértice(s) — mínimo 3`
                    : `${polyDrawRef.current.vertices.length} vértices — duplo clique para fechar`}
                </div>
              </div>
            )}

            {/* Erro */}
            {!isLoading && (resultado?.erro || medicaoResult?.erro) && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>⚠️</div>
                <div style={{ color: '#f97316' }}>{resultado?.erro || medicaoResult?.erro}</div>
              </div>
            )}

            {/* ── Resultado Medir ──────────────────────────── */}
            {!isLoading && modoAtivo === 'medir' && medicaoResult && !medicaoResult.erro && (() => {
              const segs = medicaoResult.segmentos10m || []
              const segsComAngulo = segs.map(s => ({ ...s, angDeg: segAngleDeg(s.slope) }))
              const catCounts = ANGLE_CATS.map((_, idx) =>
                segsComAngulo.filter(s => getAngleCat(s.angDeg) === idx).length
              )
              const segsAtivos = angCatIdx !== null
                ? [...segsComAngulo.filter(s => getAngleCat(s.angDeg) === angCatIdx)]
                    .sort((a, b) => b.angDeg - a.angDeg)
                : []
              return (
              <>
                {/* Source badge */}
                {medicaoResult.elevSource && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: '#38bdf8', background: '#0f1f3d', borderRadius: 4, padding: '1px 6px' }}>
                      {medicaoResult.elevSource}
                    </span>
                  </div>
                )}

                {/* Botões de categoria por ângulo */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, fontWeight: 600, letterSpacing: '0.05em' }}>
                    ÂNGULO POR TRECHO — {segs.length} segmentos de 1 m
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {ANGLE_CATS.map((cat, idx) => {
                      const count = catCounts[idx]
                      const pct = segs.length > 0 ? ((count / segs.length) * 100).toFixed(0) : '0'
                      const isActive = angCatIdx === idx
                      return (
                        <button key={idx}
                          onClick={() => { setAngCatIdx(isActive ? null : idx); setSegSelecionado(null) }}
                          disabled={count === 0}
                          style={{
                            background: isActive ? cat.cor + '22' : '#0f172a',
                            border: `1.5px solid ${isActive ? cat.cor : '#1e3a5f'}`,
                            color: isActive ? cat.cor : (count > 0 ? '#94a3b8' : '#334155'),
                            borderRadius: 8, padding: '5px 9px',
                            cursor: count > 0 ? 'pointer' : 'not-allowed',
                            opacity: count > 0 ? 1 : 0.4,
                            fontSize: 11, fontWeight: isActive ? 700 : 500,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, minWidth: 68,
                            transition: 'all 0.15s',
                          }}
                        >
                          <span style={{ fontWeight: 700, fontSize: 11 }}>{cat.label}</span>
                          <span style={{ fontSize: 11, color: isActive ? cat.cor : '#64748b' }}>{count} seg · {pct}%</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Lista de segmentos da categoria selecionada */}
                {angCatIdx !== null && segsAtivos.length > 0 && (
                  <div style={{ background: '#0a1628', border: `1px solid ${ANGLE_CATS[angCatIdx].cor}44`, borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ padding: '6px 10px', borderBottom: `1px solid ${ANGLE_CATS[angCatIdx].cor}33`, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: ANGLE_CATS[angCatIdx].cor, display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ color: ANGLE_CATS[angCatIdx].cor, fontWeight: 700, fontSize: 11 }}>
                        {ANGLE_CATS[angCatIdx].label} — {segsAtivos.length} segmento(s)
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: '#475569' }}>maior → menor</span>
                    </div>
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {segsAtivos.map((s, i) => (
                        <div key={i}
                          onClick={() => setSegSelecionado(segSelecionado?.d0 === s.d0 ? null : s)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 7,
                            padding: '5px 10px',
                            borderBottom: '1px solid #0d1f38',
                            cursor: 'pointer',
                            background: segSelecionado?.d0 === s.d0 ? ANGLE_CATS[angCatIdx].cor + '1a' : 'transparent',
                            transition: 'background 0.12s',
                          }}
                        >
                          <span style={{ fontSize: 9, color: '#475569', minWidth: 22, flexShrink: 0 }}>#{i+1}</span>
                          <span style={{ color: '#94a3b8', fontSize: 10, fontFamily: 'monospace', flex: 1 }}>
                            {s.d0.toFixed(0)}–{s.d1.toFixed(0)} m
                          </span>
                          <span style={{ color: ANGLE_CATS[angCatIdx].cor, fontWeight: 700, fontSize: 12, fontFamily: 'monospace', minWidth: 42, textAlign: 'right' }}>
                            {s.angDeg.toFixed(1)}°
                          </span>
                          <span style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace', minWidth: 38, textAlign: 'right' }}>
                            {s.slope.toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Detalhe do segmento selecionado */}
                {segSelecionado && angCatIdx !== null && (
                  <div style={{ background: '#111827', border: `1.5px solid ${ANGLE_CATS[angCatIdx].cor}66`, borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: ANGLE_CATS[angCatIdx].cor, display: 'inline-block' }} />
                      <span style={{ color: ANGLE_CATS[angCatIdx].cor, fontWeight: 700, fontSize: 11 }}>
                        Segmento {segSelecionado.d0.toFixed(0)}–{segSelecionado.d1.toFixed(0)} m desde A
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <div style={{ background: '#0f172a', borderRadius: 6, padding: '6px 9px' }}>
                        <div style={{ fontSize: 9, color: '#475569', marginBottom: 2, letterSpacing: '0.05em' }}>DECLIVIDADE</div>
                        <div style={{ fontWeight: 700, color: segSelecionado.classif.cor, fontSize: 16 }}>
                          {segSelecionado.slope.toFixed(1)}<span style={{ fontSize: 11 }}> %</span>
                        </div>
                      </div>
                      <div style={{ background: '#0f172a', borderRadius: 6, padding: '6px 9px' }}>
                        <div style={{ fontSize: 9, color: '#475569', marginBottom: 2, letterSpacing: '0.05em' }}>ÂNGULO</div>
                        <div style={{ fontWeight: 700, color: segSelecionado.classif.cor, fontSize: 16 }}>
                          {segSelecionado.angDeg.toFixed(1)}<span style={{ fontSize: 11 }}> °</span>
                        </div>
                      </div>
                      <div style={{ background: '#0f172a', borderRadius: 6, padding: '6px 9px' }}>
                        <div style={{ fontSize: 9, color: '#475569', marginBottom: 2, letterSpacing: '0.05em' }}>DESNÍVEL (Δh)</div>
                        <div style={{ fontWeight: 700, color: '#38bdf8', fontSize: 16 }}>
                          {segSelecionado.dh}<span style={{ fontSize: 11 }}> m</span>
                        </div>
                      </div>
                      <div style={{ background: '#0f172a', borderRadius: 6, padding: '6px 9px' }}>
                        <div style={{ fontSize: 9, color: '#475569', marginBottom: 2, letterSpacing: '0.05em' }}>DIST. HORIZONTAL</div>
                        <div style={{ fontWeight: 700, color: '#38bdf8', fontSize: 16 }}>
                          {(segSelecionado.d1 - segSelecionado.d0).toFixed(1)}<span style={{ fontSize: 11 }}> m</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Corte longitudinal */}
                <div>
                  <div className={styles.chartTitle}>
                    Corte Longitudinal — {medicaoResult.perfil?.length} pts &nbsp;·&nbsp;
                    <span style={{ color: '#64748b', fontWeight: 400 }}>
                      passo {medicaoResult.stepM ?? 1}m · {medicaoResult.segmentos10m?.length} segmentos
                    </span>
                    {medicaoResult.elevSource && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: '#38bdf8', background: '#0f1f3d', borderRadius: 4, padding: '1px 6px' }}>
                        {medicaoResult.elevSource}
                      </span>
                    )}
                  </div>

                  {/* Stats resumo do perfil */}
                  {(() => {
                    const perfil = medicaoResult.perfil || []
                    let ganho = 0, perda = 0
                    for (let i = 1; i < perfil.length; i++) {
                      const d = perfil[i].elev - perfil[i - 1].elev
                      if (d > 0) ganho += d; else perda += Math.abs(d)
                    }
                    const maxSlope = medicaoResult.segmentos10m?.length > 0
                      ? Math.max(...medicaoResult.segmentos10m.map(s => s.slope))
                      : null
                    const desn = medicaoResult.cotaB - medicaoResult.cotaA
                    const stats = [
                      { label: 'COMPRIMENTO',  value: medicaoResult.distHorizM >= 1000 ? `${(medicaoResult.distHorizM/1000).toFixed(3)} km` : `${medicaoResult.distHorizM} m`, color: '#38bdf8' },
                      { label: 'ALT. INICIAL A', value: `${medicaoResult.cotaA} m`, color: '#a78bfa' },
                      { label: 'ALT. FINAL B',   value: `${medicaoResult.cotaB} m`, color: '#f0abfc' },
                      { label: 'DESNÍVEL A→B',   value: `${desn >= 0 ? '+' : ''}${desn.toFixed(1)} m`, color: desn >= 0 ? '#4ade80' : '#f87171' },
                      { label: 'GANHO ↑ / PERDA ↓', value: `+${ganho.toFixed(0)} / −${perda.toFixed(0)} m`, color: '#fbbf24' },
                      { label: 'DECLIV. MÉDIA',  value: `${medicaoResult.slopePct.toFixed(2)}%`, color: medicaoResult.classif?.cor || '#94a3b8' },
                      { label: 'DECLIV. MÁX.',   value: maxSlope !== null ? `${maxSlope.toFixed(1)}%` : '—', color: maxSlope !== null ? getNBRClass(maxSlope).cor : '#475569' },
                    ]
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 8 }}>
                        {stats.map(({ label, value, color }) => (
                          <div key={label} style={{ background: '#0f172a', borderRadius: 6, padding: '5px 7px', borderLeft: `2px solid ${color}40` }}>
                            <div style={{ fontSize: 8, color: '#475569', marginBottom: 1, letterSpacing: '0.04em' }}>{label}</div>
                            <div style={{ fontWeight: 700, color, fontSize: 11, fontFamily: 'monospace' }}>{value}</div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}

                  <PerfilLongitudinal
                    perfil={medicaoResult.perfil}
                    cotaA={medicaoResult.cotaA}
                    cotaB={medicaoResult.cotaB}
                    distHorizM={medicaoResult.distHorizM}
                    cor={angCatIdx !== null ? ANGLE_CATS[angCatIdx].cor : '#a78bfa'}
                    segmentos10m={medicaoResult.segmentos10m}
                    vistoriaZones={medicaoResult.vistoriaZonesMedir}
                    segSelecionado={segSelecionado}
                    onCursorMove={handleProfileCursorMove}
                    contourInterval={showTifCurvas ? tifCurvasEq : undefined}
                  />
                </div>

                {/* Ações */}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button className={`${styles.btn} ${styles.btnMedir}`} style={{ flex: 1, justifyContent: 'center', background: '#1e3a5f', borderColor: '#3b82f6', color: '#93c5fd' }} onClick={() => setShow3D(true)}>
                    <FiBox size={12} /> Ver em 3D
                  </button>
                  <button className={`${styles.btn} ${styles.btnMedir}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => { limparMedicao(); setModoAtivo(null); setModoMedir(true) }}>
                    <FiMaximize2 size={12} /> Nova medição
                  </button>
                </div>
                {/* Exportar perfil */}
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 9, color: '#475569', marginBottom: 4, letterSpacing: '0.05em', fontWeight: 600 }}>EXPORTAR PERFIL</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className={`${styles.btn} ${styles.btnMedir}`} style={{ flex: 1, justifyContent: 'center', background: '#0f2b1a', borderColor: '#166534', color: '#4ade80', fontSize: 11 }} onClick={exportarPerfilCSV}>
                      <FiDownload size={11} /> CSV
                    </button>
                    <button className={`${styles.btn} ${styles.btnMedir}`} style={{ flex: 1, justifyContent: 'center', background: '#1a1a0f', borderColor: '#713f12', color: '#fbbf24', fontSize: 11 }} onClick={exportarPerfilGeoJSON}>
                      <FiDownload size={11} /> GeoJSON
                    </button>
                  </div>
                </div>
              </>
              )
            })()}

            {/* ── Legenda com toggle ───────────────────────── */}
            {!isLoading && modoAtivo === 'poligono' && !resultado?.erro && (
              <div>
                <div className={styles.chartTitle}>Legenda — clique para mostrar/ocultar</div>

                {/* Filtro rápido por graus */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: '#64748b', alignSelf: 'center', marginRight: 2 }}>Mostrar &ge;</span>
                  {[
                    { grau: 0,  label: 'Todos' },
                    { grau: 10, label: '10°' },
                    { grau: 17, label: '17°' },
                    { grau: 30, label: '30°' },
                    { grau: 60, label: '60°' },
                    { grau: 85, label: '85°' },
                  ].map(({ grau, label }) => {
                    const minPct = Math.tan(grau * Math.PI / 180) * 100
                    return (
                      <button key={grau} onClick={() => {
                        const next = new Set(
                          SLOPE_CLASSES
                            .filter(c => {
                              const maxPct = c.max === Infinity ? Infinity : c.max
                              return maxPct > minPct
                            })
                            .map(c => c.label)
                        )
                        setClassesVisiveis(next)
                      }} style={{
                        background: '#1e293b', border: '1px solid #334155',
                        color: '#94a3b8', borderRadius: 5, padding: '2px 7px',
                        fontSize: 10, cursor: 'pointer',
                      }}>{label}</button>
                    )
                  })}
                </div>

                <div className={styles.legendToggleList}>
                  {SLOPE_CLASSES.map(cls => {
                    const visible = classesVisiveis.has(cls.label)
                    const count   = resultado?.classCounts?.[cls.label] || 0
                    const grauMin = Math.atan(cls.max === Infinity ? 90 : (cls.max / 100)) * (180 / Math.PI)
                    return (
                      <button key={cls.label} className={`${styles.legendToggleBtn} ${visible ? styles.legendToggleBtnOn : styles.legendToggleBtnOff}`} style={{ borderColor: visible ? cls.cor : '#334155' }}
                        onClick={() => setClassesVisiveis(prev => { const next = new Set(prev); if (next.has(cls.label)) next.delete(cls.label); else next.add(cls.label); return next })}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: visible ? cls.cor : '#334155', display: 'inline-block' }} />
                        <span style={{ flex: 1, textAlign: 'left', color: visible ? cls.cor : '#475569' }}>{cls.label}</span>
                        <span style={{ color: '#64748b', fontSize: 9, fontFamily: 'monospace' }}>
                          {cls.max === Infinity ? `>${SLOPE_CLASSES[SLOPE_CLASSES.length - 2].max}%` : `${cls.max}%`} / {cls.max === Infinity ? '≥85°' : `${grauMin.toFixed(0)}°`}
                        </span>
                        <span style={{ color: visible ? '#94a3b8' : '#334155', fontSize: 10, minWidth: 16, textAlign: 'right' }}>{count > 0 ? count : ''}</span>
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
                  <div className={styles.statCard}><div className={styles.statLabel}>Desnível</div><div className={styles.statValue} style={{ color: '#fbbf24' }}>{resultado.maxElev - resultado.minElev}<span className={styles.statUnit}> m</span></div></div>
                  <div className={styles.statCard}><div className={styles.statLabel}>Perímetro</div><div className={styles.statValue}>{resultado.perimeterM >= 1000 ? (resultado.perimeterM/1000).toFixed(2) : resultado.perimeterM}<span className={styles.statUnit}> {resultado.perimeterM >= 1000 ? 'km' : 'm'}</span></div></div>
                  <div className={styles.statCard}><div className={styles.statLabel}>Área</div><div className={styles.statValue}>{resultado.areaM2 >= 10000 ? (resultado.areaM2/10000).toFixed(2) : resultado.areaM2}<span className={styles.statUnit}> {resultado.areaM2 >= 10000 ? 'ha' : 'm²'}</span></div></div>
                  {resultado.segMaxSlope && <div className={styles.statCard}><div className={styles.statLabel}>Decliv. máx</div><div className={styles.statValue} style={{ color: getNBRClass(resultado.segMaxSlope.slopePct).cor }}>{resultado.segMaxSlope.slopePct.toFixed(1)}<span className={styles.statUnit}> %</span></div></div>}
                </div>

                {/* Fonte de elevação usada na análise */}
                {resultado.elevSource && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: resultado.elevSource.startsWith('TIF') ? '#f0fdf4' : '#f8fafc',
                    border: `1px solid ${resultado.elevSource.startsWith('TIF') ? '#86efac' : '#e2e8f0'}`,
                    borderRadius: 7, padding: '5px 10px', fontSize: 10,
                  }}>
                    <span style={{ color: resultado.elevSource.startsWith('TIF') ? '#15803d' : '#475569', fontWeight: 600 }}>
                      {resultado.elevSource.startsWith('TIF') ? '🗺️' : '🌐'} Altitude via:
                    </span>
                    <span style={{ color: resultado.elevSource.startsWith('TIF') ? '#166534' : '#64748b', fontFamily: 'monospace' }}>
                      {resultado.elevSource}
                    </span>
                  </div>
                )}

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
                          <div style={{ fontSize: 10, color: nbr.cor, opacity: 0.85 }}>
                            {(Math.atan(resultado.segMaxSlope.slopePct / 100) * 180 / Math.PI).toFixed(1)}°
                          </div>
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

                {/* Exportação KMZ */}
                {geojsonExport && (
                  <button
                    onClick={exportarKMZ}
                    className={`${styles.btn} ${styles.btnMedir}`}
                    style={{ width: '100%', justifyContent: 'center', background: '#1c1535', borderColor: '#7c3aed', color: '#c4b5fd', gap: 6 }}
                    title={`${geojsonExport.features.length - 1} pontos + contorno — abre no Google Earth e QGIS`}
                  >
                    <FiDownload size={13} />
                    Exportar KMZ
                    <span style={{ fontSize: 9, color: '#a78bfa', background: '#0d0a1f', borderRadius: 4, padding: '1px 5px', marginLeft: 2 }}>
                      {geojsonExport.features.length - 1} pontos
                    </span>
                  </button>
                )}
              </>
            )}


          </div>
        </div>
        )}
      </div>
    </div>

    {/* ── Visualização 3D ────────────────────────────────── */}
    {show3D && (
      <TerrainProfile3D
        mode={modoAtivo === 'poligono' ? 'poligono' : 'medir'}
        perfil={modoAtivo === 'medir' ? medicaoResult?.perfil : undefined}
        gridData={modoAtivo === 'poligono' ? resultado?.grid3D : undefined}
        lateralDists={modoAtivo === 'poligono' ? resultado?.lateralDists : undefined}
        area={modoAtivo === 'poligono' ? resultado?.areaM2 : undefined}
        vistoriaPolygons={vistoriaPolygons3D}
        vistoriaZonesMedir={modoAtivo === 'medir' ? medicaoResult?.vistoriaZonesMedir : undefined}
        monitoramentoMarkers={modoAtivo === 'poligono' ? monitoramentoMarkers3D : undefined}
        contourInterval={showTifCurvas ? tifCurvasEq : undefined}
        onClose={() => setShow3D(false)}
      />
    )}
    </>
  )
}
