export const TIPOS_AREAS_RISCO = [
  'Encostas',
  'Erosões',
  'Drenagem',
  'Alagamentos',
  'Deslizamentos',
  'Problemas de vias',
  'Obras',
  'Interdições',
]

export const CORES_AREAS_RISCO = {
  Encostas: '#d97706',
  'Erosões': '#b4533c',
  Drenagem: '#087e9b',
  Alagamentos: '#2457c5',
  Deslizamentos: '#b4233b',
  'Problemas de vias': '#7854a8',
  Obras: '#5c7b36',
  Interdições: '#c2410c',
}

export const ICONES_AREAS_RISCO = {
  Encostas: '▲',
  'Erosões': '🪨',
  Drenagem: '💧',
  Alagamentos: '🌊',
  Deslizamentos: '⛰️',
  'Problemas de vias': '🛣️',
  Obras: '🚧',
  Interdições: '⛔',
}

export function areaGeometry(area) {
  let geometry = area?.geojson ?? area?.geometry ?? null
  if (typeof geometry === 'string') {
    try { geometry = JSON.parse(geometry) } catch { return null }
  }
  if (geometry?.type === 'Feature') geometry = geometry.geometry
  return geometry?.type === 'Polygon' ? geometry : null
}

export function areaCentroide(area) {
  const latitude = Number(area?.latitude)
  const longitude = Number(area?.longitude)
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) return { latitude, longitude }

  const ring = areaGeometry(area)?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return null
  const pontos = ring.slice(0, -1)
  if (!pontos.length) return null
  const centro = pontos.reduce((sum, ponto) => ({
    longitude: sum.longitude + Number(ponto?.[0] || 0),
    latitude: sum.latitude + Number(ponto?.[1] || 0),
  }), { latitude: 0, longitude: 0 })
  return {
    latitude: centro.latitude / pontos.length,
    longitude: centro.longitude / pontos.length,
  }
}

export function areaParaFeature(area, previsao = null) {
  const geometry = areaGeometry(area)
  if (!geometry) return null
  const tipo = TIPOS_AREAS_RISCO.includes(area.tipo) ? area.tipo : 'Encostas'
  const limite = Number(area.limite_precipitacao_mm)
  const chuva = Number(previsao)
  const chuvaValida = previsao != null && Number.isFinite(chuva)
  const emAlerta = tipo !== 'Interdições' && chuvaValida && chuva > limite

  return {
    type: 'Feature',
    geometry,
    properties: {
      id: area.id,
      cidade: area.cidade,
      nivel: area.nivel,
      tipo,
      descricao: area.descricao || '',
      referencia: area.referencia || '',
      observacao: area.observacao || '',
      data_inicio: area.data_inicio || '',
      limite_precipitacao_mm: Number.isFinite(limite) ? limite : null,
      previsao_24h_mm: chuvaValida ? chuva : null,
      em_alerta: emAlerta,
      cor: CORES_AREAS_RISCO[tipo],
    },
  }
}

export function areasRiscoFeatureCollection(areas, previsoes = {}, cidade = '') {
  return {
    type: 'FeatureCollection',
    features: (Array.isArray(areas) ? areas : [])
      .filter(area => !cidade || !area.cidade || area.cidade === cidade)
      .map(area => areaParaFeature(area, previsoes?.[area.id]))
      .filter(Boolean),
  }
}
