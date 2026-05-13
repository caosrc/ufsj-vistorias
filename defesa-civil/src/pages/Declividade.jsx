import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as turf from '@turf/turf'
import Chart from 'chart.js/auto'
import { CIDADES, CIDADE_PADRAO } from '../data/cidades'
import Sidebar from '../components/Sidebar'
import styles from './Declividade.module.css'
import { FiTrendingUp, FiEdit3, FiTrash2, FiActivity } from 'react-icons/fi'

const LAYERS = [
  {
    id: 'topo',
    label: 'Topografia',
    icone: '⛰️',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> © OpenStreetMap',
    maxZoom: 17,
  },
  {
    id: 'ruas',
    label: 'Ruas',
    icone: '🗺️',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  },
  {
    id: 'satelite',
    label: 'Satélite',
    icone: '🛰️',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri',
    maxZoom: 19,
  },
]

const SLOPE_CLASSES = [
  { max: 3,        label: 'Plano',           desc: 'Sem restrições ao uso',            cor: '#22c55e' },
  { max: 8,        label: 'Suave ondulado',  desc: 'Pequena limitação agrícola',        cor: '#84cc16' },
  { max: 20,       label: 'Ondulado',        desc: 'Requer práticas conservacionistas', cor: '#eab308' },
  { max: 45,       label: 'Forte ondulado',  desc: 'Uso restrito — risco de erosão',    cor: '#f97316' },
  { max: 75,       label: 'Montanhoso',      desc: 'Alto risco — evitar construções',   cor: '#ef4444' },
  { max: Infinity, label: 'Escarpado',       desc: 'Inapto — risco geológico severo',   cor: '#7c3aed' },
]

function classifySlope(pct) {
  return SLOPE_CLASSES.find(c => pct <= c.max) || SLOPE_CLASSES[SLOPE_CLASSES.length - 1]
}

// Detecta automaticamente o intervalo de curvas de nível (10 m ou 20 m)
function detectContourInterval(elevations) {
  const range = Math.max(...elevations) - Math.min(...elevations)
  if (range < 30) return 5
  if (range < 200) return 10
  return 20
}

async function fetchElevations(points) {
  const lats = points.map(p => p[1].toFixed(6)).join(',')
  const lngs = points.map(p => p[0].toFixed(6)).join(',')
  const res = await fetch(
    `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`
  )
  if (!res.ok) throw new Error('Falha ao buscar elevação')
  const data = await res.json()
  return data.elevation
}

