import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../services/api'
import { CIDADES, CIDADE_PADRAO } from '../data/cidades'
import PainelClima from './PainelClima'
import styles from './Mapa.module.css'
import {
  FiMapPin, FiCloud, FiX, FiCheck, FiRefreshCw, FiEdit3,
  FiSquare, FiZoomIn
} from 'react-icons/fi'

const CAMADAS = [
  {
    id: 'ruas',
    label: 'Ruas',
    icone: '🗺️',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>'
  },
  {
    id: 'satelite',
    label: 'Satélite',
    icone: '🛰️',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri'
  },
  {
    id: 'topografico',
    label: 'Topografia',
    icone: '⛰️',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap'
  }
]

const RISCO_CORES = { R1: '#22c55e', R2: '#eab308', R3: '#f97316', R4: '#ef4444' }

const NIVEL_CORES = {
  critico: '#ef4444', alto: '#f97316', medio: '#eab308', baixo: '#22c55e'
}

// Ícone customizado para ocorrências
function criarIconeNivel(cor) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:${cor};border:2.5px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,0.5);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  })
}

export default function Mapa() {
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const tileLayerRef = useRef(null)
  const ocMarkerLayerRef = useRef(null)
  const areaLayerRef = useRef(null)
  const drawLayerRef = useRef(null)
  const drawStateRef = useRef({ ativo: false, pontos: [], markers: [], polyline: null })

  const [camada, setCamada] = useState('ruas')
  const [cidade, setCidade] = useState(CIDADE_PADRAO)
  const [coordAtual, setCoordAtual] = useState(null)
  const [showClima, setShowClima] = useState(false)
  const [modoDesenho, setModoDesenho] = useState(null) // null | 'polygon' | 'freehand'
  const [salvandoArea, setSalvandoArea] = useState(false)
  const [nivelRisco, setNivelRisco] = useState('R2')
  const [descRisco, setDescRisco] = useState('')
  const [polyRascunho, setPolyRascunho] = useState(null)
  const [cursor, setCursor] = useState('')

  // ── Inicializar mapa ─────────────────────────────────────
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

    const camadaObj = CAMADAS.find(c => c.id === 'ruas')
    tileLayerRef.current = L.tileLayer(camadaObj.url, {
      attribution: camadaObj.attribution,
      maxZoom: 19
    }).addTo(map)

    ocMarkerLayerRef.current = L.layerGroup().addTo(map)
    areaLayerRef.current = L.layerGroup().addTo(map)
    drawLayerRef.current = L.layerGroup().addTo(map)

    map.on('click', handleMapClick)
    map.on('mousemove', (e) => {
      setCoordAtual({ lat: e.latlng.lat, lng: e.latlng.lng })
      if (drawStateRef.current.ativo && drawStateRef.current.pontos.length > 0) {
        atualizarLinhaPreview(e.latlng)
      }
    })

    leafletRef.current = map
    carregarDados(map)
    return () => { map.remove(); leafletRef.current = null }
  }, [])

  // ── Trocar camada ────────────────────────────────────────
  useEffect(() => {
    if (!leafletRef.current || !tileLayerRef.current) return
    const camadaObj = CAMADAS.find(c => c.id === camada)
    tileLayerRef.current.setUrl(camadaObj.url)
  }, [camada])

  // ── Voar para cidade ──────────────────────────────────────
  useEffect(() => {
    if (!leafletRef.current) return
    const c = CIDADES[cidade]
    const [lng, lat] = c.center
    leafletRef.current.flyTo([lat, lng], c.zoom, { duration: 1.4 })
  }, [cidade])

  // ── Cursor modo desenho ───────────────────────────────────
  useEffect(() => {
    const el = mapRef.current
    if (!el) return
    if (modoDesenho) {
      el.style.cursor = 'crosshair'
    } else {
      el.style.cursor = ''
    }
    drawStateRef.current.ativo = !!modoDesenho
    if (!modoDesenho) {
      limparDesenho()
    }
  }, [modoDesenho])

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

    // duplo clique: fechar polígono
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
      if (ocGeo?.features) {
        L.geoJSON(ocGeo, {
          pointToLayer: (feature, latlng) => {
            const cor = NIVEL_CORES[feature.properties.nivel] || '#38bdf8'
            return L.marker(latlng, { icon: criarIconeNivel(cor) })
          },
          onEachFeature: (feature, layer) => {
            const p = feature.properties
            layer.bindPopup(`<b>${p.tipo}</b><br><small>${p.descricao || ''}</small>`)
          }
        }).addTo(ocMarkerLayerRef.current)
      }
      if (arGeo?.features) {
        L.geoJSON(arGeo, {
          style: (feature) => {
            const cor = RISCO_CORES[feature.properties.nivel] || '#94a3b8'
            return { color: cor, fillColor: cor, fillOpacity: 0.25, weight: 2 }
          },
          onEachFeature: (feature, layer) => {
            const p = feature.properties
            layer.bindPopup(`<b>Área de Risco ${p.nivel}</b><br>${p.descricao || ''}`)
          }
        }).addTo(areaLayerRef.current)
      }
    } catch {
      // fallback localStorage ocorrências
      const ocs = JSON.parse(localStorage.getItem('ocorrencias') || '[]')
      ocs.filter(o => o.coordenada || (o.lat && o.lng)).forEach(o => {
        const lat = o.lat || o.coordenada?.lat
        const lng = o.lng || o.coordenada?.lng
        if (!lat) return
        const cor = NIVEL_CORES[o.nivel] || '#38bdf8'
        L.marker([lat, lng], { icon: criarIconeNivel(cor) })
          .bindPopup(`<b>${o.tipo}</b><br><small>${o.descricao || ''}</small>`)
          .addTo(ocMarkerLayerRef.current)
      })
    }
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

  // Atualizar cor do polígono rascunho ao mudar nível
  useEffect(() => {
    if (polyRascunho?.polygon) {
      polyRascunho.polygon.setStyle({
        color: RISCO_CORES[nivelRisco], fillColor: RISCO_CORES[nivelRisco]
      })
    }
  }, [nivelRisco, polyRascunho])

  return (
    <div className={styles.wrapper}>
      {/* Toolbar superior */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <select className={styles.select} value={cidade} onChange={e => setCidade(e.target.value)}>
            {Object.values(CIDADES).map(c => (
              <option key={c.codigo} value={c.codigo}>{c.nome}</option>
            ))}
          </select>
        </div>
        <div className={styles.toolbarRight}>
          {!modoDesenho && !salvandoArea && (
            <button className={styles.desenhoBtn} onClick={() => setModoDesenho('polygon')}>
              <FiSquare size={12} /> Área de Risco
            </button>
          )}
          {modoDesenho && !salvandoArea && (
            <>
              <span className={styles.desenhoHint}>
                Clique para pontos • Clique no último ponto para fechar
              </span>
              <button className={styles.cancelarBtn} onClick={cancelarArea}>
                <FiX size={13} /> Cancelar
              </button>
            </>
          )}
          <button
            className={`${styles.climaBtn} ${showClima ? styles.climaBtnActive : ''}`}
            onClick={() => setShowClima(s => !s)}
          >
            <FiCloud size={13} /> Clima
          </button>
          <button className={styles.reloadBtn} onClick={() => carregarDados()} title="Recarregar dados">
            <FiRefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Modal confirmar área */}
      {salvandoArea && (
        <div className={styles.modalArea}>
          <h3>Confirmar Área de Risco</h3>
          <label>Nível de Risco</label>
          <div className={styles.riscoOpcoes}>
            {['R1','R2','R3','R4'].map(r => (
              <button
                key={r}
                className={`${styles.riscoOpcao} ${nivelRisco === r ? styles.riscoOpcaoAtivo : ''}`}
                style={nivelRisco === r ? { background: RISCO_CORES[r], borderColor: RISCO_CORES[r], color: '#fff' } : {}}
                onClick={() => setNivelRisco(r)}
              >{r}</button>
            ))}
          </div>
          <label>Descrição (opcional)</label>
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

      {/* Barra de coordenadas */}
      {coordAtual && (
        <div className={styles.coordBar}>
          <FiMapPin size={11} />
          {coordAtual.lat.toFixed(5)}, {coordAtual.lng.toFixed(5)}
        </div>
      )}

      {/* Painel de camadas flutuante */}
      <div className={styles.layerPanel}>
        <div className={styles.layerPanelTitle}>Camada</div>
        {CAMADAS.map(c => (
          <button
            key={c.id}
            className={`${styles.layerBtn} ${camada === c.id ? styles.layerBtnActive : ''}`}
            onClick={() => setCamada(c.id)}
            title={c.label}
          >
            <span className={styles.layerIcone}>{c.icone}</span>
            <span className={styles.layerLabel}>{c.label}</span>
          </button>
        ))}
      </div>

      {/* Painel clima */}
      {showClima && (
        <div className={styles.climaPanel}>
          <button className={styles.fecharClima} onClick={() => setShowClima(false)}>
            <FiX size={14} />
          </button>
          <PainelClima cidade={cidade} />
        </div>
      )}

      {/* Container do mapa */}
      <div ref={mapRef} className={styles.map} />
    </div>
  )
}
