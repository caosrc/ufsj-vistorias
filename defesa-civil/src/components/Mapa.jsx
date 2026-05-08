import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { CIDADES, CIDADE_PADRAO } from '../data/cidades'
import styles from './Mapa.module.css'
import PainelClima from './PainelClima'
import { FiMapPin, FiLayers, FiTrash2, FiEdit3 } from 'react-icons/fi'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const TILE_LAYERS = {
  ruas: {
    label: 'Ruas',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors'
  },
  satelite: {
    label: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri'
  },
  topografico: {
    label: 'Topográfico',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap'
  }
}

const RISCO_COLORS = { R1: '#22c55e', R2: '#eab308', R3: '#f97316', R4: '#ef4444' }

export default function Mapa() {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const tileLayerRef = useRef(null)
  const ocMarkersRef = useRef([])
  const areaLayersRef = useRef([])
  const tempMarkersRef = useRef([])
  const polylineRef = useRef(null)

  const [camada, setCamada] = useState('ruas')
  const [cidade, setCidade] = useState(CIDADE_PADRAO)
  const [coordAtual, setCoordAtual] = useState(null)
  const [showClima, setShowClima] = useState(false)
  const [areasRisco, setAreasRisco] = useState(() =>
    JSON.parse(localStorage.getItem('areasRisco') || '[]')
  )
  const [modoDesenho, setModoDesenho] = useState(false)
  const [pontosDesenho, setPontosDesenho] = useState([])

  const modoDesenhoRef = useRef(false)
  const pontosDesenhoRef = useRef([])

  useEffect(() => {
    modoDesenhoRef.current = modoDesenho
  }, [modoDesenho])

  useEffect(() => {
    pontosDesenhoRef.current = pontosDesenho
  }, [pontosDesenho])

  useEffect(() => {
    if (mapRef.current) return
    const cidadeObj = CIDADES[cidade]

    mapRef.current = L.map(mapContainer.current, {
      center: [cidadeObj.center[1], cidadeObj.center[0]],
      zoom: cidadeObj.zoom,
      zoomControl: true
    })

    tileLayerRef.current = L.tileLayer(TILE_LAYERS.ruas.url, {
      attribution: TILE_LAYERS.ruas.attribution,
      maxZoom: 19
    }).addTo(mapRef.current)

    renderAreasRisco()
    loadOcorrenciasMarkers()

    mapRef.current.on('click', (e) => {
      const lat = e.latlng.lat
      const lng = e.latlng.lng
      setCoordAtual({ lat, lng })
      localStorage.setItem('ultimaCoordenada', JSON.stringify({ lat, lng }))

      if (modoDesenhoRef.current) {
        const newPoint = [lat, lng]
        const newPontos = [...pontosDesenhoRef.current, newPoint]
        setPontosDesenho(newPontos)

        const marker = L.circleMarker([lat, lng], {
          radius: 5,
          fillColor: '#f59e0b',
          color: '#fff',
          weight: 1,
          fillOpacity: 1
        }).addTo(mapRef.current)
        tempMarkersRef.current.push(marker)

        if (polylineRef.current) {
          mapRef.current.removeLayer(polylineRef.current)
        }
        if (newPontos.length > 1) {
          polylineRef.current = L.polyline(newPontos, {
            color: '#f59e0b',
            weight: 2,
            dashArray: '5,5'
          }).addTo(mapRef.current)
        }
      } else {
        L.popup()
          .setLatLng([lat, lng])
          .setContent(`<b style="color:#1e293b">Coordenada Salva</b><br><small>Lat: ${lat.toFixed(5)}<br>Lng: ${lng.toFixed(5)}</small>`)
          .openOn(mapRef.current)
      }
    })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return
    const layer = TILE_LAYERS[camada]
    tileLayerRef.current.setUrl(layer.url)
  }, [camada])

  useEffect(() => {
    if (!mapRef.current) return
    const cidadeObj = CIDADES[cidade]
    mapRef.current.flyTo([cidadeObj.center[1], cidadeObj.center[0]], cidadeObj.zoom, {
      duration: 1.5
    })
  }, [cidade])

  function renderAreasRisco() {
    areaLayersRef.current.forEach(l => mapRef.current.removeLayer(l))
    areaLayersRef.current = []

    const areas = JSON.parse(localStorage.getItem('areasRisco') || '[]')
    areas.forEach(area => {
      const latLngs = area.pontos.map(p => [p[1], p[0]])
      const color = RISCO_COLORS[area.nivel] || '#ef4444'
      const polygon = L.polygon(latLngs, {
        color,
        fillColor: color,
        fillOpacity: 0.3,
        weight: 2
      })
        .bindPopup(`<b style="color:#1e293b">${area.nivel}</b><br><small>${area.descricao || ''}</small>`)
        .addTo(mapRef.current)
      areaLayersRef.current.push(polygon)
    })
  }

  function loadOcorrenciasMarkers() {
    ocMarkersRef.current.forEach(m => mapRef.current.removeLayer(m))
    ocMarkersRef.current = []
    const ocorrencias = JSON.parse(localStorage.getItem('ocorrencias') || '[]')
    ocorrencias.forEach(oc => {
      if (oc.coordenada) {
        const icon = L.divIcon({
          html: '<div style="width:12px;height:12px;background:#ef4444;border-radius:50%;border:2px solid white"></div>',
          className: '',
          iconSize: [12, 12],
          iconAnchor: [6, 6]
        })
        const marker = L.marker([oc.coordenada.lat, oc.coordenada.lng], { icon })
          .bindPopup(`<b style="color:#1e293b">${oc.tipo}</b><br><small>${oc.descricao || ''}</small>`)
          .addTo(mapRef.current)
        ocMarkersRef.current.push(marker)
      }
    })
  }

  function finalizarArea() {
    const pts = pontosDesenhoRef.current
    if (pts.length < 3) {
      alert('Desenhe pelo menos 3 pontos para criar uma área.')
      return
    }
    const nivelRisco = prompt('Nível de risco da área (R1, R2, R3, R4):', 'R2')
    const descricao = prompt('Descrição da área de risco:', '')
    if (!nivelRisco) return

    const fechado = [...pts.map(p => [p[1], p[0]]), [pts[0][1], pts[0][0]]]
    const novaArea = {
      pontos: fechado,
      nivel: nivelRisco.toUpperCase(),
      descricao: descricao || '',
      cidade,
      data: new Date().toISOString()
    }

    const areas = JSON.parse(localStorage.getItem('areasRisco') || '[]')
    areas.push(novaArea)
    localStorage.setItem('areasRisco', JSON.stringify(areas))
    setAreasRisco(areas)

    cancelarDesenho(false)
    renderAreasRisco()
  }

  function cancelarDesenho(resetState = true) {
    tempMarkersRef.current.forEach(m => mapRef.current.removeLayer(m))
    tempMarkersRef.current = []
    if (polylineRef.current) {
      mapRef.current.removeLayer(polylineRef.current)
      polylineRef.current = null
    }
    setPontosDesenho([])
    pontosDesenhoRef.current = []
    if (resetState) setModoDesenho(false)
    else setModoDesenho(false)
  }

  function limparAreas() {
    if (!confirm('Remover todas as áreas de risco?')) return
    localStorage.setItem('areasRisco', '[]')
    setAreasRisco([])
    areaLayersRef.current.forEach(l => mapRef.current.removeLayer(l))
    areaLayersRef.current = []
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <select
            className={styles.select}
            value={cidade}
            onChange={e => setCidade(e.target.value)}
          >
            {Object.values(CIDADES).map(c => (
              <option key={c.codigo} value={c.codigo}>{c.nome}</option>
            ))}
          </select>

          <div className={styles.camadaGroup}>
            <FiLayers size={14} />
            {Object.entries(TILE_LAYERS).map(([key, val]) => (
              <button
                key={key}
                className={`${styles.camadaBtn} ${camada === key ? styles.camadaBtnActive : ''}`}
                onClick={() => setCamada(key)}
              >
                {val.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.toolbarRight}>
          {!modoDesenho ? (
            <button
              className={styles.desenhoBtn}
              onClick={() => setModoDesenho(true)}
              title='Desenhar área de risco'
            >
              <FiEdit3 size={14} /> Área de Risco
            </button>
          ) : (
            <>
              <button
                className={styles.finalizarBtn}
                onClick={finalizarArea}
                disabled={pontosDesenho.length < 3}
              >
                Finalizar ({pontosDesenho.length} pts)
              </button>
              <button className={styles.cancelarBtn} onClick={() => cancelarDesenho(true)}>
                Cancelar
              </button>
            </>
          )}
          {areasRisco.length > 0 && (
            <button className={styles.limparBtn} onClick={limparAreas} title='Limpar áreas'>
              <FiTrash2 size={14} />
            </button>
          )}
          <button
            className={`${styles.climaBtn} ${showClima ? styles.climaBtnActive : ''}`}
            onClick={() => setShowClima(s => !s)}
          >
            Clima
          </button>
        </div>
      </div>

      {modoDesenho && (
        <div className={styles.desenhoAlert}>
          <FiEdit3 /> Modo de Desenho Ativo — clique no mapa para adicionar pontos da área de risco
        </div>
      )}

      {coordAtual && (
        <div className={styles.coordBar}>
          <FiMapPin size={12} />
          Lat: {coordAtual.lat.toFixed(5)} | Lng: {coordAtual.lng.toFixed(5)}
        </div>
      )}

      <div ref={mapContainer} className={styles.map} />

      {showClima && (
        <div className={styles.climaPanel}>
          <PainelClima cidade={cidade} />
        </div>
      )}
    </div>
  )
}
