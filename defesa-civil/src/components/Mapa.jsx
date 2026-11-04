import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as maplibregl from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api, fetchApi } from '../services/api'
import { CIDADES, CIDADE_PADRAO } from '../data/cidades'
import {
  areasRiscoFeatureCollection,
  areaCentroide,
  areaGeometry,
  CORES_AREAS_RISCO,
  ICONES_AREAS_RISCO,
  TIPOS_AREAS_RISCO,
} from '../data/areasRisco'
import PainelClima from './PainelClima'
import PainelAreasRisco from './PainelAreasRisco'
import MapaLeafletFallback from './MapaLeafletFallback'
import styles from './Mapa.module.css'
import {
  FiMapPin, FiCloud, FiX, FiCheck, FiRefreshCw, FiSquare,
  FiLayers, FiBookOpen, FiAlertTriangle, FiChevronDown,
  FiChevronRight, FiNavigation, FiClipboard, FiZoomIn, FiCloudRain,
  FiRotateCcw, FiTrash2,
} from 'react-icons/fi'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

// ── Constantes ────────────────────────────────────────────────
const RISCO_CORES = { R1: '#22c55e', R2: '#eab308', R3: '#f97316', R4: '#ef4444' }
const RISCO_LABELS = {
  R1: { label: 'Baixo Risco', sub: 'Condição estável' },
  R2: { label: 'Médio Risco', sub: 'Atenção moderada' },
  R3: { label: 'Alto Risco', sub: 'Situação crítica' },
  R4: { label: 'Muito Alto', sub: 'Emergência' },
}

const CAMADAS_BASE = [
  { id: 'ruas',          label: 'Ruas',       icone: '🗺️' },
  { id: 'satelite',      label: 'Satélite',   icone: '🛰️' },
  { id: 'topografico',   label: 'Topomap',    icone: '⛰️' },
  { id: 'esri_topo',     label: 'ESRI Topo',  icone: '🏔️' },
  { id: 'positron',      label: 'Positron',   icone: '⬜' },
  { id: 'dark',          label: 'Dark',       icone: '🌑' },
]

const BASE_LAYER_ID = {
  ruas:        'base-ruas',
  satelite:    'base-satelite',
  topografico: 'base-topo',
  esri_topo:   'base-esri',
  positron:    'base-positron',
  dark:        'base-dark',
}

