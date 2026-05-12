import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../services/api'
import { CIDADES, CIDADE_PADRAO } from '../data/cidades'
import PainelClima from './PainelClima'
import styles from './Mapa.module.css'
import {
  FiMapPin, FiCloud, FiX, FiCheck, FiRefreshCw, FiSquare,
  FiLayers, FiBookOpen, FiDroplet, FiAlertTriangle, FiChevronDown,
  FiChevronRight, FiRadio
} from 'react-icons/fi'

const CAMADAS_BASE = [
  {
    id: 'ruas',
    label: 'Ruas',
    icone: '🗺️',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
    maxZoom: 19
  },
  {
    id: 'satelite',
    label: 'Satélite',
    icone: '🛰️',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri',
    maxZoom: 19
  },
  {
    id: 'topografico',
    label: 'Topografia',
    icone: '⛰️',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap',
    maxZoom: 17
  }
]

const RISCO_CORES = { R1: '#22c55e', R2: '#eab308', R3: '#f97316', R4: '#ef4444' }
const NIVEL_CORES = { critico: '#ef4444', alto: '#f97316', medio: '#eab308', baixo: '#22c55e' }

const RISCO_LABELS = {
  R1: { label: 'Baixo Risco', sub: 'Condição estável' },
  R2: { label: 'Médio Risco', sub: 'Atenção moderada' },
  R3: { label: 'Alto Risco', sub: 'Situação crítica' },
  R4: { label: 'Muito Alto', sub: 'Emergência' },
}

function criarIconeNivel(cor) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${cor};border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.6);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  })
}

function calcularRiscoAtual(precipitacao) {
  if (precipitacao === null) return null
  if (precipitacao >= 15) return { nivel: 'R4', cor: '#ef4444', texto: 'Muito Alto', icon: '🔴' }
  if (precipitacao >= 8) return { nivel: 'R3', cor: '#f97316', texto: 'Alto', icon: '🟠' }
  if (precipitacao >= 2) return { nivel: 'R2', cor: '#eab308', texto: 'Médio', icon: '🟡' }
  return { nivel: 'R1', cor: '#22c55e', texto: 'Baixo', icon: '🟢' }
}

