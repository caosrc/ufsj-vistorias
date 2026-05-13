import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as turf from '@turf/turf'
import Chart from 'chart.js/auto'
import { CIDADES, CIDADE_PADRAO } from '../data/cidades'
import Sidebar from '../components/Sidebar'
import styles from './Declividade.module.css'
import { FiTrendingUp, FiEdit3, FiTrash2, FiActivity, FiLoader } from 'react-icons/fi'

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
  { max: 3,        label: 'Plano',           desc: 'Sem restrições ao uso',                  cor: '#22c55e' },
  { max: 8,        label: 'Suave ondulado',  desc: 'Pequena limitação agrícola',              cor: '#84cc16' },
  { max: 20,       label: 'Ondulado',        desc: 'Requer práticas conservacionistas',       cor: '#eab308' },
  { max: 45,       label: 'Forte ondulado',  desc: 'Uso restrito — risco de erosão',          cor: '#f97316' },
  { max: 75,       label: 'Montanhoso',      desc: 'Alto risco — evitar construções',         cor: '#ef4444' },
  { max: Infinity, label: 'Escarpado',       desc: 'Inapto — risco geológico severo',         cor: '#7c3aed' },
]

function classifySlope(pct) {
  return SLOPE_CLASSES.find(c => pct <= c.max) || SLOPE_CLASSES[SLOPE_CLASSES.length - 1]
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

export default function Declividade() {
  const mapRef           = useRef(null)
  const leafletRef       = useRef(null)
  const tileLayerRef     = useRef(null)
  const drawLayerRef     = useRef(null)
  const lineLayerRef     = useRef(null)
  const chartRef         = useRef(null)
  const chartInstanceRef = useRef(null)
  const drawStateRef     = useRef({ ativo: false, pontos: [], markers: [], activeLine: null, previewLine: null })

  const [cidade,    setCidade]    = useState(CIDADE_PADRAO)
  const [camada,    setCamada]    = useState('topo')
  const [desenhando, setDesenhando] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [resultado,  setResultado]  = useState(null)

  // ── Init mapa ──────────────────────────────────────────────
  useEffect(() => {
    if (leafletRef.current) return
    const c = CIDADES[cidade]
    const [lng, lat] = c.center
    const map = L.map(mapRef.current, {
      center: [lat, lng],
      zoom: 13,
      zoomControl: false,
      doubleClickZoom: false,
    })
    L.control.zoom({ position: 'topright' }).addTo(map)
    L.control.scale({ metric: true, imperial: false }).addTo(map)

    const layerObj = LAYERS.find(l => l.id === 'topo')
    tileLayerRef.current = L.tileLayer(layerObj.url, {
      attribution: layerObj.attribution,
      maxZoom: layerObj.maxZoom,
    }).addTo(map)

    drawLayerRef.current = L.layerGroup().addTo(map)
    lineLayerRef.current = L.layerGroup().addTo(map)

    map.on('click',     handleClick)
    map.on('dblclick',  handleDblClick)
    map.on('mousemove', handleMouseMove)

    leafletRef.current = map
    return () => { map.remove(); leafletRef.current = null }
  }, [])

  // ── Trocar camada ─────────────────────────────────────────
  useEffect(() => {
    if (!leafletRef.current || !tileLayerRef.current) return
    const layerObj = LAYERS.find(l => l.id === camada)
    tileLayerRef.current.setUrl(layerObj.url)
    tileLayerRef.current.options.maxZoom = layerObj.maxZoom
  }, [camada])

  // ── Voar para cidade ──────────────────────────────────────
  useEffect(() => {
    if (!leafletRef.current) return
    const c = CIDADES[cidade]
    const [lng, lat] = c.center
    leafletRef.current.flyTo([lat, lng], 13, { duration: 1.2 })
  }, [cidade])

  // ── Cursor ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.style.cursor = desenhando ? 'crosshair' : ''
    drawStateRef.current.ativo = desenhando
    if (!desenhando) limparDesenho()
  }, [desenhando])

  // ── Eventos ───────────────────────────────────────────────
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

  // ── Análise com elevação real ──────────────────────────────
  async function analisarLinha(latlngs) {
    setCarregando(true)
    setResultado(null)
    lineLayerRef.current?.clearLayers()

    try {
      const coords    = latlngs.map(p => [p.lng, p.lat])
      const line      = turf.lineString(coords)
      const totalDistKm = turf.length(line, { units: 'kilometers' })
      const totalDist   = totalDistKm * 1000

      // Amostrar pontos ao longo da linha
      const AMOSTRAS = 60
      const samplePoints = []
      for (let i = 0; i <= AMOSTRAS; i++) {
        const distKm = (i / AMOSTRAS) * totalDistKm
        const pt = turf.along(line, distKm, { units: 'kilometers' })
        samplePoints.push(pt.geometry.coordinates)
      }

      // Buscar elevação real (SRTM via Open-Meteo)
      const elevations = await fetchElevations(samplePoints)

      if (!elevations || elevations.length === 0) throw new Error('Sem dados de elevação')

      const minAlt  = Math.min(...elevations)
      const maxAlt  = Math.max(...elevations)
      const desnivel = maxAlt - minAlt
      const slope   = (desnivel / totalDist) * 100
      const classif = classifySlope(slope)

      const distances = samplePoints.map((_, i) =>
        ((i / AMOSTRAS) * totalDist).toFixed(0)
      )

      // Desenhar linha no mapa com cor da classificação
      lineLayerRef.current?.clearLayers()
      L.polyline(latlngs, {
        color: classif.cor, weight: 3.5, opacity: 0.95,
      }).addTo(lineLayerRef.current)

      // Marcador início
      L.circleMarker(latlngs[0], {
        radius: 7, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2,
      }).bindTooltip(`Início · ${Math.round(elevations[0])} m`, { direction: 'top' })
        .addTo(lineLayerRef.current)

      // Marcador fim
      L.circleMarker(latlngs[latlngs.length - 1], {
        radius: 7, color: classif.cor, fillColor: classif.cor, fillOpacity: 1, weight: 2,
      }).bindTooltip(`Fim · ${Math.round(elevations[elevations.length - 1])} m`, { direction: 'top' })
        .addTo(lineLayerRef.current)

      setResultado({ totalDist, minAlt: Math.round(minAlt), maxAlt: Math.round(maxAlt), desnivel: Math.round(desnivel), slope, classif, distances, elevations })
    } catch (e) {
      setResultado({ erro: `Erro ao buscar dados de elevação: ${e.message}` })
    } finally {
      setCarregando(false)
    }
  }

  // ── Gráfico ───────────────────────────────────────────────
  useEffect(() => {
    if (!resultado?.elevations || !chartRef.current) return
    if (chartInstanceRef.current) chartInstanceRef.current.destroy()

    const cor = resultado.classif?.cor || '#38bdf8'
    chartInstanceRef.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: resultado.distances,
        datasets: [{
          label: 'Altitude (m)',
          data: resultado.elevations.map(e => Math.round(e)),
          borderColor: cor,
          backgroundColor: cor + '28',
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => `Distância: ${items[0].label} m`,
              label: (item) => `Altitude: ${item.raw} m`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#64748b', font: { size: 10 },
              maxTicksLimit: 5,
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

  const layerAtual = LAYERS.find(l => l.id === camada)

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0f172a' }}>
      <Sidebar />

      <div className={styles.wrapper}>

        {/* ── Mapa ──────────────────────────────────────── */}
        <div className={styles.mapContainer}>

          {/* Toolbar */}
          <div className={styles.toolbar}>
            <div className={styles.toolbarTitle}>
              <FiTrendingUp size={14} /> Declividade
            </div>

            {/* Seletor de cidade */}
            <select
              className={styles.select}
              value={cidade}
              onChange={e => setCidade(e.target.value)}
            >
              {Object.values(CIDADES).map(c => (
                <option key={c.codigo} value={c.codigo}>{c.nome}</option>
              ))}
            </select>

            {/* Seletor de camada */}
            <div className={styles.layerBtns}>
              {LAYERS.map(l => (
                <button
                  key={l.id}
                  className={`${styles.layerBtn} ${camada === l.id ? styles.layerBtnActive : ''}`}
                  onClick={() => setCamada(l.id)}
                  title={l.label}
                >
                  {l.icone} {l.label}
                </button>
              ))}
            </div>

            {/* Botão desenhar */}
            <button
              className={`${styles.btn} ${desenhando ? styles.btnDrawActive : styles.btnDraw}`}
              onClick={() => {
                if (desenhando) finalizarLinha()
                else { limparTudo(); setDesenhando(true) }
              }}
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

            {/* Hint */}
            <span className={`${styles.hint} ${desenhando ? styles.hintActive : ''} ${carregando ? styles.hintLoading : ''}`}>
              {carregando
                ? '⏳ Buscando elevação SRTM…'
                : desenhando
                  ? '✏️ Clique para adicionar pontos · Duplo clique para finalizar'
                  : 'Dados de elevação: SRTM via Open-Meteo'}
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
                <div className={styles.placeholderIcon} style={{ animation: 'spin 1s linear infinite' }}>⏳</div>
                <div>Consultando elevação SRTM real…</div>
                <div style={{ fontSize: 11, color: '#475569' }}>Open-Meteo Elevation API</div>
              </div>
            )}

            {!carregando && !resultado && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>📐</div>
                <div>Desenhe uma linha no mapa para calcular a declividade com dados de elevação reais.</div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>Dados SRTM · resolução 90 m</div>
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
                {/* Stats */}
                <div className={styles.statsGrid}>
                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Distância</div>
                    <div className={styles.statValue}>
                      {resultado.totalDist >= 1000
                        ? (resultado.totalDist / 1000).toFixed(2)
                        : resultado.totalDist.toFixed(0)}
                      <span className={styles.statUnit}>
                        {resultado.totalDist >= 1000 ? ' km' : ' m'}
                      </span>
                    </div>
                  </div>

                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Declividade</div>
                    <div className={styles.statValue} style={{ color: resultado.classif.cor }}>
                      {resultado.slope.toFixed(1)}<span className={styles.statUnit}> %</span>
                    </div>
                  </div>

                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Alt. mínima</div>
                    <div className={styles.statValue}>
                      {resultado.minAlt}<span className={styles.statUnit}> m</span>
                    </div>
                  </div>

                  <div className={styles.statCard}>
                    <div className={styles.statLabel}>Alt. máxima</div>
                    <div className={styles.statValue}>
                      {resultado.maxAlt}<span className={styles.statUnit}> m</span>
                    </div>
                  </div>

                  <div className={styles.statCard} style={{ gridColumn: 'span 2' }}>
                    <div className={styles.statLabel}>Desnível total</div>
                    <div className={styles.statValue}>
                      {resultado.desnivel}<span className={styles.statUnit}> m</span>
                    </div>
                  </div>
                </div>

                {/* Classificação */}
                <div
                  className={styles.classCard}
                  style={{ borderColor: resultado.classif.cor + '55', background: resultado.classif.cor + '12' }}
                >
                  <div className={styles.classDot} style={{ background: resultado.classif.cor }} />
                  <div>
                    <div className={styles.classTitle} style={{ color: resultado.classif.cor }}>
                      {resultado.classif.label}
                    </div>
                    <div className={styles.classDesc}>{resultado.classif.desc}</div>
                  </div>
                </div>

                {/* Gráfico */}
                <div>
                  <div className={styles.chartTitle}>Perfil Altimétrico Real</div>
                  <div className={styles.chartWrap} style={{ height: 160 }}>
                    <canvas ref={chartRef} />
                  </div>
                </div>

                {/* Tabela de classes */}
                <div>
                  <div className={styles.chartTitle}>Classes de Declividade</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {SLOPE_CLASSES.slice(0, -1).map(c => (
                      <div
                        key={c.label}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '5px 8px', borderRadius: 6, fontSize: 11,
                          background: resultado.classif.label === c.label ? c.cor + '18' : 'transparent',
                          border: `1px solid ${resultado.classif.label === c.label ? c.cor + '44' : 'transparent'}`,
                        }}
                      >
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.cor, flexShrink: 0 }} />
                        <span style={{ color: '#94a3b8', flex: 1 }}>{c.label}</span>
                        <span style={{ color: '#64748b' }}>≤ {c.max}%</span>
                      </div>
                    ))}
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
