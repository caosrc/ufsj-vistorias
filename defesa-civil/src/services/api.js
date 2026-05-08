const BASE = '/api'

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export const api = {
  // Ocorrências
  getOcorrencias: () => req('GET', '/ocorrencias'),
  createOcorrencia: (data) => req('POST', '/ocorrencias', data),
  deleteOcorrencia: (id) => req('DELETE', `/ocorrencias/${id}`),
  geojsonOcorrencias: () => req('GET', '/geojson/ocorrencias'),

  // Vistorias
  getVistorias: () => req('GET', '/vistorias'),
  createVistoria: (data) => req('POST', '/vistorias', data),
  deleteVistoria: (id) => req('DELETE', `/vistorias/${id}`),

  // Imóveis
  getImoveis: () => req('GET', '/imoveis'),
  createImovel: (data) => req('POST', '/imoveis', data),
  deleteImovel: (id) => req('DELETE', `/imoveis/${id}`),

  // Áreas de Risco
  getAreasRisco: () => req('GET', '/areas-risco'),
  createAreaRisco: (data) => req('POST', '/areas-risco', data),
  deleteAreaRisco: (id) => req('DELETE', `/areas-risco/${id}`),
  geojsonAreasRisco: () => req('GET', '/geojson/areas-risco'),

  // Stats
  getStats: () => req('GET', '/stats'),
}
