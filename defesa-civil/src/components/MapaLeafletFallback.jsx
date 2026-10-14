import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../services/api'
import { CIDADES } from '../data/cidades'

const BASE_TILES = {
  ruas: ['/api/map-tile/osm/{z}/{x}/{y}', '© OpenStreetMap', 19],
  satelite: ['/api/sat-tile/{z}/{y}/{x}', '© Esri', 19],
  topografico: ['/api/map-tile/topo/{z}/{x}/{y}', '© OpenTopoMap', 17],
  esri_topo: ['/api/map-tile/esri/{z}/{x}/{y}', '© Esri', 19],
  positron: ['/api/map-tile/carto_l/{z}/{x}/{y}', '© CartoDB', 19],
  dark: ['/api/map-tile/carto_d/{z}/{x}/{y}', '© CartoDB', 19],
}

const RISK_COLORS = { R1: '#22c55e', R2: '#eab308', R3: '#f97316', R4: '#ef4444' }
const EVENT_COLORS = { critico: '#ef4444', alto: '#f97316', medio: '#eab308', baixo: '#22c55e' }

function textPopup(title, description, color = '#1e293b') {
  const element = document.createElement('div')
  const heading = document.createElement('strong')
  heading.textContent = title || 'Registro'
  heading.style.color = color
  element.appendChild(heading)
  if (description) {
    const detail = document.createElement('div')
    detail.textContent = description
    detail.style.cssText = 'margin-top:4px;color:#64748b;font-size:12px'
    element.appendChild(detail)
  }
  return element
}

