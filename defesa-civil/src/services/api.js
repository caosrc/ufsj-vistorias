const API_URL = import.meta.env.VITE_API_URL ?? ''
export const API_BASE = `${API_URL}/api`
const BASE = API_BASE

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
  updateVistoria: (id, data) => req('PUT', `/vistorias/${id}`, data),
  patchEdificacao: (id, data) => req('PATCH', `/vistorias/${id}/edificacao`, { edificacao_planta: data }),
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

  // Precipitações (CSV de chuva)
  getPrecipitacoes: () => req('GET', '/precipitacoes'),
  savePrecipitacoes: (filename, dados) => req('POST', '/precipitacoes', { filename, dados }),
  deletePrecipitacoes: () => req('DELETE', '/precipitacoes'),
}
