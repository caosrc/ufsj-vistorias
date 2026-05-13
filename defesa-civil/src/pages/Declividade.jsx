import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as turf from '@turf/turf'
import Chart from 'chart.js/auto'
import { CIDADES, CIDADE_PADRAO } from '../data/cidades'
import Sidebar from '../components/Sidebar'
import styles from './Declividade.module.css'
import { FiTrendingUp, FiEdit3, FiTrash2, FiActivity } from 'react-icons/fi'

const SLOPE_CLASSES = [
  { max: 3,   label: 'Plano',          desc: 'Sem restrições ao uso',          cor: '#22c55e' },
  { max: 8,   label: 'Suave ondulado', desc: 'Pequena limitação agrícola',      cor: '#84cc16' },
  { max: 20,  label: 'Ondulado',       desc: 'Requer práticas conservacionistas', cor: '#eab308' },
  { max: 45,  label: 'Forte ondulado', desc: 'Uso restrito, risco de erosão',   cor: '#f97316' },
  { max: 75,  label: 'Montanhoso',     desc: 'Alto risco — evitar construções', cor: '#ef4444' },
  { max: Infinity, label: 'Escarpado', desc: 'Inapto — risco geológico severo', cor: '#7c3aed' },
]

function classifySlope(pct) {
  return SLOPE_CLASSES.find(c => pct <= c.max) || SLOPE_CLASSES[SLOPE_CLASSES.length - 1]
}