// Encontra todos os pontos onde a linha cruza uma curva de nível específica
// e retorna a distância exata ao longo da linha (interpolação linear)
function findContourCrossings(elevations, distances, interval) {
  const minElev = Math.min(...elevations)
  const maxElev = Math.max(...elevations)
  const firstContour = Math.ceil(minElev / interval) * interval
  const lastContour  = Math.floor(maxElev / interval) * interval

  const crossings = []

  for (let cv = firstContour; cv <= lastContour; cv += interval) {
    for (let i = 0; i < elevations.length - 1; i++) {
      const e1 = elevations[i], e2 = elevations[i + 1]
      if ((e1 < cv && e2 >= cv) || (e1 > cv && e2 <= cv)) {
        const t = (cv - e1) / (e2 - e1)
        const crossDist = distances[i] + t * (distances[i + 1] - distances[i])
        crossings.push({ elevation: cv, dist: crossDist })
      }
    }
  }

  // Remover duplicados próximos (mesma curva cruzada 2x em pontos muito próximos)
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
  const chartRef         = useRef(null)
  const chartInstanceRef = useRef(null)
  const drawStateRef     = useRef({ ativo: false, pontos: [], markers: [], activeLine: null, previewLine: null })

  const [cidade,     setCidade]     = useState(CIDADE_PADRAO)
  const [camada,     setCamada]     = useState('topo')
  const [desenhando, setDesenhando] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [resultado,  setResultado]  = useState(null)

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

    const layerObj = LAYERS.find(l => l.id === 'topo')
    tileLayerRef.current = L.tileLayer(layerObj.url, {
      attribution: layerObj.attribution, maxZoom: layerObj.maxZoom,
    }).addTo(map)

    drawLayerRef.current = L.layerGroup().addTo(map)
    lineLayerRef.current = L.layerGroup().addTo(map)

    map.on('click',     handleClick)
    map.on('dblclick',  handleDblClick)
    map.on('mousemove', handleMouseMove)

    leafletRef.current = map
    return () => { map.remove(); leafletRef.current = null }
  }, [])

  // ── Trocar camada base ─────────────────────────────────────
  useEffect(() => {
    if (!leafletRef.current || !tileLayerRef.current) return
    const layerObj = LAYERS.find(l => l.id === camada)
    tileLayerRef.current.setUrl(layerObj.url)
    tileLayerRef.current.options.maxZoom = layerObj.maxZoom
  }, [camada])

  // ── Voar para cidade ───────────────────────────────────────
  useEffect(() => {
    if (!leafletRef.current) return
    const c = CIDADES[cidade]
    const [lng, lat] = c.center
    leafletRef.current.flyTo([lat, lng], 13, { duration: 1.2 })
  }, [cidade])

  // ── Cursor ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.style.cursor = desenhando ? 'crosshair' : ''
    drawStateRef.current.ativo = desenhando
    if (!desenhando) limparDesenho()
  }, [desenhando])

  // ── Eventos de mapa ────────────────────────────────────────
  function handleClick(e) {
    if (!drawStateRef.current.ativo) return
    adicionarPonto(e.latlng)
  }
  function handleDblClick(e) {
    if (!drawStateRef.current.ativo) return
    L.DomEvent.stop(e)
    finalizarLinha()
  }
  function handleMouseMove(e) {
    const state = drawStateRef.current
    if (!state.ativo || state.pontos.length === 0) return
    const ultimo = state.pontos[state.pontos.length - 1]
    if (!state.previewLine) {
      state.previewLine = L.polyline([], {
        color: '#38bdf8', weight: 1.5, dashArray: '5,5', opacity: 0.7,
      }).addTo(drawLayerRef.current)
    }
    state.previewLine.setLatLngs([ultimo, e.latlng])
  }

  function adicionarPonto(latlng) {
    const state = drawStateRef.current
    state.pontos.push(latlng)
    const m = L.circleMarker(latlng, {
      radius: 5, color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 1, weight: 2,
    }).addTo(drawLayerRef.current)
    state.markers.push(m)
    if (state.pontos.length >= 2) {
      if (state.activeLine) drawLayerRef.current.removeLayer(state.activeLine)
      state.activeLine = L.polyline(state.pontos, {
        color: '#38bdf8', weight: 2.5, opacity: 0.9,
      }).addTo(drawLayerRef.current)
    }
  }

  function finalizarLinha() {
    const state = drawStateRef.current
    if (state.pontos.length < 2) { limparDesenho(); setDesenhando(false); return }
    analisarLinha([...state.pontos])
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

  function limparTudo() {
    limparDesenho()
    lineLayerRef.current?.clearLayers()
    setResultado(null)
    if (chartInstanceRef.current) { chartInstanceRef.current.destroy(); chartInstanceRef.current = null }
  }

  // ── Análise principal com cruzamentos de curvas ────────────
  async function analisarLinha(latlngs) {
    setCarregando(true)
    setResultado(null)
    lineLayerRef.current?.clearLayers()

    try {
      const coords      = latlngs.map(p => [p.lng, p.lat])
      const line        = turf.lineString(coords)
      const totalDistKm = turf.length(line, { units: 'kilometers' })
      const totalDist   = totalDistKm * 1000

      // 1. Amostrar 100 pontos ao longo da linha para perfil denso
      const AMOSTRAS = 100
      const samplePoints = []
      const sampleDists  = []
      for (let i = 0; i <= AMOSTRAS; i++) {
        const distKm = (i / AMOSTRAS) * totalDistKm
        const pt = turf.along(line, distKm, { units: 'kilometers' })
        samplePoints.push(pt.geometry.coordinates) // [lng, lat]
        sampleDists.push((i / AMOSTRAS) * totalDist)
      }

      // 2. Buscar elevação SRTM real para todos os pontos
      const elevations = await fetchElevations(samplePoints)

      // 3. Detectar intervalo de curvas e encontrar cruzamentos
      const interval  = detectContourInterval(elevations)
      const crossings = findContourCrossings(elevations, sampleDists, interval)

      // 4. Montar lista de "marcos" = início + cruzamentos + fim
      const startElev = elevations[0]
      const endElev   = elevations[AMOSTRAS]

      const marcos = [
        { elevation: Math.round(startElev), dist: 0, tipo: 'inicio' },
        ...crossings.map(c => ({ ...c, elevation: c.elevation, tipo: 'curva' })),
        { elevation: Math.round(endElev), dist: totalDist, tipo: 'fim' },
      ]

      // 5. Calcular declividade de cada segmento entre marcos consecutivos
      const segmentos = []
      for (let i = 0; i < marcos.length - 1; i++) {
        const a = marcos[i], b = marcos[i + 1]
        const distSeg  = b.dist - a.dist
        if (distSeg < 0.5) continue // ignorar segmentos micro
        const elevDiff = Math.abs(b.elevation - a.elevation)
        const slope    = distSeg > 0 ? (elevDiff / distSeg) * 100 : 0
        const sobe     = b.elevation > a.elevation
        segmentos.push({
          de: a.elevation, para: b.elevation,
          dist: distSeg, elevDiff, slope,
          sobe, classif: classifySlope(slope),
          distAcum: b.dist,
        })
      }

      // 6. Estatísticas gerais
      const minAlt  = Math.round(Math.min(...elevations))
      const maxAlt  = Math.round(Math.max(...elevations))
      const desnivel = maxAlt - minAlt
      const slopeGlobal = totalDist > 0 ? (desnivel / totalDist) * 100 : 0
      const classifGlobal = classifySlope(slopeGlobal)

      // 7. Desenhar linha no mapa segmentada por cor de declividade
      lineLayerRef.current?.clearLayers()

      if (segmentos.length > 0) {
        // Pintar cada segmento com a cor de sua classe
        segmentos.forEach((seg, idx) => {
          const a = marcos[idx], b = marcos[idx + 1]
          const fracA = a.dist / totalDist
          const fracB = b ? (b.dist / totalDist) : 1

          const ptA = turf.along(line, fracA * totalDistKm, { units: 'kilometers' })
          const ptB = turf.along(line, fracB * totalDistKm, { units: 'kilometers' })
          const [lngA, latA] = ptA.geometry.coordinates
          const [lngB, latB] = ptB.geometry.coordinates

          L.polyline([[latA, lngA], [latB, lngB]], {
            color: seg.classif.cor, weight: 5, opacity: 0.9,
          }).addTo(lineLayerRef.current)
        })
      } else {
        L.polyline(latlngs, { color: classifGlobal.cor, weight: 4, opacity: 0.9 }).addTo(lineLayerRef.current)
      }

      // Marcadores nas curvas de nível cruzadas
      crossings.forEach(c => {
        const frac = c.dist / totalDist
        const pt = turf.along(line, frac * totalDistKm, { units: 'kilometers' })
        const [lng, lat] = pt.geometry.coordinates
        L.circleMarker([lat, lng], {
          radius: 5, color: '#fff', fillColor: '#1e293b',
          fillOpacity: 1, weight: 2,
        }).bindTooltip(`⛰ ${c.elevation} m`, {
          direction: 'top', permanent: false, className: '',
        }).addTo(lineLayerRef.current)
      })

      // Marcador início
      L.circleMarker(latlngs[0], {
        radius: 7, color: '#fff', fillColor: '#22c55e', fillOpacity: 1, weight: 2,
      }).bindTooltip(`Início: ${Math.round(startElev)} m`, { direction: 'top' })
        .addTo(lineLayerRef.current)

      // Marcador fim
      L.circleMarker(latlngs[latlngs.length - 1], {
        radius: 7, color: '#fff', fillColor: classifGlobal.cor, fillOpacity: 1, weight: 2,
      }).bindTooltip(`Fim: ${Math.round(endElev)} m`, { direction: 'top' })
        .addTo(lineLayerRef.current)

      setResultado({
        totalDist, minAlt, maxAlt, desnivel, slopeGlobal, classifGlobal,
        interval, crossings, segmentos,
        distances: sampleDists.map(d => d.toFixed(0)),
        elevations,
      })
    } catch (e) {
      setResultado({ erro: `Erro: ${e.message}` })
    } finally {
      setCarregando(false)
    }
  }

  // ── Gráfico ────────────────────────────────────────────────
  useEffect(() => {
    if (!resultado?.elevations || !chartRef.current) return
    if (chartInstanceRef.current) chartInstanceRef.current.destroy()

    const cor = resultado.classifGlobal?.cor || '#38bdf8'

    // Dados extras: marcar curvas de nível no gráfico
    const annotations = {}
    resultado.crossings?.forEach((c, i) => {
      annotations[`crossing_${i}`] = {
        type: 'line', xMin: c.dist.toFixed(0), xMax: c.dist.toFixed(0),
        borderColor: '#ffffff33', borderWidth: 1, borderDash: [3, 3],
      }
    })

    chartInstanceRef.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: resultado.distances,
        datasets: [{
          label: 'Altitude (m)',
          data: resultado.elevations.map(e => Math.round(e)),
          borderColor: cor,
          backgroundColor: cor + '22',
          borderWidth: 2, tension: 0.35,
          fill: true, pointRadius: 0, pointHoverRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => `Distância: ${items[0].label} m`,
              label: item => `Altitude: ${item.raw} m`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#64748b', font: { size: 10 }, maxTicksLimit: 5,
              callback: (v, i, ticks) => {
                if (i === 0 || i === ticks.length - 1 || i === Math.floor(ticks.length / 2))
                  return `${resultado.distances[i]}m`
                return ''
              },
            },
            grid: { color: '#1e293b' },
          },
          y: {
            ticks: { color: '#64748b', font: { size: 10 }, callback: v => `${v}m` },
            grid: { color: '#1e293b' },
          },
        },
      },
    })
  }, [resultado])

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
                <button
                  key={l.id}
                  className={`${styles.layerBtn} ${camada === l.id ? styles.layerBtnActive : ''}`}
                  onClick={() => setCamada(l.id)}
                >
                  {l.icone} {l.label}
                </button>
              ))}
            </div>

            <button
              className={`${styles.btn} ${desenhando ? styles.btnDrawActive : styles.btnDraw}`}
              onClick={() => { if (desenhando) finalizarLinha(); else { limparTudo(); setDesenhando(true) } }}
              disabled={carregando}
            >
              <FiEdit3 size={12} />
              {desenhando ? 'Finalizar linha' : 'Desenhar linha'}
            </button>

            {resultado && !desenhando && !carregando && (
              <button className={`${styles.btn} ${styles.btnClear}`} onClick={limparTudo}>
                <FiTrash2 size={12} /> Limpar
              </button>
            )}

            <span className={`${styles.hint} ${desenhando ? styles.hintActive : ''} ${carregando ? styles.hintLoading : ''}`}>
              {carregando
                ? '⏳ Buscando elevação SRTM e calculando cruzamentos…'
                : desenhando
                  ? '✏️ Clique para adicionar pontos · Duplo clique para finalizar'
                  : 'Cruzamentos calculados por curva de nível'}
            </span>
          </div>

          <div ref={mapRef} className={styles.mapEl} style={{ position: 'absolute', top: 50, left: 0, right: 0, bottom: 0 }} />
        </div>

        {/* ── Painel lateral ────────────────────────────── */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <FiActivity size={14} color="#38bdf8" />
            <span className={styles.panelTitle}>Resultado</span>
            {carregando && <span className={styles.loadingDot} />}
          </div>

          <div className={styles.panelBody}>

            {carregando && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>⏳</div>
                <div>Calculando cruzamentos de curvas de nível…</div>
                <div style={{ fontSize: 11, color: '#475569' }}>Elevação SRTM · Open-Meteo</div>
              </div>
            )}

            {!carregando && !resultado && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>📐</div>
                <div>Desenhe uma linha no mapa cruzando as curvas de nível topográficas.</div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                  O app detecta cada curva que você cruzar, mede a distância real entre elas e calcula a declividade segmento a segmento.
                </div>
              </div>
            )}

            {!carregando && resultado?.erro && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>⚠️</div>
                <div style={{ color: '#f97316' }}>{resultado.erro}</div>
              </div>
            )}

            {!carregando && resultado && !resultado.erro && (
              <>
                {/* Resumo geral */}
                <div className={styles.statsGrid}>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Dist. total</div>
                    <div className={styles.statValue}>
                      {resultado.totalDist >= 1000
                        ? (resultado.totalDist / 1000).toFixed(2)
                        : resultado.totalDist.toFixed(0)}
                      <span className={styles.statUnit}>{resultado.totalDist >= 1000 ? ' km' : ' m'}</span>
                    </div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Decl. global</div>
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
                    <div className={styles.statValue}>
                      {resultado.crossings.length}
                      <span className={styles.statUnit}> × {resultado.interval}m</span>
                    </div>
                  </div>
                </div>

                {/* Classificação global */}
                <div
                  className={styles.classCard}
                  style={{ borderColor: resultado.classifGlobal.cor + '55', background: resultado.classifGlobal.cor + '12' }}
                >
                  <div className={styles.classDot} style={{ background: resultado.classifGlobal.cor }} />
                  <div>
                    <div className={styles.classTitle} style={{ color: resultado.classifGlobal.cor }}>
                      {resultado.classifGlobal.label}
                    </div>
                    <div className={styles.classDesc}>{resultado.classifGlobal.desc}</div>
                  </div>
                </div>

                {/* Gráfico */}
                <div>
                  <div className={styles.chartTitle}>Perfil Altimétrico Real</div>
                  <div className={styles.chartWrap} style={{ height: 150 }}>
                    <canvas ref={chartRef} />
                  </div>
                </div>

                {/* Tabela de segmentos entre curvas */}
                {resultado.segmentos.length > 0 && (
                  <div>
                    <div className={styles.chartTitle}>
                      Declividade por segmento ({resultado.interval} m entre curvas)
                    </div>
                    <div className={styles.segTable}>
                      <div className={styles.segHeader}>
                        <span>Cotas</span>
                        <span>Dist.</span>
                        <span>Desnível</span>
                        <span>Decliv.</span>
                      </div>
                      {resultado.segmentos.map((seg, i) => (
                        <div key={i} className={styles.segRow}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span
                              style={{ width: 7, height: 7, borderRadius: '50%', background: seg.classif.cor, flexShrink: 0, display: 'inline-block' }}
                            />
                            {seg.de}→{seg.para}m
                          </span>
                          <span>{seg.dist < 1000 ? `${seg.dist.toFixed(0)}m` : `${(seg.dist / 1000).toFixed(2)}km`}</span>
                          <span style={{ color: seg.sobe ? '#f97316' : '#38bdf8' }}>
                            {seg.sobe ? '▲' : '▼'} {seg.elevDiff}m
                          </span>
                          <span style={{ color: seg.classif.cor, fontWeight: 700 }}>
                            {seg.slope.toFixed(1)}%
                          </span>
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