export default function MapaLeafletFallback({
  cidade,
  camada,
  overlays,
  modoDesenho,
  drawPoints,
  refreshVersion,
  gpsPosition,
  mapRef,
  onCoordinate,
  onDrawPoint,
  onVistoriaClick,
  onOcorrenciasCount,
  onPluvioStatus,
}) {
  const containerRef = useRef(null)
  const layersRef = useRef({})
  const callbacksRef = useRef({})
  const refreshRef = useRef(null)
  callbacksRef.current = { modoDesenho, drawPoints, onCoordinate, onDrawPoint }

  useEffect(() => {
    const city = CIDADES[cidade]
    const map = L.map(containerRef.current, {
      center: [city.center[1], city.center[0]],
      zoom: city.zoom,
      zoomControl: false,
      preferCanvas: true,
    })
    mapRef.current = map
    L.control.zoom({ position: 'topright' }).addTo(map)
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map)

    const baseLayers = Object.fromEntries(Object.entries(BASE_TILES).map(([key, [url, attribution, maxZoom]]) => [
      key,
      L.tileLayer(url, { maxZoom: 22, maxNativeZoom: maxZoom, attribution, crossOrigin: true }),
    ]))
    const areaLayer = L.geoJSON(undefined, {
      style: feature => {
        const color = RISK_COLORS[feature?.properties?.nivel] || '#94a3b8'
        return { color, weight: 2, fillColor: color, fillOpacity: 0.2 }
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {}
        layer.bindPopup(textPopup(`Área de Risco ${props.nivel || ''}`, props.descricao))
      },
    })
    const occurrenceLayer = L.layerGroup()
    const heatLayer = L.layerGroup()
    const inspectionLayer = L.layerGroup()
    const drawingLayer = L.layerGroup().addTo(map)
    const previewLayer = L.layerGroup().addTo(map)
    const gpsLayer = L.layerGroup().addTo(map)
    const rainfallLayer = L.layerGroup()
    const contoursLayer = L.tileLayer.wms('https://idesisema.meioambiente.mg.gov.br/geoserver/wms', {
      layers: 'semad_siam:curvas_nivel,semad_siam:hipsometria',
      format: 'image/png', transparent: true, opacity: 0.55, attribution: 'IDESISEMA/SEMAD',
    })
    const firesLayer = L.tileLayer.wms('https://firms.modaps.eosdis.nasa.gov/mapserver/wms/', {
      layers: 'fires_viirs_snpp_sp,fires_viirs_noaa20_sp',
      format: 'image/png', transparent: true, opacity: 0.85, attribution: 'NASA FIRMS',
    })

    layersRef.current = {
      map, baseLayers, areaLayer, occurrenceLayer, heatLayer, inspectionLayer,
      drawingLayer, previewLayer, gpsLayer, rainfallLayer, contoursLayer, firesLayer,
    }
    baseLayers.ruas.addTo(map)

    map.on('mousemove', event => callbacksRef.current.onCoordinate?.({
      lat: event.latlng.lat, lng: event.latlng.lng,
    }))
    map.on('click', event => {
      if (callbacksRef.current.modoDesenho) {
        callbacksRef.current.onDrawPoint?.({ lat: event.latlng.lat, lng: event.latlng.lng })
      } else {
        try {
          localStorage.setItem('ultimaCoordenada', JSON.stringify({
            lat: event.latlng.lat, lng: event.latlng.lng,
          }))
        } catch {}
      }
    })
    map.on('mousemove', event => {
      const points = callbacksRef.current.modoDesenho ? callbacksRef.current.drawPoints : null
      if (!points?.length) return
      previewLayer.clearLayers()
      const last = points[points.length - 1]
      L.polyline([[last[1], last[0]], event.latlng], {
        color: '#38bdf8', weight: 2, dashArray: '4 4', opacity: 0.7,
      }).addTo(previewLayer)
    })

    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 80)
    return () => {
      window.clearTimeout(resizeTimer)
      map.remove()
      if (mapRef.current === map) mapRef.current = null
      layersRef.current = {}
    }
  }, [])

  useEffect(() => {
    const map = layersRef.current.map
    if (!map) return
    const city = CIDADES[cidade]
    map.setView([city.center[1], city.center[0]], city.zoom, { animate: true })
  }, [cidade])

  useEffect(() => {
    const { map, baseLayers } = layersRef.current
    if (!map) return
    Object.values(baseLayers).forEach(layer => map.removeLayer(layer))
    baseLayers[camada]?.addTo(map)
  }, [camada])

  useEffect(() => {
    const {
      map, areaLayer, occurrenceLayer, heatLayer, inspectionLayer,
      contoursLayer, firesLayer,
    } = layersRef.current
    if (!map) return
    const setLayer = (layer, enabled) => {
      if (enabled && !map.hasLayer(layer)) layer.addTo(map)
      if (!enabled && map.hasLayer(layer)) map.removeLayer(layer)
    }
    setLayer(areaLayer, overlays.areas)
    setLayer(occurrenceLayer, true)
    setLayer(heatLayer, overlays.heatmap)
    setLayer(inspectionLayer, overlays.vistorias)
    setLayer(contoursLayer, overlays.idesisema)
    setLayer(firesLayer, overlays.incendios)
    setLayer(layersRef.current.rainfallLayer, overlays.pluviometrico)
  }, [overlays])

  useEffect(() => {
    const loadData = async () => {
      const {
        areaLayer, occurrenceLayer, heatLayer, inspectionLayer,
      } = layersRef.current
      if (!areaLayer) return
      try {
        const [occurrences, areas, inspections] = await Promise.all([
          api.geojsonOcorrencias().catch(() => null),
          api.geojsonAreasRisco().catch(() => null),
          api.getVistorias().catch(() => []),
        ])

        areaLayer.clearLayers()
        if (areas?.features) areaLayer.addData(areas)

        occurrenceLayer.clearLayers()
        heatLayer.clearLayers()
        const occurrenceFeatures = occurrences?.features || []
        onOcorrenciasCount?.(occurrenceFeatures.length)
        occurrenceFeatures.forEach(feature => {
          const [lng, lat] = feature.geometry?.coordinates || []
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
          const props = feature.properties || {}
          const color = EVENT_COLORS[props.nivel] || '#38bdf8'
          L.circleMarker([lat, lng], {
            radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.95,
          }).bindPopup(textPopup(props.tipo, props.descricao, color)).addTo(occurrenceLayer)
          L.circleMarker([lat, lng], {
            radius: 20, color, weight: 1, fillColor: color, fillOpacity: 0.14,
          }).addTo(heatLayer)
        })

        inspectionLayer.clearLayers()
        ;(Array.isArray(inspections) ? inspections : []).forEach(item => {
          const popup = textPopup(item.nome || 'Vistoria', item.endereco || item.observacao || '')
          const inspect = layer => layer.on('click', () => onVistoriaClick?.(item)).bindPopup(popup)
          let polygonAdded = false
          if (item.area_vertices) {
            try {
              const vertices = typeof item.area_vertices === 'string'
                ? JSON.parse(item.area_vertices) : item.area_vertices
              if (Array.isArray(vertices) && vertices.length >= 3) {
                const polygon = L.polygon(vertices.map(point => [point.lat, point.lng]), {
                  color: RISK_COLORS[item.risco] || '#64748b',
                  weight: 2, fillOpacity: 0.16,
                })
                inspect(polygon).addTo(inspectionLayer)
                polygonAdded = true
              }
            } catch {}
          }
          if (!polygonAdded && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng))) {
            const marker = L.circleMarker([Number(item.lat), Number(item.lng)], {
              radius: 8, color: '#fff', weight: 2,
              fillColor: RISK_COLORS[item.risco] || '#64748b', fillOpacity: 1,
            })
            inspect(marker).addTo(inspectionLayer)
          }
        })
      } catch (error) {
        console.warn('Não foi possível atualizar as camadas do mapa:', error)
      }
    }
    refreshRef.current = loadData
    loadData()
  }, [refreshVersion, onOcorrenciasCount, onVistoriaClick])

  useEffect(() => {
    const refresh = () => refreshRef.current?.()
    window.addEventListener('geovistorias:offline-data-synced', refresh)
    return () => window.removeEventListener('geovistorias:offline-data-synced', refresh)
  }, [])

  useEffect(() => {
    const { drawingLayer, previewLayer } = layersRef.current
    if (!drawingLayer) return
    drawingLayer.clearLayers()
    previewLayer.clearLayers()
    if (drawPoints.length > 1) {
      const latlngs = drawPoints.map(([lng, lat]) => [lat, lng])
      L.polyline(latlngs, { color: '#38bdf8', weight: 2, dashArray: '5 3' }).addTo(drawingLayer)
      if (drawPoints.length >= 3) {
        L.polygon(latlngs, { color: '#38bdf8', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.18 }).addTo(drawingLayer)
      }
    }
    drawPoints.forEach(([lng, lat]) => L.circleMarker([lat, lng], {
      radius: 5, color: '#fff', weight: 2, fillColor: '#38bdf8', fillOpacity: 1,
    }).addTo(drawingLayer))
  }, [drawPoints])

  useEffect(() => {
    const { gpsLayer } = layersRef.current
    if (!gpsLayer) return
    gpsLayer.clearLayers()
    if (!gpsPosition) return
    L.circle([gpsPosition.lat, gpsPosition.lng], {
      radius: gpsPosition.accuracy || 0, color: '#2563eb', weight: 1.5,
      fillColor: '#2563eb', fillOpacity: 0.08,
    }).addTo(gpsLayer)
    L.circleMarker([gpsPosition.lat, gpsPosition.lng], {
      radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1,
    }).addTo(gpsLayer)
    layersRef.current.map?.setView([gpsPosition.lat, gpsPosition.lng],
      Math.max(layersRef.current.map.getZoom(), 16), { animate: true })
  }, [gpsPosition])

  useEffect(() => {
    const map = layersRef.current.map
    if (!map || !overlays.pluviometrico) {
      onPluvioStatus?.(false, null)
      return
    }
    let cancelled = false
    const layer = layersRef.current.rainfallLayer
    layer.clearLayers()
    onPluvioStatus?.(true, null)
    const [lng0, lat0] = CIDADES[cidade].center
    const points = []
    for (let row = -1; row <= 1; row++) {
      for (let col = -1; col <= 1; col++) {
        points.push({ lat: lat0 + row * 0.025, lng: lng0 + col * 0.025 })
      }
    }
    const query = new URLSearchParams({
      lats: points.map(point => point.lat.toFixed(5)).join(','),
      lngs: points.map(point => point.lng.toFixed(5)).join(','),
    })
    fetch(`/api/pluvio-grid?${query}`, { signal: AbortSignal.timeout(15000) })
      .then(response => {
        if (!response.ok) throw new Error('Falha ao obter precipitação')
        return response.json()
      })
      .then(data => {
        if (cancelled) return
        const results = Array.isArray(data) ? data : [data]
        let total = 0
        results.forEach((result, index) => {
          const amount = (result.daily?.precipitation_sum || []).reduce((sum, value) => sum + (value || 0), 0)
          total += amount
          const color = amount >= 100 ? '#ef4444' : amount >= 60 ? '#f97316' : amount >= 30 ? '#eab308' : '#22c55e'
          L.circleMarker([points[index].lat, points[index].lng], {
            radius: 22, color, weight: 1, fillColor: color, fillOpacity: 0.32,
          }).bindTooltip(`${amount.toFixed(1)} mm em 7 dias`).addTo(layer)
        })
        onPluvioStatus?.(false, (total / Math.max(results.length, 1)).toFixed(1))
      })
      .catch(() => { if (!cancelled) onPluvioStatus?.(false, '—') })
    return () => { cancelled = true }
  }, [cidade, overlays.pluviometrico, onPluvioStatus])

  return (
    <div
      ref={containerRef}
      aria-label="Mapa operacional"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  )
}
