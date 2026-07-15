import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '../services/api'
import { CIDADES, CIDADE_PADRAO } from '../data/cidades'
import PainelClima from './PainelClima'
import styles from './Mapa.module.css'
import {
  FiMapPin, FiCloud, FiX, FiCheck, FiRefreshCw, FiSquare,
  FiLayers, FiBookOpen, FiAlertTriangle, FiChevronDown,
  FiChevronRight, FiNavigation, FiClipboard, FiZoomIn,
} from 'react-icons/fi'

// ── Constantes ────────────────────────────────────────────────
const RISCO_CORES = { R1: '#22c55e', R2: '#eab308', R3: '#f97316', R4: '#ef4444' }
const NIVEL_CORES = { critico: '#ef4444', alto: '#f97316', medio: '#eab308', baixo: '#22c55e' }
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

function calcularRiscoAtual(precipitacao) {
  if (precipitacao === null) return null
  if (precipitacao >= 15) return { cor: '#ef4444', texto: 'Muito Alto' }
  if (precipitacao >= 8)  return { cor: '#f97316', texto: 'Alto' }
  if (precipitacao >= 2)  return { cor: '#eab308', texto: 'Médio' }
  return { cor: '#22c55e', texto: 'Baixo' }
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
      'src-ruas':     rasterSource(['/api/map-tile/osm/{z}/{x}/{y}'], 19, '© OpenStreetMap'),
      'src-satelite': rasterSource(['/api/sat-tile/{z}/{y}/{x}'], 20, '© Esri'),
      'src-topo':     rasterSource(['/api/map-tile/topo/{z}/{x}/{y}'], 17, '© OpenTopoMap'),
      'src-esri':     rasterSource(['/api/map-tile/esri/{z}/{x}/{y}'], 19, '© Esri'),
      'src-positron': rasterSource(['/api/map-tile/carto_l/{z}/{x}/{y}'], 19, '© CartoDB'),
      'src-dark':     rasterSource(['/api/map-tile/carto_d/{z}/{x}/{y}'], 19, '© CartoDB'),
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
  const loadedRef = useRef(false)
  const drawRef  = useRef({ ativo: false, pontos: [] })
  const nivelRef = useRef('R2')
  const gpsWatch = useRef(null)

  const [camada,          setCamada]          = useState('ruas')
  const [cidade,          setCidade]          = useState(CIDADE_PADRAO)
  const [coordAtual,      setCoordAtual]      = useState(null)
  const [showClima,       setShowClima]       = useState(false)
  const [showLegenda,     setShowLegenda]     = useState(false)
  const [showCamadas,     setShowCamadas]     = useState(true)
  const [modoDesenho,     setModoDesenho]     = useState(null)
  const [salvandoArea,    setSalvandoArea]    = useState(false)
  const [nivelRisco,      setNivelRisco]      = useState('R2')
  const [descRisco,       setDescRisco]       = useState('')
  const [polyRascunho,    setPolyRascunho]    = useState(null)
  const [overlays,        setOverlays]        = useState({
    heatmap: false, areas: true, vistorias: true,
    pluviometrico: false, idesisema: false, incendios: false,
  })
  const [pluvioCarregando, setPluvioCarregando] = useState(false)
  const [pluvioAcum,      setPluvioAcum]      = useState(null)
  const [precipitacao,    setPrecipitacao]    = useState(null)
  const [ocCount,         setOcCount]         = useState(0)
  const [secaoBase,       setSecaoBase]       = useState(true)
  const [secaoOverlay,    setSecaoOverlay]    = useState(true)
  const [gpsAtivo,        setGpsAtivo]        = useState(false)
  const [terreno3D,       setTerreno3D]       = useState(false)
  const [painelVistoria,  setPainelVistoria]  = useState(null)
  const [webglError,      setWebglError]      = useState(false)
  const navigate = useNavigate()

  // ── Inicializar mapa ────────────────────────────────────────
  useEffect(() => {
    if (mapGl.current) return
    const cidadeObj = CIDADES[cidade]
    const [lng0, lat0] = cidadeObj.center

    let map
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
      setWebglError(true)
      return
    }

    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
      loadedRef.current = true

      // Sky layer — efeito Google Earth
      try {
        map.addLayer({
          id: 'sky',
          type: 'sky',
          paint: {
            'sky-type': 'atmosphere',
            'sky-atmosphere-sun': [0.0, 90.0],
            'sky-atmosphere-sun-intensity': 15,
          },
        })
      } catch (_) {}

      // ── Fontes de dados GeoJSON ───────────────────────────
      const emptyGeo = { type: 'FeatureCollection', features: [] }

      map.addSource('ocorrencias',         { type: 'geojson', data: emptyGeo })
      map.addSource('areas-risco',         { type: 'geojson', data: emptyGeo })
      map.addSource('heatmap-src',         { type: 'geojson', data: emptyGeo })
      map.addSource('pluvio-src',          { type: 'geojson', data: emptyGeo })
      map.addSource('draw-src',            { type: 'geojson', data: emptyGeo })
      map.addSource('draw-preview-src',    { type: 'geojson', data: emptyGeo })
      map.addSource('gps-src',             { type: 'geojson', data: emptyGeo })
      map.addSource('vistorias-pontos-src',{ type: 'geojson', data: emptyGeo, cluster: true, clusterMaxZoom: 14, clusterRadius: 50 })
      map.addSource('vistorias-poly-src',  { type: 'geojson', data: emptyGeo })

      // WMS IDESISEMA — Curvas de Nível MG
      map.addSource('idesisema-src', {
        type: 'raster',
        tiles: ['https://idesisema.meioambiente.mg.gov.br/geoserver/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=semad_siam:curvas_nivel,semad_siam:hipsometria&FORMAT=image/png&TRANSPARENT=TRUE&WIDTH=256&HEIGHT=256&SRS=EPSG:3857&BBOX={bbox-epsg-3857}'],
        tileSize: 256,
      })

      // WMS NASA FIRMS — Focos de Calor
      map.addSource('firms-src', {
        type: 'raster',
        tiles: ['https://firms.modaps.eosdis.nasa.gov/mapserver/wms/?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=fires_viirs_snpp_sp,fires_viirs_noaa20_sp&FORMAT=image/png&TRANSPARENT=TRUE&WIDTH=256&HEIGHT=256&SRS=EPSG:3857&BBOX={bbox-epsg-3857}'],
        tileSize: 256,
      })

      // ── Camadas de dados ──────────────────────────────────

      // Heatmap (nativo MapLibre — muito mais bonito que Leaflet)
      map.addLayer({
        id: 'heatmap-layer', type: 'heatmap', source: 'heatmap-src', maxzoom: 16,
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)', 0.25, '#22c55e', 0.5, '#eab308', 0.75, '#f97316', 1, '#ef4444',
          ],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 5, 15, 15, 50],
          'heatmap-opacity': 0.75,
        },
        layout: { visibility: 'none' },
      })

      // Áreas de risco
      map.addLayer({
        id: 'areas-fill', type: 'fill', source: 'areas-risco',
        paint: {
          'fill-color': ['match', ['get', 'nivel'], 'R1','#22c55e','R2','#eab308','R3','#f97316','R4','#ef4444','#94a3b8'],
          'fill-opacity': 0.2,
        },
        layout: { visibility: 'visible' },
      })
      map.addLayer({
        id: 'areas-outline', type: 'line', source: 'areas-risco',
        paint: {
          'line-color': ['match', ['get', 'nivel'], 'R1','#22c55e','R2','#eab308','R3','#f97316','R4','#ef4444','#94a3b8'],
          'line-width': 2.5,
        },
        layout: { visibility: 'visible' },
      })

      // Ocorrências
      map.addLayer({
        id: 'ocorrencias-layer', type: 'circle', source: 'ocorrencias',
        paint: {
          'circle-radius': 8,
          'circle-color': ['match', ['get', 'nivel'], 'critico','#ef4444','alto','#f97316','medio','#eab308','baixo','#22c55e','#38bdf8'],
          'circle-stroke-width': 2.5, 'circle-stroke-color': '#fff',
        },
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

      // Pluviométrico
      map.addLayer({
        id: 'pluvio-layer', type: 'circle', source: 'pluvio-src',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 25, 14, 55],
          'circle-color': ['get', 'cor'],
          'circle-opacity': 0.35,
          'circle-stroke-width': 1,
          'circle-stroke-color': ['get', 'cor'],
          'circle-stroke-opacity': 0.6,
        },
        layout: { visibility: 'none' },
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

      // WMS overlays (inicialmente invisíveis)
      map.addLayer({ id: 'idesisema-layer', type: 'raster', source: 'idesisema-src', paint: { 'raster-opacity': 0.55 }, layout: { visibility: 'none' } })
      map.addLayer({ id: 'firms-layer',     type: 'raster', source: 'firms-src',     paint: { 'raster-opacity': 0.85 }, layout: { visibility: 'none' } })

      // ── Eventos ───────────────────────────────────────────
      map.on('mousemove', e => setCoordAtual({ lat: e.lngLat.lat, lng: e.lngLat.lng }))

      // Click no mapa — desenho ou coordenada
      map.on('click', e => {
        if (!drawRef.current.ativo) {
          localStorage.setItem('ultimaCoordenada', JSON.stringify({ lat: e.lngLat.lat, lng: e.lngLat.lng }))
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
        const cor = RISCO_CORES[p.nivel] || '#94a3b8'
        new maplibregl.Popup({ closeButton: true, maxWidth: '240px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="font-family:sans-serif;padding:4px"><b style="color:${cor}">Área de Risco ${p.nivel}</b><br><small style="color:#64748b">${p.descricao || '—'}</small></div>`)
          .addTo(map)
      })

      // Popups — ocorrências
      map.on('click', 'ocorrencias-layer', e => {
        const p = e.features[0].properties
        const cor = NIVEL_CORES[p.nivel] || '#38bdf8'
        new maplibregl.Popup({ closeButton: true, maxWidth: '220px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="font-family:sans-serif;padding:4px"><b>${p.tipo}</b><div style="color:#64748b;font-size:12px;margin-top:2px">${p.descricao || '—'}</div><span style="display:inline-block;margin-top:5px;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:700;background:${cor}22;color:${cor}">${(p.nivel||'').toUpperCase()}</span></div>`)
          .addTo(map)
      })

      // Cursores
      const cursors = [
        { in: 'vis-pontos',   out: 'vis-pontos' },
        { in: 'vis-clusters', out: 'vis-clusters' },
        { in: 'areas-fill',   out: 'areas-fill' },
        { in: 'ocorrencias-layer', out: 'ocorrencias-layer' },
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
      if (gpsWatch.current !== null) navigator.geolocation.clearWatch(gpsWatch.current)
      map.remove()
      mapGl.current = null
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
    if (!map) return
    const c = CIDADES[cidade]
    const [lng, lat] = c.center
    map.flyTo({ center: [lng, lat], zoom: c.zoom, pitch: terreno3D ? 45 : 0, bearing: 0, duration: 2200, essential: true })
    carregarClima(cidade)
  }, [cidade])

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
    if (!map) return
    map.getCanvas().style.cursor = modoDesenho ? 'crosshair' : ''
    drawRef.current.ativo = !!modoDesenho
    if (!modoDesenho) limparDesenho()
  }, [modoDesenho])

  // ── nivelRisco ref atualizado ───────────────────────────────
  useEffect(() => { nivelRef.current = nivelRisco }, [nivelRisco])

  // ── Visibilidade das camadas de dados ───────────────────────
  useEffect(() => {
    const map = mapGl.current
    if (!map || !loadedRef.current) return
    const v = (id, on) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    v('heatmap-layer',     overlays.heatmap)
    v('areas-fill',        overlays.areas)
    v('areas-outline',     overlays.areas)
    v('vis-clusters',      overlays.vistorias)
    v('vis-cluster-count', overlays.vistorias)
    v('vis-pontos',        overlays.vistorias)
    v('vis-poly-fill',     overlays.vistorias)
    v('vis-poly-line',     overlays.vistorias)
    v('idesisema-layer',   overlays.idesisema)
    v('firms-layer',       overlays.incendios)
    v('pluvio-layer',      overlays.pluviometrico)
  }, [overlays])

  // ── Pluviométrico: carregar dados ao ativar ─────────────────
  useEffect(() => {
    if (overlays.pluviometrico) {
      ativarPluviometrico()
    } else {
      mapGl.current?.getSource('pluvio-src')?.setData({ type: 'FeatureCollection', features: [] })
      setPluvioAcum(null)
    }
  }, [overlays.pluviometrico, cidade])

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
      const [ocGeo, arGeo, vistorias] = await Promise.all([
        api.geojsonOcorrencias().catch(() => null),
        api.geojsonAreasRisco().catch(() => null),
        api.getVistorias().catch(() => []),
      ])

      if (ocGeo?.features) {
        map.getSource('ocorrencias')?.setData(ocGeo)
        map.getSource('heatmap-src')?.setData(ocGeo)
        setOcCount(ocGeo.features.length)
      }

      if (arGeo?.features) {
        map.getSource('areas-risco')?.setData(arGeo)
      }

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

  // ── Pluviométrico (grid 3×3, Open-Meteo 7 dias) ─────────────
  async function ativarPluviometrico() {
    const map = mapGl.current
    if (!map) return
    setPluvioCarregando(true)
    setPluvioAcum(null)
    try {
      const [lng0, lat0] = CIDADES[cidade].center
      const step = 0.025
      const pts = []
      for (let r = -1; r <= 1; r++)
        for (let c = -1; c <= 1; c++)
          pts.push({ lat: lat0 + r * step, lng: lng0 + c * step })

      const lats = pts.map(p => p.lat.toFixed(5)).join(',')
      const lngs = pts.map(p => p.lng.toFixed(5)).join(',')
      const res = await fetch(`/api/pluvio-grid?lats=${lats}&lngs=${lngs}`, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error('API error')
      const data = await res.json()
      const results = Array.isArray(data) ? data : [data]

      const ESCALA = [
        { min: 0, max: 10, cor: '#22c55e' }, { min: 10, max: 30, cor: '#84cc16' },
        { min: 30, max: 60, cor: '#eab308' }, { min: 60, max: 100, cor: '#f97316' },
        { min: 100, max: Infinity, cor: '#ef4444' },
      ]
      const getCor = mm => ESCALA.find(e => mm >= e.min && mm < e.max)?.cor || '#94a3b8'

      let soma = 0
      const features = results.map((r, i) => {
        const acum = (r.daily?.precipitation_sum || []).reduce((a, b) => a + (b || 0), 0)
        soma += acum
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [pts[i].lng, pts[i].lat] },
          properties: { cor: getCor(acum), acum: acum.toFixed(1) },
        }
      })
      map.getSource('pluvio-src')?.setData({ type: 'FeatureCollection', features })
      setPluvioAcum((soma / results.length).toFixed(1))
    } catch { setPluvioAcum('—') }
    finally { setPluvioCarregando(false) }
  }

  // ── Desenho ─────────────────────────────────────────────────
  function adicionarPonto(lngLat, mapInstance) {
    const map = mapInstance || mapGl.current
    const state = drawRef.current
    state.pontos.push([lngLat.lng, lngLat.lat])
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

  function limparDesenho() {
    drawRef.current.pontos = []
    mapGl.current?.getSource('draw-src')?.setData({ type: 'FeatureCollection', features: [] })
    mapGl.current?.getSource('draw-preview-src')?.setData({ type: 'FeatureCollection', features: [] })
  }

  async function confirmarArea() {
    if (!polyRascunho) return
    const coords = polyRascunho.pontos
    const geom = { type: 'Polygon', coordinates: [[...coords, coords[0]]] }
    try {
      await api.createAreaRisco({ nivel: nivelRisco, descricao: descRisco, cidade, geojson: geom })
    } catch {
      const areas = JSON.parse(localStorage.getItem('areasRisco') || '[]')
      areas.push({ nivel: nivelRisco, descricao: descRisco, cidade, data: new Date().toISOString() })
      localStorage.setItem('areasRisco', JSON.stringify(areas))
    }
    limparDesenho()
    setSalvandoArea(false)
    setPolyRascunho(null)
    setDescRisco('')
    carregarDados()
  }

  function cancelarArea() {
    limparDesenho()
    setSalvandoArea(false)
    setPolyRascunho(null)
    setDescRisco('')
    setModoDesenho(null)
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
        if (!map) return
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
          {modoDesenho ? (
            <>
              <span className={styles.desenhoHint}>✏️ Clique para adicionar pontos</span>
              {drawRef.current.pontos.length >= 3 && (
                <button className={styles.confirmarBtn} style={{ padding: '4px 10px', fontSize: 12 }} onClick={fecharPoligono}>
                  <FiCheck size={12} /> Fechar
                </button>
              )}
              <button className={styles.cancelarBtn} onClick={cancelarArea}><FiX size={13} /> Cancelar</button>
            </>
          ) : !salvandoArea && (
            <button className={styles.desenhoBtn} onClick={() => setModoDesenho('polygon')}>
              <FiSquare size={12} /> Área de Risco
            </button>
          )}


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

          <button className={styles.iconBtn} onClick={() => carregarDados()} title="Recarregar dados">
            <FiRefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Modal confirmar área */}
      {salvandoArea && (
        <div className={styles.modalArea}>
          <div className={styles.modalAreaHeader}>
            <FiAlertTriangle size={16} color="#f97316" />
            <h3>Confirmar Área de Risco</h3>
          </div>
          <label className={styles.modalLabel}>Nível de Risco</label>
          <div className={styles.riscoOpcoes}>
            {['R1','R2','R3','R4'].map(r => (
              <button
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
          <label className={styles.modalLabel}>Descrição (opcional)</label>
          <input
            className={styles.descInput}
            placeholder="Descreva a área de risco..."
            value={descRisco}
            onChange={e => setDescRisco(e.target.value)}
          />
          <div className={styles.modalBtns}>
            <button className={styles.confirmarBtn} onClick={confirmarArea}><FiCheck size={13} /> Salvar Área</button>
            <button className={styles.cancelarModalBtn} onClick={cancelarArea}><FiX size={13} /> Cancelar</button>
          </div>
        </div>
      )}

      {/* Painel de Camadas */}
      <div className={`${styles.layerPanel} ${!showCamadas ? styles.layerPanelCollapsed : ''}`}>
        <div className={styles.layerPanelHeader} onClick={() => setShowCamadas(s => !s)}>
          <FiLayers size={13} /><span>Camadas</span>
          {showCamadas ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
        </div>

        {showCamadas && (
          <>
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

            <div className={styles.layerSection}>
              <div className={styles.layerSectionTitle} onClick={() => setSecaoOverlay(s => !s)}>
                {secaoOverlay ? <FiChevronDown size={10} /> : <FiChevronRight size={10} />}
                <span>Sobreposições</span>
              </div>
              {secaoOverlay && (
                <div className={styles.overlayList}>
                  {[
                    { key: 'idesisema',     icone: '🗻', nome: 'Curvas de Nível MG', sub: 'IDESISEMA/SEMAD · WMS 30m' },
                    { key: 'incendios',     icone: '🔥', nome: 'Focos de Calor', sub: 'NASA FIRMS · WMS público' },
                    { key: 'pluviometrico', icone: '🌧️', nome: 'Índice Pluviométrico',
                      sub: overlays.pluviometrico ? (pluvioCarregando ? 'Carregando…' : pluvioAcum != null ? `Média 7d: ${pluvioAcum} mm` : '7 dias acumulado') : '' },
                    { key: 'heatmap',       icone: '📍', nome: 'Densidade Ocorrências', sub: `${ocCount} ponto(s)` },
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
          </>
        )}
      </div>

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
            <div className={styles.legendaSecaoTitle}>Ocorrências</div>
            {Object.entries(NIVEL_CORES).map(([nivel, cor]) => (
              <div key={nivel} className={styles.legendaItem}>
                <span className={styles.legendaDot} style={{ background: cor }} />
                <span className={styles.legendaItemLabel} style={{ textTransform:'capitalize' }}>{nivel}</span>
              </div>
            ))}
          </div>
          {overlays.pluviometrico && (
            <div className={styles.legendaSecao}>
              <div className={styles.legendaSecaoTitle}>Índice Pluviométrico — 7 dias</div>
              {[
                ['#22c55e','< 10 mm','Muito baixo'], ['#84cc16','10–30 mm','Baixo'],
                ['#eab308','30–60 mm','Moderado'],   ['#f97316','60–100 mm','Alto'],
                ['#ef4444','> 100 mm','Muito alto'],
              ].map(([cor, label, sub]) => (
                <div key={label} className={styles.legendaItem}>
                  <span className={styles.legendaDot} style={{ background: cor }} />
                  <span className={styles.legendaItemLabel}>{label}<span className={styles.legendaItemSub}>{sub}</span></span>
                </div>
              ))}
            </div>
          )}
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
          <div style={{
            position: 'absolute', inset: 0, zIndex: 50,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: '#f8fafc', gap: 16,
          }}>
            <div style={{ fontSize: 48 }}>🗺️</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#1e293b' }}>WebGL não disponível neste ambiente</div>
            <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', maxWidth: 360 }}>
              O mapa interativo requer aceleração gráfica (WebGL).<br />
              Abra o app em uma aba separada do navegador para visualizá-lo.
            </div>
            <a
              href={window.location.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: '#2563eb', color: '#fff', borderRadius: 8,
                padding: '10px 24px', fontWeight: 600, fontSize: 14,
                textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              🔗 Abrir em nova aba
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