export default function Mapa() {
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const tileLayerRef = useRef(null)
  const ocMarkerLayerRef = useRef(null)
  const areaLayerRef = useRef(null)
  const drawLayerRef = useRef(null)
  const chuvaLayerRef = useRef(null)
  const heatLayerRef = useRef(null)
  const drawStateRef = useRef({ ativo: false, pontos: [], markers: [], polyline: null })

  const [camada, setCamada] = useState('ruas')
  const [cidade, setCidade] = useState(CIDADE_PADRAO)
  const [coordAtual, setCoordAtual] = useState(null)
  const [showClima, setShowClima] = useState(false)
  const [showLegenda, setShowLegenda] = useState(false)
  const [showCamadas, setShowCamadas] = useState(true)
  const [modoDesenho, setModoDesenho] = useState(null)
  const [salvandoArea, setSalvandoArea] = useState(false)
  const [nivelRisco, setNivelRisco] = useState('R2')
  const [descRisco, setDescRisco] = useState('')
  const [polyRascunho, setPolyRascunho] = useState(null)
  const [overlays, setOverlays] = useState({ chuva: false, heatmap: false, areas: true })
  const [precipitacao, setPrecipitacao] = useState(null)
  const [ocorrenciasLatLng, setOcorrenciasLatLng] = useState([])
  const [secaoBase, setSecaoBase] = useState(true)
  const [secaoOverlay, setSecaoOverlay] = useState(true)
  const [radarTs, setRadarTs] = useState(null)

  // ── Init Mapa ──────────────────────────────────────────────
  useEffect(() => {
    if (leafletRef.current) return
    const cidadeObj = CIDADES[cidade]
    const [lng0, lat0] = cidadeObj.center
    const map = L.map(mapRef.current, {
      center: [lat0, lng0],
      zoom: cidadeObj.zoom,
      zoomControl: false,
    })
    L.control.zoom({ position: 'topright' }).addTo(map)
    L.control.scale({ metric: true, imperial: false }).addTo(map)

    const camadaObj = CAMADAS_BASE.find(c => c.id === 'ruas')
    tileLayerRef.current = L.tileLayer(camadaObj.url, {
      attribution: camadaObj.attribution,
      maxZoom: camadaObj.maxZoom
    }).addTo(map)

    ocMarkerLayerRef.current = L.layerGroup().addTo(map)
    areaLayerRef.current = L.layerGroup().addTo(map)
    drawLayerRef.current = L.layerGroup().addTo(map)
    heatLayerRef.current = L.layerGroup().addTo(map)

    map.on('click', handleMapClick)
    map.on('mousemove', (e) => {
      setCoordAtual({ lat: e.latlng.lat, lng: e.latlng.lng })
      if (drawStateRef.current.ativo && drawStateRef.current.pontos.length > 0) {
        atualizarLinhaPreview(e.latlng)
      }
    })

    leafletRef.current = map
    carregarDados(map)
    carregarClima(cidade)
    return () => { map.remove(); leafletRef.current = null }
  }, [])

  // ── Trocar camada base ─────────────────────────────────────
  useEffect(() => {
    if (!leafletRef.current || !tileLayerRef.current) return
    const camadaObj = CAMADAS_BASE.find(c => c.id === camada)
    tileLayerRef.current.setUrl(camadaObj.url)
    tileLayerRef.current.options.maxZoom = camadaObj.maxZoom
  }, [camada])

  // ── Voar para cidade ───────────────────────────────────────
  useEffect(() => {
    if (!leafletRef.current) return
    const c = CIDADES[cidade]
    const [lng, lat] = c.center
    leafletRef.current.flyTo([lat, lng], c.zoom, { duration: 1.4 })
    carregarClima(cidade)
  }, [cidade])

  // ── Cursor modo desenho ────────────────────────────────────
  useEffect(() => {
    const el = mapRef.current
    if (!el) return
    el.style.cursor = modoDesenho ? 'crosshair' : ''
    drawStateRef.current.ativo = !!modoDesenho
    if (!modoDesenho) limparDesenho()
  }, [modoDesenho])

  // ── Overlay: Chuva (RainViewer) ────────────────────────────
  useEffect(() => {
    if (!leafletRef.current) return
    if (overlays.chuva) {
      ativarRadar()
    } else {
      if (chuvaLayerRef.current) {
        leafletRef.current.removeLayer(chuvaLayerRef.current)
        chuvaLayerRef.current = null
      }
      setRadarTs(null)
    }
  }, [overlays.chuva])

  // ── Overlay: Heatmap ───────────────────────────────────────
  useEffect(() => {
    if (!heatLayerRef.current) return
    if (overlays.heatmap) {
      renderizarHeatmap(ocorrenciasLatLng)
    } else {
      heatLayerRef.current.clearLayers()
    }
  }, [overlays.heatmap, ocorrenciasLatLng])

  // ── Overlay: Áreas de Risco ────────────────────────────────
  useEffect(() => {
    if (!areaLayerRef.current || !leafletRef.current) return
    if (overlays.areas) {
      if (!leafletRef.current.hasLayer(areaLayerRef.current)) {
        areaLayerRef.current.addTo(leafletRef.current)
      }
    } else {
      leafletRef.current.removeLayer(areaLayerRef.current)
    }
  }, [overlays.areas])

  // ── Nível do polígono rascunho ─────────────────────────────
  useEffect(() => {
    if (polyRascunho?.polygon) {
      polyRascunho.polygon.setStyle({
        color: RISCO_CORES[nivelRisco], fillColor: RISCO_CORES[nivelRisco]
      })
    }
  }, [nivelRisco, polyRascunho])

  // ── Funções de Radar ───────────────────────────────────────
  async function ativarRadar() {
    try {
      const res = await fetch('https://api.rainviewer.com/public/weather-maps.json')
      const json = await res.json()
      const frames = json.radar.past
      const latest = frames[frames.length - 1]
      setRadarTs(new Date(latest.time * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))

      if (chuvaLayerRef.current) {
        leafletRef.current?.removeLayer(chuvaLayerRef.current)
      }

      chuvaLayerRef.current = L.tileLayer(
        `https://tilecache.rainviewer.com/v2/radar/${latest.time}/512/{z}/{x}/{y}/8/1_1.png`,
        { opacity: 0.65, attribution: '© RainViewer', maxZoom: 18 }
      )

      if (leafletRef.current && overlays.chuva) {
        chuvaLayerRef.current.addTo(leafletRef.current)
      }
    } catch {
      // fallback silencioso
    }
  }

  // ── Heatmap ────────────────────────────────────────────────
  function renderizarHeatmap(points) {
    if (!heatLayerRef.current) return
    heatLayerRef.current.clearLayers()
    points.forEach(p => {
      L.circle([p.lat, p.lng], {
        radius: 500, color: 'none',
        fillColor: '#ef4444', fillOpacity: 0.10, weight: 0
      }).addTo(heatLayerRef.current)
      L.circle([p.lat, p.lng], {
        radius: 150, color: 'none',
        fillColor: '#f97316', fillOpacity: 0.20, weight: 0
      }).addTo(heatLayerRef.current)
      L.circleMarker([p.lat, p.lng], {
        radius: 5, color: 'none',
        fillColor: '#ef4444', fillOpacity: 0.7, weight: 0
      }).addTo(heatLayerRef.current)
    })
  }

  // ── Clima para indicador de risco ──────────────────────────
  async function carregarClima(cidadeKey) {
    try {
      const cidadeObj = CIDADES[cidadeKey]
      const [lng, lat] = cidadeObj.center
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=precipitation&forecast_days=1&timezone=America%2FSao_Paulo`
      )
      const data = await res.json()
      setPrecipitacao(data.current?.precipitation ?? 0)
    } catch {
      setPrecipitacao(0)
    }
  }

  // ── Dados do mapa ──────────────────────────────────────────
  async function carregarDados(map) {
    const m = map || leafletRef.current
    if (!m) return
    ocMarkerLayerRef.current?.clearLayers()
    areaLayerRef.current?.clearLayers()
    try {
      const [ocGeo, arGeo] = await Promise.all([
        api.geojsonOcorrencias().catch(() => null),
        api.geojsonAreasRisco().catch(() => null)
      ])
      const latLngs = []
      if (ocGeo?.features) {
        L.geoJSON(ocGeo, {
          pointToLayer: (feature, latlng) => {
            const cor = NIVEL_CORES[feature.properties.nivel] || '#38bdf8'
            latLngs.push({ lat: latlng.lat, lng: latlng.lng, nivel: feature.properties.nivel })
            return L.marker(latlng, { icon: criarIconeNivel(cor) })
          },
          onEachFeature: (feature, layer) => {
            const p = feature.properties
            layer.bindPopup(
              `<div style="font-family:sans-serif;min-width:150px">
                <b style="font-size:14px">${p.tipo}</b>
                <div style="margin-top:4px;color:#64748b;font-size:12px">${p.descricao || '—'}</div>
                ${p.nivel ? `<span style="display:inline-block;margin-top:6px;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:${NIVEL_CORES[p.nivel]}22;color:${NIVEL_CORES[p.nivel]};border:1px solid ${NIVEL_CORES[p.nivel]}44">${p.nivel?.toUpperCase()}</span>` : ''}
              </div>`
            )
          }
        }).addTo(ocMarkerLayerRef.current)
        setOcorrenciasLatLng(latLngs)
      }
      if (arGeo?.features) {
        L.geoJSON(arGeo, {
          style: (feature) => {
            const cor = RISCO_CORES[feature.properties.nivel] || '#94a3b8'
            return { color: cor, fillColor: cor, fillOpacity: 0.2, weight: 2 }
          },
          onEachFeature: (feature, layer) => {
            const p = feature.properties
            layer.bindPopup(
              `<div style="font-family:sans-serif;min-width:140px">
                <b style="font-size:14px">Área de Risco ${p.nivel}</b>
                <div style="margin-top:4px;color:#64748b;font-size:12px">${p.descricao || '—'}</div>
              </div>`
            )
          }
        }).addTo(areaLayerRef.current)
      }
    } catch {
      const ocs = JSON.parse(localStorage.getItem('ocorrencias') || '[]')
      const latLngs = []
      ocs.filter(o => o.lat && o.lng).forEach(o => {
        const cor = NIVEL_CORES[o.nivel] || '#38bdf8'
        latLngs.push({ lat: o.lat, lng: o.lng, nivel: o.nivel })
        L.marker([o.lat, o.lng], { icon: criarIconeNivel(cor) })
          .bindPopup(`<b>${o.tipo}</b><br><small>${o.descricao || ''}</small>`)
          .addTo(ocMarkerLayerRef.current)
      })
      setOcorrenciasLatLng(latLngs)
    }
  }

  // ── Desenho ────────────────────────────────────────────────
  function handleMapClick(e) {
    if (!drawStateRef.current.ativo) {
      localStorage.setItem('ultimaCoordenada', JSON.stringify({ lat: e.latlng.lat, lng: e.latlng.lng }))
      return
    }
    adicionarPonto(e.latlng)
  }

  function adicionarPonto(latlng) {
    const state = drawStateRef.current
    state.pontos.push(latlng)
    const marker = L.circleMarker(latlng, {
      radius: 5, color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 1, weight: 2
    }).addTo(drawLayerRef.current)
    state.markers.push(marker)
    atualizarPoligonoDesenho()
    if (state.pontos.length >= 3) {
      marker.once('click', () => fecharPoligono())
    }
  }

  function atualizarPoligonoDesenho() {
    const state = drawStateRef.current
    if (state.polyline) drawLayerRef.current.removeLayer(state.polyline)
    if (state.pontos.length >= 2) {
      state.polyline = L.polyline(state.pontos, {
        color: '#38bdf8', weight: 2, dashArray: '6,4'
      }).addTo(drawLayerRef.current)
    }
  }

  function atualizarLinhaPreview(latlng) {
    const state = drawStateRef.current
    if (!state.previewLine) {
      state.previewLine = L.polyline([], { color: '#38bdf8', weight: 1.5, dashArray: '4,4', opacity: 0.6 })
        .addTo(drawLayerRef.current)
    }
    const ultimo = state.pontos[state.pontos.length - 1]
    state.previewLine.setLatLngs([ultimo, latlng])
  }

  function fecharPoligono() {
    const state = drawStateRef.current
    if (state.pontos.length < 3) return
    const polygon = L.polygon(state.pontos, {
      color: RISCO_CORES[nivelRisco], fillColor: RISCO_CORES[nivelRisco], fillOpacity: 0.3, weight: 2
    })
    setPolyRascunho({ pontos: [...state.pontos], polygon })
    limparDesenho()
    setSalvandoArea(true)
    setModoDesenho(null)
    polygon.addTo(drawLayerRef.current)
  }

  function limparDesenho() {
    const state = drawStateRef.current
    state.markers.forEach(m => drawLayerRef.current?.removeLayer(m))
    if (state.polyline) drawLayerRef.current?.removeLayer(state.polyline)
    if (state.previewLine) drawLayerRef.current?.removeLayer(state.previewLine)
    state.pontos = []; state.markers = []; state.polyline = null; state.previewLine = null
  }

  async function confirmarArea() {
    if (!polyRascunho) return
    const coords = polyRascunho.pontos.map(p => [p.lng, p.lat])
    coords.push(coords[0])
    const geom = { type: 'Polygon', coordinates: [coords] }
    try {
      await api.createAreaRisco({ nivel: nivelRisco, descricao: descRisco, cidade, geojson: geom })
    } catch {
      const areas = JSON.parse(localStorage.getItem('areasRisco') || '[]')
      areas.push({ nivel: nivelRisco, descricao: descRisco, cidade, data: new Date().toISOString() })
      localStorage.setItem('areasRisco', JSON.stringify(areas))
    }
    drawLayerRef.current?.clearLayers()
    setSalvandoArea(false)
    setPolyRascunho(null)
    setDescRisco('')
    carregarDados()
  }

  function cancelarArea() {
    drawLayerRef.current?.clearLayers()
    setSalvandoArea(false)
    setPolyRascunho(null)
    setDescRisco('')
    setModoDesenho(null)
  }

  function toggleOverlay(key) {
    setOverlays(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const riscoAtual = calcularRiscoAtual(precipitacao)

  return (
    <div className={styles.wrapper}>

      {/* ── Toolbar superior ──────────────────────────────── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <select className={styles.select} value={cidade} onChange={e => setCidade(e.target.value)}>
            {Object.values(CIDADES).map(c => (
              <option key={c.codigo} value={c.codigo}>{c.nome}</option>
            ))}
          </select>

          {/* Indicador de risco automático */}
          {riscoAtual && (
            <div className={styles.riscoIndicador} style={{ borderColor: riscoAtual.cor + '66', background: riscoAtual.cor + '15' }}>
              <span className={styles.riscoIndicadorDot} style={{ background: riscoAtual.cor }} />
              <span className={styles.riscoIndicadorLabel} style={{ color: riscoAtual.cor }}>
                Risco {riscoAtual.texto}
              </span>
              <span className={styles.riscoIndicadorSub}>
                {precipitacao} mm/h
              </span>
            </div>
          )}
        </div>

        <div className={styles.toolbarRight}>
          {modoDesenho ? (
            <>
              <span className={styles.desenhoHint}>
                ✏️ Clique para adicionar pontos · Clique no último ponto para fechar
              </span>
              <button className={styles.cancelarBtn} onClick={cancelarArea}>
                <FiX size={13} /> Cancelar
              </button>
            </>
          ) : (
            !salvandoArea && (
              <button className={styles.desenhoBtn} onClick={() => setModoDesenho('polygon')}>
                <FiSquare size={12} /> Área de Risco
              </button>
            )
          )}

          <button
            className={`${styles.toolBtn} ${showLegenda ? styles.toolBtnActive : ''}`}
            onClick={() => setShowLegenda(s => !s)}
            title="Legenda"
          >
            <FiBookOpen size={14} />
            <span>Legenda</span>
          </button>

          <button
            className={`${styles.toolBtn} ${showClima ? styles.toolBtnActive : ''}`}
            onClick={() => setShowClima(s => !s)}
            title="Clima"
          >
            <FiCloud size={14} />
            <span>Clima</span>
          </button>

          <button
            className={styles.iconBtn}
            onClick={() => carregarDados()}
            title="Recarregar dados"
          >
            <FiRefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ── Modal confirmar área ───────────────────────────── */}
      {salvandoArea && (
        <div className={styles.modalArea}>
          <div className={styles.modalAreaHeader}>
            <FiAlertTriangle size={16} color="#f97316" />
            <h3>Confirmar Área de Risco</h3>
          </div>
          <label className={styles.modalLabel}>Nível de Risco</label>
          <div className={styles.riscoOpcoes}>
            {['R1', 'R2', 'R3', 'R4'].map(r => (
              <button
                key={r}
                className={`${styles.riscoOpcao} ${nivelRisco === r ? styles.riscoOpcaoAtivo : ''}`}
                style={nivelRisco === r ? { background: RISCO_CORES[r] + '30', borderColor: RISCO_CORES[r], color: RISCO_CORES[r] } : {}}
                onClick={() => setNivelRisco(r)}
              >
                <span className={styles.riscoOpcaoNivel}>{r}</span>
                <span className={styles.riscoOpcaoSub}>{RISCO_LABELS[r].label}</span>
              </button>
            ))}
          </div>
          <label className={styles.modalLabel}>Descrição (opcional)</label>
          <input
            className={styles.descInput}
            placeholder="Descreva a área de risco..."
            value={descRisco}
            onChange={e => setDescRisco(e.target.value)}
          />
          <div className={styles.modalBtns}>
            <button className={styles.confirmarBtn} onClick={confirmarArea}>
              <FiCheck size={13} /> Salvar Área
            </button>
            <button className={styles.cancelarModalBtn} onClick={cancelarArea}>
              <FiX size={13} /> Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Painel de Camadas ──────────────────────────────── */}
      <div className={`${styles.layerPanel} ${!showCamadas ? styles.layerPanelCollapsed : ''}`}>
        <div className={styles.layerPanelHeader} onClick={() => setShowCamadas(s => !s)}>
          <FiLayers size={13} />
          <span>Camadas</span>
          {showCamadas ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
        </div>

        {showCamadas && (
          <>
            {/* Seção: Mapa Base */}
            <div className={styles.layerSection}>
              <div className={styles.layerSectionTitle} onClick={() => setSecaoBase(s => !s)}>
                {secaoBase ? <FiChevronDown size={10} /> : <FiChevronRight size={10} />}
                <span>Mapa Base</span>
              </div>
              {secaoBase && (
                <div className={styles.layerBaseGrid}>
                  {CAMADAS_BASE.map(c => (
                    <button
                      key={c.id}
                      className={`${styles.layerBaseBtn} ${camada === c.id ? styles.layerBaseBtnActive : ''}`}
                      onClick={() => setCamada(c.id)}
                    >
                      <span className={styles.layerBaseIcone}>{c.icone}</span>
                      <span className={styles.layerBaseLabel}>{c.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Seção: Sobreposições */}
            <div className={styles.layerSection}>
              <div className={styles.layerSectionTitle} onClick={() => setSecaoOverlay(s => !s)}>
                {secaoOverlay ? <FiChevronDown size={10} /> : <FiChevronRight size={10} />}
                <span>Sobreposições</span>
              </div>
              {secaoOverlay && (
                <div className={styles.overlayList}>
                  <div className={styles.overlayItem}>
                    <div className={styles.overlayInfo}>
                      <span className={styles.overlayIcone}>🌧️</span>
                      <div>
                        <span className={styles.overlayNome}>Radar de Chuva</span>
                        {radarTs && overlays.chuva && (
                          <span className={styles.overlayTs}>Atualizado {radarTs}</span>
                        )}
                      </div>
                    </div>
                    <button
                      className={`${styles.toggle} ${overlays.chuva ? styles.toggleOn : ''}`}
                      onClick={() => toggleOverlay('chuva')}
                    >
                      <span className={styles.toggleKnob} />
                    </button>
                  </div>

                  <div className={styles.overlayItem}>
                    <div className={styles.overlayInfo}>
                      <span className={styles.overlayIcone}>🔥</span>
                      <div>
                        <span className={styles.overlayNome}>Densidade Ocorrências</span>
                        <span className={styles.overlayTs}>{ocorrenciasLatLng.length} ponto(s)</span>
                      </div>
                    </div>
                    <button
                      className={`${styles.toggle} ${overlays.heatmap ? styles.toggleOn : ''}`}
                      onClick={() => toggleOverlay('heatmap')}
                    >
                      <span className={styles.toggleKnob} />
                    </button>
                  </div>

                  <div className={styles.overlayItem}>
                    <div className={styles.overlayInfo}>
                      <span className={styles.overlayIcone}>⚠️</span>
                      <div>
                        <span className={styles.overlayNome}>Áreas de Risco</span>
                      </div>
                    </div>
                    <button
                      className={`${styles.toggle} ${overlays.areas ? styles.toggleOn : ''}`}
                      onClick={() => toggleOverlay('areas')}
                    >
                      <span className={styles.toggleKnob} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Painel Legenda ─────────────────────────────────── */}
      {showLegenda && (
        <div className={styles.legendaPanel}>
          <div className={styles.legendaHeader}>
            <span>Legenda</span>
            <button className={styles.legendaFechar} onClick={() => setShowLegenda(false)}>
              <FiX size={13} />
            </button>
          </div>

          <div className={styles.legendaSecao}>
            <div className={styles.legendaSecaoTitle}>Áreas de Risco Geotécnico</div>
            {Object.entries(RISCO_CORES).map(([nivel, cor]) => (
              <div key={nivel} className={styles.legendaItem}>
                <span className={styles.legendaBox} style={{ background: cor + '40', border: `2px solid ${cor}` }} />
                <div>
                  <span className={styles.legendaItemLabel}>{nivel}</span>
                  <span className={styles.legendaItemSub}>{RISCO_LABELS[nivel].label}</span>
                </div>
              </div>
            ))}
          </div>

          <div className={styles.legendaSecao}>
            <div className={styles.legendaSecaoTitle}>Ocorrências</div>
            {Object.entries(NIVEL_CORES).map(([nivel, cor]) => (
              <div key={nivel} className={styles.legendaItem}>
                <span className={styles.legendaDot} style={{ background: cor }} />
                <span className={styles.legendaItemLabel} style={{ textTransform: 'capitalize' }}>{nivel}</span>
              </div>
            ))}
          </div>

          {overlays.chuva && (
            <div className={styles.legendaSecao}>
              <div className={styles.legendaSecaoTitle}>Radar de Chuva</div>
              <div className={styles.radarLegenda}>
                <div className={styles.radarBarra} />
                <div className={styles.radarLabels}>
                  <span>0</span><span>mm/h</span><span>50+</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Painel Clima ───────────────────────────────────── */}
      {showClima && (
        <div className={styles.climaPanel}>
          <button className={styles.fecharClima} onClick={() => setShowClima(false)}>
            <FiX size={14} />
          </button>
          <PainelClima cidade={cidade} />
        </div>
      )}

      {/* ── Barra de coordenadas ───────────────────────────── */}
      {coordAtual && (
        <div className={styles.coordBar}>
          <FiMapPin size={11} />
          {coordAtual.lat.toFixed(5)}, {coordAtual.lng.toFixed(5)}
        </div>
      )}

      {/* ── Mapa ──────────────────────────────────────────── */}
      <div ref={mapRef} className={styles.map} />
    </div>
  )
}
