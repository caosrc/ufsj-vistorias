import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../services/api'
import { CIDADES } from '../data/cidades'
import { areaCentroide, ICONES_AREAS_RISCO } from '../data/areasRisco'

const BASE_TILES = {
  ruas: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', '© OpenStreetMap', 19],
  satelite: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', '© Esri', 19],
  topografico: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', '© OpenTopoMap', 17],
  esri_topo: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', '© Esri', 19],
  positron: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', '© CartoDB', 19],
  dark: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', '© CartoDB', 19],
}

const RISK_COLORS = { R1: '#22c55e', R2: '#eab308', R3: '#f97316', R4: '#ef4444' }

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
  areasGeoJSON,
  modoDesenho,
  drawPoints,
  refreshVersion,
  gpsPosition,
  mapRef,
  onCoordinate,
  onDrawPoint,
  onVistoriaClick,
  onPluvioStatus,
}) {
  const containerRef = useRef(null)
  const layersRef = useRef({})
  const callbacksRef = useRef({})
  const refreshRef = useRef(null)
  callbacksRef.current = {
    cidade, modoDesenho, drawPoints, areasGeoJSON,
    onCoordinate, onDrawPoint,
  }

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
        const color = feature?.properties?.cor || RISK_COLORS[feature?.properties?.nivel] || '#94a3b8'
        const emAlerta = feature?.properties?.em_alerta === true || feature?.properties?.em_alerta === 'true'
        return { color, weight: emAlerta ? 4 : 2, fillColor: color, fillOpacity: emAlerta ? 0.34 : 0.2 }
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {}
        const chuva = props.previsao_24h_mm == null
          ? 'sem dado'
          : `${Number(props.previsao_24h_mm).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm`
        const detalhes = [
          props.descricao,
          `Previsão 24 h: ${chuva}`,
          `Limite: ${props.limite_precipitacao_mm == null ? '—' : `${Number(props.limite_precipitacao_mm).toLocaleString('pt-BR')} mm`}`,
          props.referencia && `Referência: ${props.referencia}`,
          props.observacao && `Observação: ${props.observacao}`,
        ].filter(Boolean).join('\n')
        layer.bindPopup(textPopup(
          `${props.tipo || 'Área de risco'} · ${props.nivel || ''}`,
          detalhes,
          props.cor || '#d97706',
        ))
      },
    })
    const areaIconLayer = L.layerGroup()
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
      map, baseLayers, areaLayer, areaIconLayer, inspectionLayer,
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
            lat: event.latlng.lat, lng: event.latlng.lng, cidade: callbacksRef.current.cidade,
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
    if (containerRef.current) containerRef.current.style.cursor = modoDesenho ? 'crosshair' : ''
  }, [modoDesenho])

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
      map, areaLayer, inspectionLayer,
      contoursLayer, firesLayer,
    } = layersRef.current
    if (!map) return
    const setLayer = (layer, enabled) => {
      if (enabled && !map.hasLayer(layer)) layer.addTo(map)
      if (!enabled && map.hasLayer(layer)) map.removeLayer(layer)
    }
    setLayer(areaLayer, overlays.areas)
    setLayer(layersRef.current.areaIconLayer, overlays.areas)
    setLayer(inspectionLayer, overlays.vistorias)
    setLayer(contoursLayer, overlays.idesisema)
    setLayer(firesLayer, overlays.incendios)
    setLayer(layersRef.current.rainfallLayer, overlays.pluviometrico)
  }, [overlays])

  useEffect(() => {
    const loadData = async () => {
      const { inspectionLayer } = layersRef.current
      if (!inspectionLayer) return
      try {
        const inspections = await api.getVistorias().catch(() => [])

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
  }, [refreshVersion, onVistoriaClick])

  useEffect(() => {
    const refresh = () => refreshRef.current?.()
    window.addEventListener('geovistorias:offline-data-synced', refresh)
    return () => window.removeEventListener('geovistorias:offline-data-synced', refresh)
  }, [])

  useEffect(() => {
    const { map, areaLayer, areaIconLayer } = layersRef.current
    if (!map || !areaLayer || !areaIconLayer || !areasGeoJSON) return undefined

    areaLayer.clearLayers()
    areaIconLayer.clearLayers()
    areaLayer.addData(areasGeoJSON)

    areasGeoJSON.features.forEach(feature => {
      const props = feature.properties || {}
      const centro = areaCentroide({ geojson: feature.geometry })
      if (!centro) return

      const emAlerta = props.em_alerta === true || props.em_alerta === 'true'
      const marker = document.createElement('div')
      marker.className = `mapa-area-marker${emAlerta ? ' mapa-area-marker-alerta' : ''}`
      marker.style.setProperty('--area-marker-color', props.cor || '#d97706')
      const icon = document.createElement('span')
      icon.className = 'mapa-area-marker-icone'
      icon.textContent = ICONES_AREAS_RISCO[props.tipo] || '⚠'
      marker.appendChild(icon)

      const chuva = props.previsao_24h_mm == null
        ? 'sem dado'
        : `${Number(props.previsao_24h_mm).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm`
      const detalhes = [
        props.descricao,
        `Previsão 24 h: ${chuva}`,
        `Limite: ${props.limite_precipitacao_mm == null ? '—' : `${Number(props.limite_precipitacao_mm).toLocaleString('pt-BR')} mm`}`,
        props.referencia && `Referência: ${props.referencia}`,
        props.observacao && `Observação: ${props.observacao}`,
      ].filter(Boolean).join('\n')
      L.marker([centro.latitude, centro.longitude], {
        icon: L.divIcon({
          className: 'mapa-area-marker-leaflet',
          html: marker.outerHTML,
          iconSize: [42, 42],
          iconAnchor: [21, 21],
        }),
        title: `${props.tipo || 'Área de risco'}${emAlerta ? ' · alerta de chuva' : ''}`,
        keyboard: true,
      }).bindPopup(textPopup(
        `${props.tipo || 'Área de risco'} · ${props.nivel || ''}`,
        detalhes,
        props.cor || '#d97706',
      )).addTo(areaIconLayer)
    })

    const possuiAlerta = areasGeoJSON.features.some(feature =>
      feature.properties?.em_alerta === true || feature.properties?.em_alerta === 'true'
    )
    let fase = false
    const pulsar = () => {
      fase = !fase
      areaLayer.eachLayer(layer => {
        const props = layer.feature?.properties || {}
        if (props.em_alerta === true || props.em_alerta === 'true') {
          layer.setStyle({
            fillOpacity: fase ? 0.38 : 0.07,
            weight: fase ? 5 : 2.5,
          })
        }
      })
    }
    if (!possuiAlerta) return undefined
    pulsar()
    const timer = window.setInterval(pulsar, 700)
    return () => window.clearInterval(timer)
  }, [areasGeoJSON])

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