export default function Declividade() {
  const mapRef      = useRef(null)
  const leafletRef  = useRef(null)
  const contoursRef = useRef(null)
  const drawLayerRef = useRef(null)
  const lineLayerRef = useRef(null)
  const chartRef    = useRef(null)
  const chartInstanceRef = useRef(null)
  const drawStateRef = useRef({ ativo: false, pontos: [], markers: [], previewLine: null })

  const [cidade, setCidade] = useState(CIDADE_PADRAO)
  const [desenhando, setDesenhando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [contoursLoaded, setContoursLoaded] = useState(false)
  const contoursDataRef = useRef(null)

  // ── Init mapa ─────────────────────────────────────────────
  useEffect(() => {
    if (leafletRef.current) return
    const c = CIDADES[cidade]
    const [lng, lat] = c.center
    const map = L.map(mapRef.current, {
      center: [lat, lng],
      zoom: 12,
      zoomControl: false,
    })
    L.control.zoom({ position: 'topright' }).addTo(map)
    L.control.scale({ metric: true, imperial: false }).addTo(map)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19
    }).addTo(map)

    drawLayerRef.current  = L.layerGroup().addTo(map)
    lineLayerRef.current  = L.layerGroup().addTo(map)
    contoursRef.current   = L.layerGroup().addTo(map)

    map.on('click', handleClick)
    map.on('dblclick', handleDblClick)
    map.on('mousemove', handleMouseMove)

    leafletRef.current = map

    carregarCurvas()

    return () => { map.remove(); leafletRef.current = null }
  }, [])

  // ── Trocar cidade ─────────────────────────────────────────
  useEffect(() => {
    if (!leafletRef.current) return
    const c = CIDADES[cidade]
    const [lng, lat] = c.center
    leafletRef.current.flyTo([lat, lng], 12, { duration: 1.2 })
  }, [cidade])

  // ── Cursor ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.style.cursor = desenhando ? 'crosshair' : ''
    drawStateRef.current.ativo = desenhando
    if (!desenhando) limparDesenho()
  }, [desenhando])

  // ── Carregar curvas de nível ───────────────────────────────
  async function carregarCurvas() {
    try {
      const res  = await fetch('/contours.geojson')
      const data = await res.json()
      contoursDataRef.current = data
      setContoursLoaded(true)

      if (!contoursRef.current) return
      contoursRef.current.clearLayers()
      L.geoJSON(data, {
        style: (feature) => {
          const elev = feature.properties.elevation
          const t = (elev - 880) / (1160 - 880)
          const r = Math.round(139 + t * (220 - 139))
          const g = Math.round(90  + t * (50  - 90))
          const b = Math.round(43  + t * (20  - 43))
          return {
            color: `rgb(${r},${g},${b})`,
            weight: elev % 100 === 0 ? 2 : 1,
            opacity: elev % 100 === 0 ? 0.85 : 0.55,
          }
        },
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(`${feature.properties.elevation} m`, {
            permanent: false, direction: 'top', className: ''
          })
        }
      }).addTo(contoursRef.current)
    } catch (e) {
      console.warn('Erro ao carregar curvas:', e)
    }
  }

  // ── Eventos de mapa ───────────────────────────────────────
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
        color: '#38bdf8', weight: 1.5, dashArray: '5,5', opacity: 0.6
      }).addTo(drawLayerRef.current)
    }
    state.previewLine.setLatLngs([ultimo, e.latlng])
  }

  function adicionarPonto(latlng) {
    const state = drawStateRef.current
    state.pontos.push(latlng)
    const m = L.circleMarker(latlng, {
      radius: 5, color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 1, weight: 2
    }).addTo(drawLayerRef.current)
    state.markers.push(m)

    if (state.pontos.length >= 2) {
      if (state.activeLine) drawLayerRef.current.removeLayer(state.activeLine)
      state.activeLine = L.polyline(state.pontos, {
        color: '#38bdf8', weight: 2.5, opacity: 0.9
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
    if (state.activeLine) drawLayerRef.current?.removeLayer(state.activeLine)
    if (state.previewLine) drawLayerRef.current?.removeLayer(state.previewLine)
    state.pontos = []; state.markers = []; state.activeLine = null; state.previewLine = null
  }

  function limparTudo() {
    limparDesenho()
    lineLayerRef.current?.clearLayers()
    setResultado(null)
    if (chartInstanceRef.current) { chartInstanceRef.current.destroy(); chartInstanceRef.current = null }
  }

  // ── Análise de declividade ─────────────────────────────────
  async function analisarLinha(latlngs) {
    if (!contoursDataRef.current) return

    const coords = latlngs.map(p => [p.lng, p.lat])
    const line   = turf.lineString(coords)
    const totalDist = turf.length(line, { units: 'kilometers' }) * 1000

    // interseções com curvas
    const pares = []
    contoursDataRef.current.features.forEach(feature => {
      const inter = turf.lineIntersect(line, feature)
      if (inter.features.length > 0) {
        pares.push(feature.properties.elevation)
      }
    })

    const elevs = [...new Set(pares)].sort((a, b) => a - b)

    if (elevs.length < 2) {
      setResultado({ erro: 'Poucas curvas de nível cruzadas. Tente uma linha mais longa.' })
      return
    }

    const minAlt  = elevs[0]
    const maxAlt  = elevs[elevs.length - 1]
    const desnivel = maxAlt - minAlt
    const slope   = (desnivel / totalDist) * 100
    const classif = classifySlope(slope)

    // perfil altimétrico interpolado
    const AMOSTRAS = 60
    const distances  = []
    const elevProf   = []

    for (let i = 0; i <= AMOSTRAS; i++) {
      const frac = i / AMOSTRAS
      const distKm = (frac * totalDist) / 1000
      turf.along(line, distKm, { units: 'kilometers' })
      const elev = minAlt + (maxAlt - minAlt) * frac
      distances.push((frac * totalDist).toFixed(0))
      elevProf.push(Math.round(elev))
    }

    // desenhar linha final no mapa
    lineLayerRef.current?.clearLayers()
    L.polyline(latlngs, {
      color: classif.cor, weight: 3, opacity: 0.95
    }).addTo(lineLayerRef.current)

    // marcadores início/fim
    L.circleMarker(latlngs[0], {
      radius: 7, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2
    }).bindTooltip('Início', { permanent: false }).addTo(lineLayerRef.current)

    L.circleMarker(latlngs[latlngs.length - 1], {
      radius: 7, color: classif.cor, fillColor: classif.cor, fillOpacity: 1, weight: 2
    }).bindTooltip('Fim', { permanent: false }).addTo(lineLayerRef.current)

    setResultado({ totalDist, minAlt, maxAlt, desnivel, slope, classif, distances, elevProf })
  }

  // ── Renderizar gráfico ────────────────────────────────────
  useEffect(() => {
    if (!resultado?.distances || !chartRef.current) return

    if (chartInstanceRef.current) chartInstanceRef.current.destroy()

    chartInstanceRef.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: resultado.distances,
        datasets: [{
          label: 'Altitude (m)',
          data: resultado.elevProf,
          borderColor: resultado.classif?.cor || '#38bdf8',
          backgroundColor: (resultado.classif?.cor || '#38bdf8') + '25',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => `Dist: ${items[0].label} m`,
              label: (item) => `Alt: ${item.raw} m`,
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: '#64748b', font: { size: 10 },
              maxTicksLimit: 6,
              callback: (v, i, ticks) => {
                if (i === 0 || i === ticks.length - 1 || i === Math.floor(ticks.length / 2)) return `${resultado.distances[i]} m`
                return ''
              }
            },
            grid: { color: '#1e293b' },
          },
          y: {
            ticks: { color: '#64748b', font: { size: 10 } },
            grid: { color: '#1e293b' },
          }
        }
      }
    })
  }, [resultado])

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0f172a' }}>
      <Sidebar />

      <div className={styles.wrapper}>

        {/* ── Mapa ────────────────────────────────────────── */}
        <div className={styles.mapContainer}>
          {/* Toolbar */}
          <div className={styles.toolbar}>
            <div className={styles.toolbarTitle}>
              <FiTrendingUp size={15} /> Análise de Declividade
            </div>

            <select
              style={{ background: '#1a2540', color: '#e2e8f0', border: '1px solid #2a3f6f', borderRadius: 7, padding: '5px 10px', fontSize: 12 }}
              value={cidade}
              onChange={e => setCidade(e.target.value)}
            >
              {Object.values(CIDADES).map(c => (
                <option key={c.codigo} value={c.codigo}>{c.nome}</option>
              ))}
            </select>

            <button
              className={`${styles.btn} ${desenhando ? styles.btnDrawActive : styles.btnDraw}`}
              onClick={() => {
                if (desenhando) { finalizarLinha() }
                else { limparTudo(); setDesenhando(true) }
              }}
            >
              <FiEdit3 size={12} />
              {desenhando ? 'Finalizar linha' : 'Desenhar linha'}
            </button>

            {resultado && !desenhando && (
              <button className={`${styles.btn} ${styles.btnClear}`} onClick={limparTudo}>
                <FiTrash2 size={12} /> Limpar
              </button>
            )}

            <span className={`${styles.hint} ${desenhando ? styles.hintActive : ''}`}>
              {desenhando
                ? '✏️ Clique para adicionar pontos · Duplo clique para finalizar'
                : contoursLoaded
                  ? `${contoursDataRef.current?.features?.length || 0} curvas de nível carregadas`
                  : 'Carregando curvas de nível…'
              }
            </span>
          </div>

          <div ref={mapRef} className={styles.mapEl} style={{ paddingTop: 50 }} />
        </div>

        {/* ── Painel lateral ────────────────────────────── */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <FiActivity size={14} color="#38bdf8" />
            <span className={styles.panelTitle}>Resultado</span>
          </div>

          <div className={styles.panelBody}>
            {!resultado ? (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>📐</div>
                <div>Desenhe uma linha no mapa para calcular a declividade e ver o perfil altimétrico.</div>
              </div>
            ) : resultado.erro ? (
              <div className={styles.placeholder}>
                <div className={styles.placeholderIcon}>⚠️</div>
                <div style={{ color: '#f97316' }}>{resultado.erro}</div>
              </div>
            ) : (
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
                    <div className={styles.statLabel}>Desnível</div>
                    <div className={styles.statValue}>
                      {resultado.desnivel}<span className={styles.statUnit}> m</span>
                    </div>
                  </div>
                </div>

                {/* Classificação */}
                <div
                  className={styles.classCard}
                  style={{ borderColor: resultado.classif.cor + '44', background: resultado.classif.cor + '10' }}
                >
                  <div className={styles.classDot} style={{ background: resultado.classif.cor }} />
                  <div className={styles.classInfo}>
                    <div className={styles.classTitle} style={{ color: resultado.classif.cor }}>
                      {resultado.classif.label}
                    </div>
                    <div className={styles.classDesc}>{resultado.classif.desc}</div>
                  </div>
                </div>

                {/* Gráfico */}
                <div className={styles.chartSection}>
                  <div className={styles.chartTitle}>Perfil Altimétrico</div>
                  <div className={styles.chartWrap} style={{ height: 160 }}>
                    <canvas ref={chartRef} />
                  </div>
                </div>

                {/* Legenda curvas */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div className={styles.chartTitle}>Curvas de Nível</div>
                  <div className={styles.legendRow}>
                    <div className={styles.legendLine} style={{ background: '#8B5E2B', height: 2 }} />
                    <span>Curva simples (20 m)</span>
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legendLine} style={{ background: '#8B5E2B', height: 3 }} />
                    <span>Curva mestra (100 m)</span>
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