function browserSupportsWebGL2() {
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
    if (!context) return false
    context.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

function calcularRiscoAtual(precipitacao) {
  if (precipitacao === null) return null
  if (precipitacao >= 15) return { cor: '#ef4444', texto: 'Muito Alto' }
  if (precipitacao >= 8)  return { cor: '#f97316', texto: 'Alto' }
  if (precipitacao >= 2)  return { cor: '#eab308', texto: 'Médio' }
  return { cor: '#22c55e', texto: 'Baixo' }
}

function popupSeguro(titulo, descricao, cor, etiqueta) {
  const conteudo = document.createElement('div')
  conteudo.style.fontFamily = 'sans-serif'
  conteudo.style.padding = '4px'

  const tituloEl = document.createElement('strong')
  tituloEl.textContent = titulo || 'Registro'
  tituloEl.style.color = cor
  conteudo.appendChild(tituloEl)

  const descricaoEl = document.createElement('div')
  descricaoEl.textContent = descricao || '—'
  descricaoEl.style.cssText = 'color:#64748b;font-size:12px;margin-top:3px;white-space:pre-wrap'
  conteudo.appendChild(descricaoEl)

  if (etiqueta) {
    const etiquetaEl = document.createElement('span')
    etiquetaEl.textContent = etiqueta
    etiquetaEl.style.cssText = `display:inline-block;margin-top:6px;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:700;background:${cor}22;color:${cor}`
    conteudo.appendChild(etiquetaEl)
  }
  return conteudo
}

// ── Estilo base do mapa (todas as camadas raster) ─────────────
function buildStyle() {
  const rasterSource = (tiles, maxzoom = 19, attribution = '') => ({
    type: 'raster', tiles, tileSize: 256, maxzoom, attribution,
  })
  return {
    version: 8,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources: {
      'src-ruas':     rasterSource(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], 19, '© OpenStreetMap'),
      'src-satelite': rasterSource(['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], 20, '© Esri'),
      'src-topo':     rasterSource(['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'], 17, '© OpenTopoMap'),
      'src-esri':     rasterSource(['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'], 19, '© Esri'),
      'src-positron': rasterSource(['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'], 19, '© CartoDB'),
      'src-dark':     rasterSource(['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'], 19, '© CartoDB'),
      'terrain': {
        type: 'raster-dem',
        tiles: ['/api/dem-tile/{z}/{x}/{y}'],
        tileSize: 256, maxzoom: 15,
        encoding: 'terrarium',
      },
    },
    layers: [
      { id: 'base-ruas',     type: 'raster', source: 'src-ruas' },
      { id: 'base-satelite', type: 'raster', source: 'src-satelite', layout: { visibility: 'none' } },
      { id: 'base-topo',     type: 'raster', source: 'src-topo',     layout: { visibility: 'none' } },
      { id: 'base-esri',     type: 'raster', source: 'src-esri',     layout: { visibility: 'none' } },
      { id: 'base-positron', type: 'raster', source: 'src-positron', layout: { visibility: 'none' } },
      { id: 'base-dark',     type: 'raster', source: 'src-dark',     layout: { visibility: 'none' } },
    ],
  }
}

// ── Componente principal ──────────────────────────────────────
export default function Mapa() {
  const mapRef   = useRef(null)
  const mapGl    = useRef(null)
  const leafletMapRef = useRef(null)
  const markersAreasRiscoRef = useRef([])
  const loadedRef = useRef(false)
  const drawRef  = useRef({ ativo: false, pontos: [] })
  const nivelRef = useRef('R2')
  const gpsWatch = useRef(null)

  const [camada,          setCamada]          = useState('ruas')
  const [cidade,          setCidade]          = useState(CIDADE_PADRAO)
  const [coordAtual,      setCoordAtual]      = useState(null)
  const [showClima,       setShowClima]       = useState(false)
  const [showLegenda,     setShowLegenda]     = useState(false)
  const [showAreasRisco,  setShowAreasRisco]  = useState(false)
  const [showMapOptions,  setShowMapOptions]  = useState(false)
  const [modoDesenho,     setModoDesenho]     = useState(null)
  const [salvandoArea,    setSalvandoArea]    = useState(false)
  const [nivelRisco,      setNivelRisco]      = useState('R2')
  const [tipoAreaRisco,   setTipoAreaRisco]   = useState('Encostas')
  const [limiteChuva,     setLimiteChuva]     = useState('35')
  const [dataInicioRisco, setDataInicioRisco] = useState(() => new Date().toISOString().slice(0, 10))
  const [descRisco,       setDescRisco]       = useState('')
  const [referenciaRisco, setReferenciaRisco] = useState('')
  const [observacaoRisco, setObservacaoRisco] = useState('')
  const [erroSalvarArea,  setErroSalvarArea]  = useState('')
  const [statusSalvarArea,setStatusSalvarArea]= useState('')
  const [areasRisco,      setAreasRisco]      = useState([])
  const [previsoesAreas,  setPrevisoesAreas]  = useState({})
  const [previsaoAtualizadaEm, setPrevisaoAtualizadaEm] = useState(null)
  const [carregandoPrevisaoAreas, setCarregandoPrevisaoAreas] = useState(false)
  const [erroPrevisaoAreas, setErroPrevisaoAreas] = useState('')
  const [polyRascunho,    setPolyRascunho]    = useState(null)
  const [areaEditando,    setAreaEditando]    = useState(null)
  const [overlays,        setOverlays]        = useState({
    areas: true, vistorias: true,
  })
  const [precipitacao,    setPrecipitacao]    = useState(null)
  const [secaoBase,       setSecaoBase]       = useState(true)
  const [secaoOverlay,    setSecaoOverlay]    = useState(true)
  const [gpsAtivo,        setGpsAtivo]        = useState(false)
  const [terreno3D,       setTerreno3D]       = useState(false)
  const [painelVistoria,  setPainelVistoria]  = useState(null)
  const [webglError,      setWebglError]      = useState(false)
  const [mapLoaded,       setMapLoaded]       = useState(false)
  const [leafletDrawPoints, setLeafletDrawPoints] = useState([])
  const [leafletGpsPosition, setLeafletGpsPosition] = useState(null)
  const [refreshMapVersion, setRefreshMapVersion] = useState(0)
  const navigate = useNavigate()
  const cityRef = useRef(cidade)
  const previsaoRequestRef = useRef(0)
  const areasDaCidade = useMemo(
    () => areasRisco.filter(area => !area.cidade || area.cidade === cidade),
    [areasRisco, cidade],
  )
  const areasGeoJSON = useMemo(
    () => areasRiscoFeatureCollection(areasRisco, previsoesAreas, cidade),
    [areasRisco, previsoesAreas, cidade],
  )
  cityRef.current = cidade

  // ── Inicializar mapa ────────────────────────────────────────
  useEffect(() => {
    if (mapGl.current) return
    if (!browserSupportsWebGL2()) {
      loadedRef.current = false
      setWebglError(true)
      return
    }

    const cidadeObj = CIDADES[cidade]
    const [lng0, lat0] = cidadeObj.center

    let map
    let disposed = false
    try {
      map = new maplibregl.Map({
        container: mapRef.current,
        style: buildStyle(),
        center: [lng0, lat0],
        zoom: cidadeObj.zoom,
        maxZoom: 22,
        pitch: 0, bearing: 0,
        antialias: true,
        attributionControl: { compact: true },
        failIfMajorPerformanceCaveat: false,
      })
    } catch (err) {
      console.warn('Falha ao inicializar MapLibre-GL:', err?.message || err)
      loadedRef.current = false
      setWebglError(true)
      return
    }

    map.on('error', event => {
      const message = event?.error?.message || event?.message || ''
      if (!/webgl2|webgl context|context lost/i.test(message)) return
      console.warn('MapLibre indisponível; usando o mapa alternativo:', message)
      loadedRef.current = false
      mapGl.current = null
      setMapLoaded(false)
      try { map.remove() } catch {}
      if (!disposed) setWebglError(true)
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
      loadedRef.current = true
      setMapLoaded(true)

      // ── Fontes de dados GeoJSON ───────────────────────────
      const emptyGeo = { type: 'FeatureCollection', features: [] }

      map.addSource('areas-risco',         { type: 'geojson', data: emptyGeo })
      map.addSource('draw-src',            { type: 'geojson', data: emptyGeo })
      map.addSource('draw-preview-src',    { type: 'geojson', data: emptyGeo })
      map.addSource('gps-src',             { type: 'geojson', data: emptyGeo })
      map.addSource('vistorias-pontos-src',{ type: 'geojson', data: emptyGeo, cluster: true, clusterMaxZoom: 14, clusterRadius: 50 })
      map.addSource('vistorias-poly-src',  { type: 'geojson', data: emptyGeo })

      // ── Camadas de dados ──────────────────────────────────

      // Áreas de risco
      map.addLayer({
        id: 'areas-fill', type: 'fill', source: 'areas-risco',
        paint: {
          'fill-color': ['coalesce', ['get', 'cor'], ['match', ['get', 'nivel'], 'R1','#22c55e','R2','#eab308','R3','#f97316','R4','#ef4444','#94a3b8']],
          'fill-opacity': ['case', ['==', ['get', 'em_alerta'], true], 0.34, 0.2],
        },
        layout: { visibility: 'visible' },
      })
      map.addLayer({
        id: 'areas-outline', type: 'line', source: 'areas-risco',
        paint: {
          'line-color': ['coalesce', ['get', 'cor'], ['match', ['get', 'nivel'], 'R1','#22c55e','R2','#eab308','R3','#f97316','R4','#ef4444','#94a3b8']],
          'line-width': ['case', ['==', ['get', 'em_alerta'], true], 4, 2.5],
        },
        layout: { visibility: 'visible' },
      })

      // Vistorias — polígonos
      map.addLayer({
        id: 'vis-poly-fill', type: 'fill', source: 'vistorias-poly-src',
        paint: {
          'fill-color': ['match', ['get','risco'],'R1','#22c55e','R2','#eab308','R3','#f97316','R4','#ef4444','#64748b'],
          'fill-opacity': 0.15,
        },
        layout: { visibility: 'visible' },
      })
      map.addLayer({
        id: 'vis-poly-line', type: 'line', source: 'vistorias-poly-src',
        paint: {
          'line-color': ['match', ['get','risco'],'R1','#22c55e','R2','#eab308','R3','#f97316','R4','#ef4444','#64748b'],
          'line-width': 2,
        },
        layout: { visibility: 'visible' },
      })

      // Vistorias — clusters
      map.addLayer({
        id: 'vis-clusters', type: 'circle', source: 'vistorias-pontos-src',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get','point_count'], '#22c55e', 3,'#eab308', 7,'#ef4444'],
          'circle-radius': ['step', ['get','point_count'], 20, 3,28, 7,36],
          'circle-stroke-width': 3, 'circle-stroke-color': '#fff',
          'circle-opacity': 0.92,
        },
        layout: { visibility: 'visible' },
      })
      map.addLayer({
        id: 'vis-cluster-count', type: 'symbol', source: 'vistorias-pontos-src',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Open Sans Bold'],
          'text-size': 14,
        },
        paint: { 'text-color': '#fff' },
        layout: { visibility: 'visible' },
      })
      map.addLayer({
        id: 'vis-pontos', type: 'circle', source: 'vistorias-pontos-src',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 9,
          'circle-color': ['match', ['get','risco'],'R1','#22c55e','R2','#eab308','R3','#f97316','R4','#ef4444','#64748b'],
          'circle-stroke-width': 2.5, 'circle-stroke-color': '#fff',
        },
        layout: { visibility: 'visible' },
      })

      // GPS
      map.addLayer({
        id: 'gps-acc', type: 'circle', source: 'gps-src',
        paint: {
          'circle-radius': ['get', 'accPx'],
          'circle-color': '#2563eb', 'circle-opacity': 0.08,
          'circle-stroke-width': 1.5, 'circle-stroke-color': '#2563eb',
          'circle-stroke-opacity': 0.4,
        },
        layout: { visibility: 'none' },
      })
      map.addLayer({
        id: 'gps-dot', type: 'circle', source: 'gps-src',
        paint: {
          'circle-radius': 9, 'circle-color': '#2563eb',
          'circle-stroke-width': 3, 'circle-stroke-color': '#fff',
        },
        layout: { visibility: 'none' },
      })

      // Desenho
      map.addLayer({
        id: 'draw-fill', type: 'fill', source: 'draw-src',
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': ['get','color'], 'fill-opacity': 0.25 },
      })
      map.addLayer({
        id: 'draw-line', type: 'line', source: 'draw-src',
        paint: { 'line-color': ['get','color'], 'line-width': 2.5, 'line-dasharray': [5, 3] },
      })
      map.addLayer({
        id: 'draw-pts', type: 'circle', source: 'draw-src',
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': '#38bdf8', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' },
      })
      map.addLayer({
        id: 'draw-preview', type: 'line', source: 'draw-preview-src',
        paint: { 'line-color': '#38bdf8', 'line-width': 1.5, 'line-dasharray': [4,4], 'line-opacity': 0.6 },
      })

      // ── Eventos ───────────────────────────────────────────
      map.on('mousemove', e => setCoordAtual({ lat: e.lngLat.lat, lng: e.lngLat.lng }))

      // Click no mapa — desenho ou coordenada
      map.on('click', e => {
        if (!drawRef.current.ativo) {
          try {
            localStorage.setItem('ultimaCoordenada', JSON.stringify({
              lat: e.lngLat.lat, lng: e.lngLat.lng, cidade: cityRef.current,
            }))
          } catch {}
          return
        }
        adicionarPonto(e.lngLat, map)
      })

      // Preview linha de desenho
      map.on('mousemove', e => {
        if (!drawRef.current.ativo || drawRef.current.pontos.length === 0) return
        const last = drawRef.current.pontos[drawRef.current.pontos.length - 1]
        map.getSource('draw-preview-src')?.setData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [last, [e.lngLat.lng, e.lngLat.lat]] }, properties: {} }],
        })
      })

      // Click nas vistorias — painel de detalhe
      map.on('click', 'vis-pontos', e => {
        const data = e.features[0]?.properties?.vistoriaData
        if (data) { try { setPainelVistoria(JSON.parse(data)) } catch (_) {} }
        e.preventDefault()
      })
      map.on('click', 'vis-poly-fill', e => {
        const data = e.features[0]?.properties?.vistoriaData
        if (data) { try { setPainelVistoria(JSON.parse(data)) } catch (_) {} }
        e.preventDefault()
      })

      // Click no cluster — zoom in
      map.on('click', 'vis-clusters', e => {
        const f = e.features[0]
        const clusterId = f.properties.cluster_id
        map.getSource('vistorias-pontos-src').getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (!err) map.easeTo({ center: f.geometry.coordinates, zoom: zoom + 1, duration: 500 })
        })
      })

      // Popups — áreas de risco
      map.on('click', 'areas-fill', e => {
        const p = e.features[0].properties
        const cor = p.cor || RISCO_CORES[p.nivel] || '#94a3b8'
        const emAlerta = p.em_alerta === true || p.em_alerta === 'true'
        const detalhes = [
          p.descricao,
          `Previsão 24 h: ${p.previsao_24h_mm == null ? 'sem dado' : `${Number(p.previsao_24h_mm).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm`}`,
          `Limite: ${p.limite_precipitacao_mm == null ? '—' : `${Number(p.limite_precipitacao_mm).toLocaleString('pt-BR')} mm`}`,
          p.referencia && `Referência: ${p.referencia}`,
          p.observacao && `Observação: ${p.observacao}`,
          CIDADES[p.cidade]?.nome,
        ].filter(Boolean).join('\n')
        new maplibregl.Popup({ closeButton: true, maxWidth: '240px' })
          .setLngLat(e.lngLat)
          .setDOMContent(popupSeguro(`${p.tipo || 'Área de Risco'} · ${p.nivel || ''}`, detalhes, cor, emAlerta ? 'ALERTA · chuva acima do limite' : ''))
          .addTo(map)
      })

      // Cursores
      const cursors = [
        { in: 'vis-pontos',   out: 'vis-pontos' },
        { in: 'vis-clusters', out: 'vis-clusters' },
        { in: 'areas-fill',   out: 'areas-fill' },
        { in: 'vis-poly-fill', out: 'vis-poly-fill' },
      ]
      cursors.forEach(({ in: enter, out: leave }) => {
        map.on('mouseenter', enter, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', leave, () => { map.getCanvas().style.cursor = '' })
      })

      carregarDados(map)
      carregarClima(cidade)
    })

    mapGl.current = map
    return () => {
      disposed = true
      if (gpsWatch.current !== null) navigator.geolocation.clearWatch(gpsWatch.current)
      try { map.remove() } catch {}
      if (mapGl.current === map) mapGl.current = null
      loadedRef.current = false
    }
  }, [])

  // ── Trocar camada base ──────────────────────────────────────
  useEffect(() => {
    const map = mapGl.current
    if (!map || !loadedRef.current) return
    Object.values(BASE_LAYER_ID).forEach(id => map.setLayoutProperty(id, 'visibility', 'none'))
    const target = BASE_LAYER_ID[camada]
    if (target) map.setLayoutProperty(target, 'visibility', 'visible')
  }, [camada])

  // ── Voar para cidade ────────────────────────────────────────
  useEffect(() => {
    const map = mapGl.current
    if (map) {
      const c = CIDADES[cidade]
      const [lng, lat] = c.center
      map.flyTo({ center: [lng, lat], zoom: c.zoom, pitch: terreno3D ? 45 : 0, bearing: 0, duration: 2200, essential: true })
    }
    carregarClima(cidade)
  }, [cidade])

  const carregarAreasRisco = useCallback(async () => {
    try {
      const records = await api.getAreasRisco()
      setAreasRisco(Array.isArray(records) ? records : [])
    } catch {
      setAreasRisco([])
    }
  }, [])

  useEffect(() => {
    void carregarAreasRisco()
    const onSynced = () => { void carregarAreasRisco() }
    window.addEventListener('geovistorias:offline-data-synced', onSynced)
    return () => window.removeEventListener('geovistorias:offline-data-synced', onSynced)
  }, [carregarAreasRisco])

  const carregarPrevisaoAreas = useCallback(async () => {
    const requestId = ++previsaoRequestRef.current
    const areasComCoordenadas = areasDaCidade
      .filter(area => area.tipo !== 'Interdições')
      .map(area => ({ area, centro: areaCentroide(area) }))
      .filter(item => item.centro
        && Number.isFinite(item.centro.latitude)
        && Number.isFinite(item.centro.longitude))

    let cacheLocal = null
    try {
      cacheLocal = JSON.parse(localStorage.getItem(`areasRiscoPrevisao:v1:${cidade}`) || 'null')
    } catch {}
    if (cacheLocal?.previsoes && requestId === previsaoRequestRef.current) {
      setPrevisoesAreas(cacheLocal.previsoes)
      setPrevisaoAtualizadaEm(cacheLocal.atualizadoEm || null)
    }

    if (areasComCoordenadas.length === 0) {
      if (requestId === previsaoRequestRef.current) {
        setPrevisoesAreas({})
        setPrevisaoAtualizadaEm(null)
        setErroPrevisaoAreas('')
        setCarregandoPrevisaoAreas(false)
      }
      return
    }

    setCarregandoPrevisaoAreas(true)
    setErroPrevisaoAreas('')
    try {
      const previsoes = {}
      for (let start = 0; start < areasComCoordenadas.length; start += 50) {
        const lote = areasComCoordenadas.slice(start, start + 50)
        const response = await fetchApi('/api/tempo-areas-risco', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            areas: lote.map(({ area, centro }) => ({
              id: String(area.id),
              latitude: centro.latitude,
              longitude: centro.longitude,
            })),
          }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body?.erro || `Falha ao carregar a previsão (${response.status}).`)
        for (const item of body.previsoes || []) {
          previsoes[item.id] = item.precipitacao_24h_mm == null
            ? null
            : Number(item.precipitacao_24h_mm)
        }
        if (body.atualizadoEm) setPrevisaoAtualizadaEm(body.atualizadoEm)
      }
      if (requestId !== previsaoRequestRef.current) return
      const atualizadoEm = new Date().toISOString()
      setPrevisoesAreas(previsoes)
      setPrevisaoAtualizadaEm(atualizadoEm)
      setErroPrevisaoAreas('')
      try {
        localStorage.setItem(`areasRiscoPrevisao:v1:${cidade}`, JSON.stringify({ previsoes, atualizadoEm }))
      } catch {}
    } catch (error) {
      if (requestId !== previsaoRequestRef.current) return
      setErroPrevisaoAreas(error?.message || 'Previsão de chuva indisponível.')
    } finally {
      if (requestId === previsaoRequestRef.current) setCarregandoPrevisaoAreas(false)
    }
  }, [areasDaCidade, cidade])

  useEffect(() => {
    void carregarPrevisaoAreas()
    const interval = window.setInterval(carregarPrevisaoAreas, 10 * 60 * 1000)
    return () => window.clearInterval(interval)
  }, [carregarPrevisaoAreas])

  useEffect(() => {
    if (!mapLoaded || webglError) return
    mapGl.current?.getSource('areas-risco')?.setData(areasGeoJSON)
  }, [areasGeoJSON, mapLoaded, webglError])

  useEffect(() => {
    const map = mapGl.current
    if (!map || !mapLoaded || webglError) return undefined

    markersAreasRiscoRef.current.forEach(marker => marker.remove())
    markersAreasRiscoRef.current = []

    areasGeoJSON.features.forEach(feature => {
      const properties = feature.properties || {}
      const centro = areaCentroide({ geojson: feature.geometry })
      if (!centro) return

      const emAlerta = properties.em_alerta === true || properties.em_alerta === 'true'
      const color = properties.cor || CORES_AREAS_RISCO[properties.tipo] || '#d97706'
      const markerElement = document.createElement('div')
      markerElement.className = `mapa-area-marker${emAlerta ? ' mapa-area-marker-alerta' : ''}`
      markerElement.style.setProperty('--area-marker-color', color)
      markerElement.setAttribute('role', 'img')
      markerElement.setAttribute(
        'aria-label',
        `${properties.tipo || 'Área de risco'}${emAlerta ? ', alerta de chuva' : ''}`,
      )
      const icon = document.createElement('span')
      icon.className = 'mapa-area-marker-icone'
      icon.textContent = ICONES_AREAS_RISCO[properties.tipo] || '⚠'
      markerElement.appendChild(icon)

      markerElement.addEventListener('click', event => {
        event.stopPropagation()
        const chuva = properties.previsao_24h_mm == null
          ? 'sem dado'
          : `${Number(properties.previsao_24h_mm).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm`
        const detalhes = [
          properties.descricao,
          `Previsão 24 h: ${chuva}`,
          `Limite: ${properties.limite_precipitacao_mm == null ? '—' : `${Number(properties.limite_precipitacao_mm).toLocaleString('pt-BR')} mm`}`,
          properties.referencia && `Referência: ${properties.referencia}`,
          properties.observacao && `Observação: ${properties.observacao}`,
          CIDADES[properties.cidade]?.nome,
        ].filter(Boolean).join('\n')
        new maplibregl.Popup({ closeButton: true, maxWidth: '240px' })
          .setLngLat([centro.longitude, centro.latitude])
          .setDOMContent(popupSeguro(
            `${properties.tipo || 'Área de risco'} · ${properties.nivel || ''}`,
            detalhes,
            color,
            emAlerta ? 'ALERTA · chuva acima do limite' : '',
          ))
          .addTo(map)
      })

      const marker = new maplibregl.Marker({ element: markerElement, anchor: 'center' })
        .setLngLat([centro.longitude, centro.latitude])
        .addTo(map)
      markersAreasRiscoRef.current.push(marker)
    })

    return () => {
      markersAreasRiscoRef.current.forEach(marker => marker.remove())
      markersAreasRiscoRef.current = []
    }
  }, [areasGeoJSON, mapLoaded, webglError])

  useEffect(() => {
    const map = mapGl.current
    if (!map || !mapLoaded || webglError) return undefined

    const temAlerta = areasGeoJSON.features.some(feature =>
      feature.properties?.em_alerta === true || feature.properties?.em_alerta === 'true'
    )
    let fase = false
    const atualizarPulso = () => {
      fase = !fase
      try {
        map.setPaintProperty('areas-fill', 'fill-opacity', [
          'case', ['==', ['get', 'em_alerta'], true], fase ? 0.38 : 0.07, 0.2,
        ])
        map.setPaintProperty('areas-outline', 'line-width', [
          'case', ['==', ['get', 'em_alerta'], true], fase ? 5 : 2.5, 2.5,
        ])
        map.setPaintProperty('areas-outline', 'line-opacity', [
          'case', ['==', ['get', 'em_alerta'], true], fase ? 1 : 0.42, 1,
        ])
      } catch {}
    }

    if (!temAlerta) {
      atualizarPulso()
      return undefined
    }
    atualizarPulso()
    const timer = window.setInterval(atualizarPulso, 700)
    return () => window.clearInterval(timer)
  }, [areasGeoJSON, mapLoaded, webglError])

  // ── Terreno 3D ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapGl.current
    if (!map || !loadedRef.current) return
    if (terreno3D) {
      map.setTerrain({ source: 'terrain', exaggeration: 1.8 })
      map.easeTo({ pitch: 50, duration: 900 })
    } else {
      map.setTerrain(null)
      map.easeTo({ pitch: 0, duration: 700 })
    }
  }, [terreno3D])

  // ── Cursor modo desenho ─────────────────────────────────────
  useEffect(() => {
    const map = mapGl.current
    if (map) map.getCanvas().style.cursor = modoDesenho ? 'crosshair' : ''
    drawRef.current.ativo = !!modoDesenho
    if (!modoDesenho) limparDesenho()
  }, [modoDesenho, webglError])

  // ── nivelRisco ref atualizado ───────────────────────────────
  useEffect(() => { nivelRef.current = nivelRisco }, [nivelRisco])

  // ── Visibilidade das camadas de dados ───────────────────────
  useEffect(() => {
    const map = mapGl.current
    if (!map || !loadedRef.current) return
    const v = (id, on) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    v('areas-fill',        overlays.areas)
    v('areas-outline',     overlays.areas)
    v('vis-clusters',      overlays.vistorias)
    v('vis-cluster-count', overlays.vistorias)
    v('vis-pontos',        overlays.vistorias)
    v('vis-poly-fill',     overlays.vistorias)
    v('vis-poly-line',     overlays.vistorias)
  }, [overlays])

  useEffect(() => {
    const onSynced = () => carregarDados(mapGl.current)
    window.addEventListener('geovistorias:offline-data-synced', onSynced)
    return () => window.removeEventListener('geovistorias:offline-data-synced', onSynced)
  }, [])

  // ── Clima ───────────────────────────────────────────────────
  async function carregarClima(cidadeKey) {
    try {
      const [lng, lat] = CIDADES[cidadeKey].center
      const res = await fetch(`/api/clima?lat=${lat}&lng=${lng}`)
      const data = await res.json()
      setPrecipitacao(data?.precipitation ?? 0)
    } catch { setPrecipitacao(0) }
  }

  // ── Carregar dados do servidor ──────────────────────────────
  async function carregarDados(mapInstance) {
    const map = mapInstance || mapGl.current
    if (!map || !loadedRef.current) return

    try {
      const vistorias = await api.getVistorias().catch(() => [])

      // Vistorias: pontos para cluster + polígonos
      const ptFeats = [], polyFeats = []
      ;(Array.isArray(vistorias) ? vistorias : []).forEach(v => {
        const rawVerts = v.area_vertices
        let hasPolygon = false
        if (rawVerts) {
          try {
            const verts = typeof rawVerts === 'string' ? JSON.parse(rawVerts) : rawVerts
            if (Array.isArray(verts) && verts.length >= 3) {
              const coords = verts.map(p => [p.lng, p.lat])
              coords.push(coords[0])
              polyFeats.push({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [coords] },
                properties: { risco: v.risco, id: v.id, nome: v.nome, vistoriaData: JSON.stringify(v) },
              })
              const cLng = verts.reduce((s, p) => s + p.lng, 0) / verts.length
              const cLat = verts.reduce((s, p) => s + p.lat, 0) / verts.length
              ptFeats.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [cLng, cLat] },
                properties: { risco: v.risco, id: v.id, nome: v.nome, vistoriaData: JSON.stringify(v) },
              })
              hasPolygon = true
            }
          } catch (_) {}
        }
        if (!hasPolygon && v.lat != null && v.lng != null) {
          ptFeats.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
            properties: { risco: v.risco, id: v.id, nome: v.nome, vistoriaData: JSON.stringify(v) },
          })
        }
      })

      map.getSource('vistorias-pontos-src')?.setData({ type: 'FeatureCollection', features: ptFeats })
      map.getSource('vistorias-poly-src')?.setData({ type: 'FeatureCollection', features: polyFeats })
    } catch (err) {
      console.warn('Erro ao carregar dados:', err)
    }
  }

  // ── Desenho ─────────────────────────────────────────────────
  function adicionarPonto(lngLat, mapInstance) {
    const map = mapInstance || mapGl.current
    const state = drawRef.current
    state.pontos.push([lngLat.lng, lngLat.lat])
    setLeafletDrawPoints([...state.pontos])
    atualizarDesenho(map)
  }

  function atualizarDesenho(map) {
    const pts = drawRef.current.pontos
    const cor = RISCO_CORES[nivelRef.current] || '#38bdf8'
    const features = []
    if (pts.length >= 3) features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] }, properties: { color: cor } })
    if (pts.length >= 2) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: { color: '#38bdf8' } })
    pts.forEach(p => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { color: '#38bdf8' } }))
    map?.getSource('draw-src')?.setData({ type: 'FeatureCollection', features })
  }

  function fecharPoligono() {
    const state = drawRef.current
    if (state.pontos.length < 3) return
    setPolyRascunho({ pontos: [...state.pontos] })
    drawRef.current.ativo = false
    setModoDesenho(null)
    setSalvandoArea(true)
    mapGl.current?.getSource('draw-preview-src')?.setData({ type: 'FeatureCollection', features: [] })
  }

  function desfazerPonto() {
    drawRef.current.pontos.pop()
    setLeafletDrawPoints([...drawRef.current.pontos])
    atualizarDesenho(mapGl.current)
  }

  function limparPontos() {
    drawRef.current.pontos = []
    setLeafletDrawPoints([])
    atualizarDesenho(mapGl.current)
    mapGl.current?.getSource('draw-preview-src')?.setData({ type: 'FeatureCollection', features: [] })
  }

  function limparDesenho() {
    drawRef.current.pontos = []
    setLeafletDrawPoints([])
    mapGl.current?.getSource('draw-src')?.setData({ type: 'FeatureCollection', features: [] })
    mapGl.current?.getSource('draw-preview-src')?.setData({ type: 'FeatureCollection', features: [] })
  }

  async function confirmarArea() {
    if (!polyRascunho) return
    const coords = polyRascunho.pontos
    const geom = { type: 'Polygon', coordinates: [[...coords, coords[0]]] }
    const centro = areaCentroide({ geojson: geom })
    const limite = tipoAreaRisco === 'Interdições' ? 0 : Number(limiteChuva)
    if (tipoAreaRisco !== 'Interdições'
      && (limiteChuva.trim() === '' || !Number.isFinite(limite) || limite < 0)) {
      setErroSalvarArea('Informe o limite de chuva para as próximas 24 horas, em milímetros.')
      return
    }
    if (!centro) {
      setErroSalvarArea('Não foi possível calcular a localização deste polígono.')
      return
    }
    try {
      setErroSalvarArea('')
      const dadosArea = {
        nivel: nivelRisco,
        tipo: tipoAreaRisco,
        descricao: descRisco.trim(),
        cidade,
        latitude: centro.latitude,
        longitude: centro.longitude,
        data_inicio: dataInicioRisco,
        limite_precipitacao_mm: limite,
        referencia: referenciaRisco.trim(),
        observacao: observacaoRisco.trim(),
        geojson: geom,
      }
      const resultado = areaEditando
        ? await api.updateAreaRisco(areaEditando.id, dadosArea)
        : await api.createAreaRisco(dadosArea)
      setStatusSalvarArea(resultado?.offline
        ? areaEditando
          ? 'Alteração salva neste dispositivo; será enviada quando o serviço de dados estiver disponível.'
          : 'Área salva neste dispositivo; será enviada quando o serviço de dados estiver disponível.'
        : areaEditando ? 'Área de risco atualizada.' : 'Área de risco registrada.')
      await carregarAreasRisco()
    } catch (error) {
      setErroSalvarArea(error?.message || 'Não foi possível salvar a área de risco.')
      return
    }
    limparDesenho()
    setSalvandoArea(false)
    setPolyRascunho(null)
    setDescRisco('')
    setReferenciaRisco('')
    setObservacaoRisco('')
    setLimiteChuva('35')
    setDataInicioRisco(new Date().toISOString().slice(0, 10))
    setErroSalvarArea('')
    setAreaEditando(null)
    setShowAreasRisco(true)
    carregarDados()
  }

  function cancelarArea() {
    limparDesenho()
    setSalvandoArea(false)
    setPolyRascunho(null)
    setDescRisco('')
    setReferenciaRisco('')
    setObservacaoRisco('')
    setLimiteChuva('35')
    setErroSalvarArea('')
    setAreaEditando(null)
    setModoDesenho(null)
  }

  function iniciarDesenhoArea() {
    setShowAreasRisco(false)
    setShowClima(false)
    setShowLegenda(false)
    setTipoAreaRisco('Encostas')
    setLimiteChuva('35')
    setPolyRascunho(null)
    setAreaEditando(null)
    setErroSalvarArea('')
    setStatusSalvarArea('')
    limparDesenho()
    setModoDesenho('polygon')
  }

  function editarArea(area) {
    const geometry = areaGeometry(area)
    const ring = geometry?.coordinates?.[0] || []
    const first = ring[0]
    const last = ring[ring.length - 1]
    const closedRing = ring.length > 3 && first?.[0] === last?.[0] && first?.[1] === last?.[1]
    const vertices = (closedRing ? ring.slice(0, -1) : ring)
      .map(point => [Number(point?.[0]), Number(point?.[1])])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
    const temPoligono = vertices.length >= 3

    limparDesenho()
    setAreaEditando(area)
    setTipoAreaRisco(TIPOS_AREAS_RISCO.includes(area.tipo) ? area.tipo : 'Encostas')
    setNivelRisco(['R1', 'R2', 'R3', 'R4'].includes(area.nivel) ? area.nivel : 'R2')
    setLimiteChuva(area.limite_precipitacao_mm == null ? '35' : String(area.limite_precipitacao_mm))
    setDataInicioRisco(String(area.data_inicio || new Date().toISOString().slice(0, 10)).slice(0, 10))
    setDescRisco(area.descricao || '')
    setReferenciaRisco(area.referencia || '')
    setObservacaoRisco(area.observacao || '')
    setPolyRascunho(temPoligono ? { pontos: vertices } : null)
    setErroSalvarArea('')
    setStatusSalvarArea('')
    setShowAreasRisco(false)
    setShowClima(false)
    setShowLegenda(false)
    setSalvandoArea(temPoligono)
    setModoDesenho(temPoligono ? null : 'polygon')
    if (area.cidade && CIDADES[area.cidade]) setCidade(area.cidade)
    focarArea(area)
  }

  async function removerArea(area) {
    const nome = area.tipo || 'esta área de risco'
    if (!window.confirm(`Remover ${nome}? Esta ação também remove seus alertas do mapa.`)) return
    try {
      const resultado = await api.deleteAreaRisco(area.id)
      await carregarAreasRisco()
      setStatusSalvarArea(resultado?.offline
        ? 'Área removida neste dispositivo; a exclusão será sincronizada quando o serviço de dados estiver disponível.'
        : 'Área de risco removida.')
    } catch (error) {
      setStatusSalvarArea(error?.message || 'Não foi possível remover a área de risco.')
    }
  }

  function redesenharPoligonoArea() {
    limparDesenho()
    setPolyRascunho(null)
    setSalvandoArea(false)
    setModoDesenho('polygon')
  }

  function focarArea(area) {
    const centro = areaCentroide(area)
    if (!centro) return
    setShowAreasRisco(false)
    if (webglError) leafletMapRef.current?.setView([centro.latitude, centro.longitude], 15, { animate: true })
    else mapGl.current?.easeTo({ center: [centro.longitude, centro.latitude], zoom: 15, duration: 500 })
  }

  // ── GPS ─────────────────────────────────────────────────────
  function toggleGPS() { gpsAtivo ? desativarGPS() : ativarGPS() }

  function ativarGPS() {
    if (!navigator.geolocation) { alert('GPS não disponível neste navegador.'); return }
    setGpsAtivo(true)
    const id = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
        const map = mapGl.current
        if (!map) {
          setLeafletGpsPosition({ lat, lng, accuracy: acc })
          return
        }
        const accPx = Math.min(acc / 2, 120)
        map.getSource('gps-src')?.setData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { accPx } }],
        })
        map.setLayoutProperty('gps-dot', 'visibility', 'visible')
        map.setLayoutProperty('gps-acc', 'visibility', 'visible')
        map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), duration: 1200 })
      },
      () => {
        setGpsAtivo(false)
        setLeafletGpsPosition(null)
        mapGl.current?.setLayoutProperty('gps-dot', 'visibility', 'none')
        mapGl.current?.setLayoutProperty('gps-acc', 'visibility', 'none')
        alert('Não foi possível obter localização. Verifique as permissões do GPS.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    )
    gpsWatch.current = id
  }

  function desativarGPS() {
    if (gpsWatch.current !== null) { navigator.geolocation.clearWatch(gpsWatch.current); gpsWatch.current = null }
    setGpsAtivo(false)
    setLeafletGpsPosition(null)
    mapGl.current?.setLayoutProperty('gps-dot', 'visibility', 'none')
    mapGl.current?.setLayoutProperty('gps-acc', 'visibility', 'none')
  }

  function toggleOverlay(key) { setOverlays(prev => ({ ...prev, [key]: !prev[key] })) }

  const riscoAtual = calcularRiscoAtual(precipitacao)

  // ── JSX ──────────────────────────────────────────────────────
  return (
    <div className={styles.wrapper}>

      {/* Toolbar superior */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.toolbarBrand}>
            <img src='/icons/sismar-192.png' alt='' />
            <strong>SISMAR</strong>
          </div>
          <select className={styles.select} value={cidade} onChange={e => setCidade(e.target.value)}>
            {Object.values(CIDADES).map(c => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}
          </select>

          {riscoAtual && (
            <div className={styles.riscoIndicador} style={{ borderColor: riscoAtual.cor + '66', background: riscoAtual.cor + '15' }}>
              <span className={styles.riscoIndicadorDot} style={{ background: riscoAtual.cor }} />
              <span className={styles.riscoIndicadorLabel} style={{ color: riscoAtual.cor }}>Risco {riscoAtual.texto}</span>
              <span className={styles.riscoIndicadorSub}>{precipitacao} mm/h</span>
            </div>
          )}
        </div>

        <div className={styles.toolbarRight}>
          <div className={styles.basemapSwitcher} role="group" aria-label="Escolher mapa base">
            {CAMADAS_BASE.slice(0, 2).map(c => (
              <button
                key={c.id}
                type="button"
                className={`${styles.basemapBtn} ${camada === c.id ? styles.basemapBtnActive : ''}`}
                aria-pressed={camada === c.id}
                title={`Mapa base: ${c.label}`}
                onClick={() => setCamada(c.id)}
              >
                <span aria-hidden="true">{c.icone}</span>
                {c.label}
              </button>
            ))}
          </div>

          {modoDesenho ? (
            <>
              <span className={styles.desenhoHint}>✏️ Clique para adicionar pontos</span>
              {drawRef.current.pontos.length > 0 && (
                <>
                  <button className={styles.toolBtn} title="Desfazer último ponto" onClick={desfazerPonto}>
                    <FiRotateCcw size={13} /><span>Desfazer</span>
                  </button>
                  <button className={styles.toolBtn} title="Limpar todos os pontos" onClick={limparPontos}>
                    <FiTrash2 size={13} /><span>Limpar</span>
                  </button>
                </>
              )}
              {drawRef.current.pontos.length >= 3 && (
                <button className={styles.confirmarBtn} style={{ padding: '4px 10px', fontSize: 12 }} onClick={fecharPoligono}>
                  <FiCheck size={12} /><span>Fechar polígono</span>
                </button>
              )}
              <button className={styles.cancelarBtn} onClick={cancelarArea}><FiX size={13} /> Cancelar</button>
            </>
          ) : !salvandoArea && (
            <>
              <button className={styles.desenhoBtn} onClick={iniciarDesenhoArea}>
                <FiSquare size={12} /> Área de Risco
              </button>
              <button
                className={`${styles.toolBtn} ${showAreasRisco ? styles.toolBtnActive : ''}`}
                aria-pressed={showAreasRisco}
                onClick={() => setShowAreasRisco(open => !open)}
                title="Ver áreas cadastradas e alertas de chuva"
              >
                <FiCloudRain size={14} />
                <span>Áreas ({areasDaCidade.length})</span>
              </button>
            </>
          )}

          <button
            type="button"
            className={`${styles.toolBtn} ${showMapOptions ? styles.toolBtnActive : ''}`}
            aria-label="Outros mapas e sobreposições"
            aria-expanded={showMapOptions}
            title="Outros mapas e sobreposições"
            onClick={() => setShowMapOptions(open => !open)}
          >
            <FiLayers size={14} />
            <span>Mais</span>
          </button>

          <button
            className={`${styles.toolBtn} ${gpsAtivo ? styles.toolBtnGps : ''}`}
            onClick={toggleGPS}
            title={gpsAtivo ? 'Desativar GPS' : 'Mostrar minha localização'}
          >
            <FiNavigation size={14} />
            <span>{gpsAtivo ? 'GPS Ativo' : 'GPS'}</span>
          </button>

          <button
            className={`${styles.toolBtn} ${showLegenda ? styles.toolBtnActive : ''}`}
            onClick={() => setShowLegenda(s => !s)}
          >
            <FiBookOpen size={14} /><span>Legenda</span>
          </button>

          <button
            className={`${styles.toolBtn} ${showClima ? styles.toolBtnActive : ''}`}
            onClick={() => setShowClima(s => !s)}
          >
            <FiCloud size={14} /><span>Clima</span>
          </button>

          <button
            className={styles.iconBtn}
            onClick={() => webglError ? setRefreshMapVersion(version => version + 1) : carregarDados()}
            title="Recarregar dados"
          >
            <FiRefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Modal confirmar área */}
      {salvandoArea && (
        <div className={styles.modalArea} role="dialog" aria-labelledby="titulo-cadastro-area">
          <div className={styles.modalAreaHeader}>
            <FiAlertTriangle size={16} color="#f97316" />
            <h3 id="titulo-cadastro-area">{areaEditando ? 'Editar área de risco' : 'Cadastrar área de risco'}</h3>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.modalLabel} htmlFor="tipo-area-risco">Tipo de registro</label>
            <div className={styles.tipoSelectWrap}>
              <span className={styles.tipoSelectIcon}>{ICONES_AREAS_RISCO[tipoAreaRisco]}</span>
              <select
                id="tipo-area-risco"
                className={styles.areaSelect}
                value={tipoAreaRisco}
                onChange={event => {
                  const proximoTipo = event.target.value
                  setTipoAreaRisco(proximoTipo)
                  setLimiteChuva(proximoTipo === 'Interdições'
                    ? '0'
                    : limiteChuva === '0' ? '35' : limiteChuva)
                }}
              >
                {TIPOS_AREAS_RISCO.map(tipo => (
                  <option key={tipo} value={tipo}>{ICONES_AREAS_RISCO[tipo]} {tipo}</option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.modalLabel}>Nível de risco</label>
            <div className={styles.riscoOpcoes}>
              {['R1','R2','R3','R4'].map(r => (
                <button
                  type="button"
                  key={r}
                  className={`${styles.riscoOpcao} ${nivelRisco === r ? styles.riscoOpcaoAtivo : ''}`}
                  style={nivelRisco === r ? { background: RISCO_CORES[r]+'30', borderColor: RISCO_CORES[r], color: RISCO_CORES[r] } : {}}
                  onClick={() => setNivelRisco(r)}
                >
                  <span className={styles.riscoOpcaoNivel}>{r}</span>
                  <span className={styles.riscoOpcaoSub}>{RISCO_LABELS[r].label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.modalLabel} htmlFor="data-inicio-risco">Início do risco</label>
              <input
                id="data-inicio-risco"
                className={styles.areaInput}
                type="date"
                value={dataInicioRisco}
                onChange={event => setDataInicioRisco(event.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.modalLabel} htmlFor="limite-chuva">Limite de chuva (mm)</label>
              <input
                id="limite-chuva"
                className={styles.areaInput}
                type="number"
                min="0"
                max="10000"
                step="0.1"
                inputMode="decimal"
                placeholder="Ex.: 35"
                value={limiteChuva}
                disabled={tipoAreaRisco === 'Interdições'}
                onChange={event => setLimiteChuva(event.target.value)}
              />
            </div>
          </div>
          <p className={styles.formHint}>
            {tipoAreaRisco === 'Interdições'
              ? 'Interdições não recebem alerta por previsão de chuva.'
              : 'A área será alertada se a previsão acumulada nas próximas 24 horas superar este valor.'}
          </p>

          <div className={styles.formGroup}>
            <label className={styles.modalLabel} htmlFor="referencia-risco">Referência local (opcional)</label>
            <input
              id="referencia-risco"
              className={styles.areaInput}
              placeholder="Rua, bairro ou ponto próximo"
              value={referenciaRisco}
              onChange={event => setReferenciaRisco(event.target.value)}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.modalLabel} htmlFor="descricao-risco">Descrição (opcional)</label>
            <input
              id="descricao-risco"
              className={styles.areaInput}
              placeholder="Descreva a área de risco"
              value={descRisco}
              onChange={event => setDescRisco(event.target.value)}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.modalLabel} htmlFor="observacao-risco">Observações (opcional)</label>
            <textarea
              id="observacao-risco"
              className={styles.formTextarea}
              placeholder="Condição observada, acesso ou orientação à equipe"
              value={observacaoRisco}
              onChange={event => setObservacaoRisco(event.target.value)}
              rows={3}
            />
          </div>
          {polyRascunho && (
            <div className={styles.poligonoResumo}>
              <FiMapPin size={13} />
              Perímetro definido · {polyRascunho.pontos.length} vértices
            </div>
          )}
          {areaEditando && (
            <button type="button" className={styles.cancelarModalBtn} onClick={redesenharPoligonoArea}>
              <FiSquare size={13} /> Redesenhar perímetro
            </button>
          )}
          {erroSalvarArea && <p className={styles.erroArea} role="alert">{erroSalvarArea}</p>}
          <div className={styles.modalBtns}>
            <button className={styles.confirmarBtn} onClick={confirmarArea}>
              <FiCheck size={13} /> {areaEditando ? 'Salvar alterações' : 'Registrar área'}
            </button>
            <button className={styles.cancelarModalBtn} onClick={cancelarArea}><FiX size={13} /> Cancelar</button>
          </div>
        </div>
      )}

      {/* Opções complementares do mapa; as bases Ruas e Satélite ficam na barra superior */}
      {showMapOptions && (
        <div className={styles.mapOptionsPanel}>
            <div className={styles.layerSection}>
              <div className={styles.layerSectionTitle} onClick={() => setSecaoBase(s => !s)}>
                {secaoBase ? <FiChevronDown size={10} /> : <FiChevronRight size={10} />}
                <span>Outros mapas</span>
              </div>
              {secaoBase && (
                <div className={styles.layerBaseGrid}>
                  {CAMADAS_BASE.slice(2).map(c => (
                    <button
                      key={c.id}
                      className={`${styles.layerBaseBtn} ${camada === c.id ? styles.layerBaseBtnActive : ''}`}
                      onClick={() => {
                        setCamada(c.id)
                        setShowMapOptions(false)
                      }}
                    >
                      <span className={styles.layerBaseIcone}>{c.icone}</span>
                      <span className={styles.layerBaseLabel}>{c.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.layerSection}>
              <div className={styles.layerSectionTitle} onClick={() => setSecaoOverlay(s => !s)}>
                {secaoOverlay ? <FiChevronDown size={10} /> : <FiChevronRight size={10} />}
                <span>Sobreposições</span>
              </div>
              {secaoOverlay && (
                <div className={styles.overlayList}>
                  {[
                    { key: 'areas',         icone: '⚠️', nome: 'Áreas de Risco', sub: '' },
                    { key: 'vistorias',     icone: '📋', nome: 'Vistorias', sub: 'por coordenada' },
                  ].map(({ key, icone, nome, sub }) => (
                    <div key={key} className={styles.overlayItem}>
                      <div className={styles.overlayInfo}>
                        <span className={styles.overlayIcone}>{icone}</span>
                        <div>
                          <span className={styles.overlayNome}>{nome}</span>
                          {sub && <span className={styles.overlayTs}>{sub}</span>}
                        </div>
                      </div>
                      <button
                        className={`${styles.toggle} ${overlays[key] ? styles.toggleOn : ''}`}
                        onClick={() => toggleOverlay(key)}
                      >
                        <span className={styles.toggleKnob} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
        </div>
      )}

      {/* Legenda */}
      {showLegenda && (
        <div className={styles.legendaPanel}>
          <div className={styles.legendaHeader}>
            <span>Legenda</span>
            <button className={styles.legendaFechar} onClick={() => setShowLegenda(false)}><FiX size={13} /></button>
          </div>
          <div className={styles.legendaSecao}>
            <div className={styles.legendaSecaoTitle}>Áreas de Risco Geotécnico</div>
            {Object.entries(RISCO_CORES).map(([nivel, cor]) => (
              <div key={nivel} className={styles.legendaItem}>
                <span className={styles.legendaBox} style={{ background: cor+'40', border:`2px solid ${cor}` }} />
                <div>
                  <span className={styles.legendaItemLabel}>{nivel}</span>
                  <span className={styles.legendaItemSub}>{RISCO_LABELS[nivel].label}</span>
                </div>
              </div>
            ))}
          </div>
          <div className={styles.legendaSecao}>
            <div className={styles.legendaSecaoTitle}>Vistorias — Clusters 3D</div>
            {[['#22c55e','1–2 vistorias'], ['#eab308','3–6 vistorias'], ['#ef4444','7+ vistorias']].map(([cor, label]) => (
              <div key={label} className={styles.legendaItem}>
                <span className={styles.legendaDot} style={{ background: cor }} />
                <span className={styles.legendaItemLabel}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Painel Clima */}
      {showClima && (
        <div className={styles.climaPanel}>
          <button className={styles.fecharClima} onClick={() => setShowClima(false)}><FiX size={14} /></button>
          <PainelClima cidade={cidade} />
        </div>
      )}

      {/* Barra de coordenadas */}
      {coordAtual && (
        <div className={styles.coordBar}>
          <FiMapPin size={11} />
          {coordAtual.lat.toFixed(5)}, {coordAtual.lng.toFixed(5)}
          {terreno3D && <span style={{ marginLeft: 8, opacity: 0.6, fontSize: 10 }}>· 3D</span>}
        </div>
      )}

      {/* Painel Vistoria */}
      {painelVistoria && (() => {
        const v = painelVistoria
        const cor = RISCO_CORES[v.risco] || '#64748b'
        const processos  = Array.isArray(v.processos)  ? v.processos  : (v.processos  ? JSON.parse(v.processos)  : [])
        const patologias = Array.isArray(v.patologias) ? v.patologias : (v.patologias ? JSON.parse(v.patologias) : [])
        const verts = v.area_vertices ? (typeof v.area_vertices === 'string' ? JSON.parse(v.area_vertices) : v.area_vertices) : []
        return (
          <div className={styles.painelVistoria}>
            <div className={styles.painelHeader} style={{ borderBottom: `3px solid ${cor}` }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span className={styles.riscoBadge} style={{ background:cor+'22', color:cor, border:`1px solid ${cor}66` }}>{v.risco || '—'}</span>
                <span className={styles.painelTitulo}>{v.nome || 'Vistoria'}</span>
              </div>
              <button className={styles.painelFechar} onClick={() => setPainelVistoria(null)}>✕</button>
            </div>
            <div className={styles.painelBody}>
              {v.data && <p className={styles.painelData}><FiClipboard size={11}/> {new Date(v.data).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})}</p>}
              {v.endereco && <p className={styles.painelEndereco}><FiMapPin size={11}/> {v.endereco}</p>}
              <div className={styles.painelRiscoBox} style={{ background:cor+'12', border:`1px solid ${cor}33` }}>
                <span style={{ fontWeight:800, color:cor, fontSize:16 }}>{v.risco}</span>
                <span style={{ color:cor, fontSize:12, fontWeight:600 }}> — {RISCO_LABELS[v.risco]?.label || ''}</span>
              </div>
              {verts.length > 0 && (
                <div className={styles.painelSecao}>
                  <span className={styles.painelSecaoTitulo}>📐 Área delimitada</span>
                  <span>{verts.length} vértice{verts.length>1?'s':''}{v.area_m2 ? ` · ${Math.round(v.area_m2).toLocaleString('pt-BR')} m²`:''}</span>
                </div>
              )}
              {(v.condEncosta || v.anguloEncosta) && (
                <div className={styles.painelSecao}>
                  <span className={styles.painelSecaoTitulo}>⛰️ Condição da Encosta</span>
                  <span>{[v.condEncosta, v.anguloEncosta?`Ângulo: ${v.anguloEncosta}°`:''].filter(Boolean).join(' · ')}</span>
                </div>
              )}
              {v.tipoTalude && <div className={styles.painelSecao}><span className={styles.painelSecaoTitulo}>🏔️ Tipo de Talude</span><span>{v.tipoTalude}</span></div>}
              {processos.length>0 && <div className={styles.painelSecao}><span className={styles.painelSecaoTitulo}>⚠️ Processos</span><span>{processos.join(', ')}</span></div>}
              {v.solo && <div className={styles.painelSecao}><span className={styles.painelSecaoTitulo}>🪨 Solo</span><span>{v.solo}{v.tipo_uso?` · ${v.tipo_uso}`:''}</span></div>}
              {patologias.length>0 && <div className={styles.painelSecao}><span className={styles.painelSecaoTitulo}>🏚️ Patologias</span><span>{patologias.join(', ')}</span></div>}
              {v.moradores && <div className={styles.painelSecao}><span className={styles.painelSecaoTitulo}>👥 Moradores</span><span>{v.moradores}</span></div>}
              {v.observacao && <div className={styles.painelObs}><span className={styles.painelSecaoTitulo}>📝 Observações</span><p>{v.observacao}</p></div>}
            </div>
            <div className={styles.painelFooter}>
              <button
                className={styles.painelBtnEditar}
                onClick={() => { sessionStorage.setItem('editar_vistoria', JSON.stringify(v)); navigate('/vistoria') }}
              >
                ✏️ Editar Vistoria
              </button>
            </div>
          </div>
        )
      })()}

      {/* Mapa */}
      <div ref={mapRef} className={styles.map} style={{ position: 'relative' }}>
        {webglError && (
          <MapaLeafletFallback
            cidade={cidade}
            camada={camada}
            overlays={overlays}
            areasGeoJSON={areasGeoJSON}
            modoDesenho={modoDesenho}
            drawPoints={leafletDrawPoints}
            refreshVersion={refreshMapVersion}
            gpsPosition={leafletGpsPosition}
            mapRef={leafletMapRef}
            onCoordinate={setCoordAtual}
            onDrawPoint={({ lat, lng }) => adicionarPonto({ lat, lng }, null)}
            onVistoriaClick={setPainelVistoria}
          />
        )}
      </div>

      <PainelAreasRisco
        aberto={showAreasRisco}
        nomeCidade={CIDADES[cidade]?.nome || cidade}
        areas={areasDaCidade}
        previsoes={previsoesAreas}
        atualizadoEm={previsaoAtualizadaEm}
        carregando={carregandoPrevisaoAreas}
        erro={erroPrevisaoAreas}
        status={statusSalvarArea}
        aoFechar={() => setShowAreasRisco(false)}
        aoNovaArea={iniciarDesenhoArea}
        aoEditarArea={editarArea}
        aoRemoverArea={removerArea}
        aoAtualizar={carregarPrevisaoAreas}
        aoFocarArea={focarArea}
      />
    </div>
  )
}
