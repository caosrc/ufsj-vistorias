import {
  enqueueOfflineOperation,
  getOfflineQueue,
  readOfflineIdMapping,
  readOfflineCache,
  removeOfflineOperation,
  updateOfflineOperation,
  writeOfflineIdMapping,
  writeOfflineCache,
} from './offlineStorage'

const API_URL = import.meta.env.VITE_API_URL ?? ''
export const API_BASE = `${API_URL}/api`
const BASE = API_BASE

const RESOURCE_PATHS = {
  ocorrencias: '/ocorrencias',
  vistorias: '/vistorias',
  imoveis: '/imoveis',
  'areas-risco': '/areas-risco',
  precipitacoes: '/precipitacoes',
  monitoramento: '/monitoramento',
}

const LEGACY_STORAGE_KEYS = {
  ocorrencias: 'ocorrencias',
  vistorias: 'vistorias',
  imoveis: 'imoveis',
  'areas-risco': 'areasRisco',
  precipitacoes: 'precipitacoes',
  monitoramento: 'monitoramento',
}

let isSyncing = false
let syncingOperationId = null

function safeParse(value, fallback) {
  try {
    return value == null ? fallback : JSON.parse(value)
  } catch {
    return fallback
  }
}

function pathWithoutQuery(path) {
  return path.split('?')[0]
}

function resourceForPath(path) {
  const pathname = pathWithoutQuery(path)
  if (pathname.startsWith('/geojson/ocorrencias')) return 'ocorrencias'
  if (pathname.startsWith('/geojson/areas-risco')) return 'areas-risco'
  return Object.keys(RESOURCE_PATHS).find(name => {
    const root = RESOURCE_PATHS[name]
    return pathname === root || pathname.startsWith(`${root}/`)
  }) || null
}

function isCollectionPath(path, resource) {
  return pathWithoutQuery(path) === RESOURCE_PATHS[resource]
}

function operationId(operation) {
  return decodeURIComponent(pathWithoutQuery(operation.path).split('/').filter(Boolean).at(-1) || '')
}

async function resolveMappedPath(path) {
  const parts = path.split('/')
  const idIndex = parts.findIndex(part => part.startsWith('offline-'))
  if (idIndex < 0) return path
  const mappedId = await readOfflineIdMapping(decodeURIComponent(parts[idIndex]))
  if (mappedId == null) return path
  parts[idIndex] = encodeURIComponent(String(mappedId))
  return parts.join('/')
}

function sameId(a, b) {
  return String(a) === String(b)
}

function legacyCollection(resource) {
  try {
    const value = safeParse(localStorage.getItem(LEGACY_STORAGE_KEYS[resource]), null)
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function offlineGeoJson() {
  return { type: 'FeatureCollection', features: [] }
}

function createGeoFeature(resource, record) {
  if (resource === 'ocorrencias' && record.lat != null && record.lng != null) {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(record.lng), Number(record.lat)] },
      properties: {
        id: record.id,
        tipo: record.tipo,
        nivel: record.nivel,
        descricao: record.descricao,
        data: record.data,
      },
    }
  }
  if (resource === 'areas-risco' && record.geojson) {
    let geometry = record.geojson
    if (typeof geometry === 'string') {
      try { geometry = JSON.parse(geometry) } catch { return null }
    }
    return {
      type: 'Feature',
      geometry,
      properties: { id: record.id, nivel: record.nivel, descricao: record.descricao },
    }
  }
  return null
}

function applyMutationToCollection(records, operation, resource) {
  const list = Array.isArray(records) ? [...records] : []
  if (resourceForPath(operation.path) !== resource) return list

  const method = operation.method.toUpperCase()
  if (method === 'POST' && isCollectionPath(operation.path, resource)) {
    const record = {
      ...operation.body,
      id: operation.optimisticId ?? operation.result?.id ?? operation.body?.id,
    }
    if (resource === 'monitoramento') {
      record.createdAt ||= operation.createdAt
      record.fotosAnomalias ||= []
      record.relatoriosSalvos ||= []
    }
    const existingIndex = list.findIndex(item => sameId(item.id, record.id))
    if (existingIndex >= 0) list[existingIndex] = { ...list[existingIndex], ...record }
    else list.unshift(record)
    return list
  }

  if (resource === 'monitoramento') {
    const parts = pathWithoutQuery(operation.path).split('/').filter(Boolean).map(decodeURIComponent)
    const recordIndex = parts[0] === 'monitoramento'
      ? list.findIndex(item => sameId(item.id, parts[1]))
      : -1

    if (recordIndex >= 0 && parts[2] === 'fotos' && method === 'POST') {
      const body = operation.body || {}
      const photo = operation.result?.photo || {
        id: body.id,
        url: body.base64,
        codigoTrinca: body.codigoTrinca,
        pontos: body.pontos || [],
        linhas: body.linhas || [],
        observacao: body.observacao || '',
      }
      const current = list[recordIndex]
      const photos = current.fotosAnomalias || []
      if (!photos.some(item => sameId(item.id, photo.id))) {
        list[recordIndex] = { ...current, fotosAnomalias: [...photos, photo] }
      }
      return list
    }

    if (recordIndex >= 0 && parts[2] === 'relatorios') {
      const current = list[recordIndex]
      const reports = current.relatoriosSalvos || []
      if (method === 'POST' && parts.length === 3) {
        const report = operation.body
        list[recordIndex] = {
          ...current,
          relatoriosSalvos: [...reports.filter(item => !sameId(item.id, report.id)), report],
        }
        return list
      }
      if (parts.length === 4 && method === 'PUT') {
        list[recordIndex] = {
          ...current,
          relatoriosSalvos: reports.map(item => sameId(item.id, parts[3]) ? operation.body : item),
        }
        return list
      }
      if (parts.length === 4 && method === 'DELETE') {
        list[recordIndex] = {
          ...current,
          relatoriosSalvos: reports.filter(item => !sameId(item.id, parts[3])),
        }
        return list
      }
    }

    if (recordIndex >= 0 && parts[2] === 'relatorio' && parts[3] && method === 'PATCH') {
      const body = operation.body || {}
      const current = list[recordIndex]
      list[recordIndex] = {
        ...current,
        relatoriosSalvos: (current.relatoriosSalvos || []).map(report => {
          if (!sameId(report.id, parts[3])) return report
          return {
            ...report,
            createdAt: body.createdAt || report.createdAt,
            fotosAnomalias: body.medicoes
              ? (report.fotosAnomalias || []).map(photo => ({
                  ...photo,
                  linhas: (photo.linhas || []).map(line => {
                    const key = `${photo.id}_${line.id}`
                    return body.medicoes[key] !== undefined
                      ? { ...line, comprimentos: body.medicoes[key] }
                      : line
                  }),
                }))
              : report.fotosAnomalias,
          }
        }),
      }
      return list
    }
  }

  const id = operationId(operation)
  if (method === 'DELETE') return list.filter(item => !sameId(item.id, id))

  if (method === 'PUT' || method === 'PATCH') {
    return list.map(item => {
      if (!sameId(item.id, id)) return item
      const changes = method === 'PATCH' && operation.body?.edificacao_planta !== undefined
        ? { edificacao_planta: operation.body.edificacao_planta }
        : operation.body
      return { ...item, ...changes, id: item.id }
    })
  }
  return list
}

function applyMutationsToGeoJson(data, operations, resource) {
  const result = data?.type === 'FeatureCollection'
    ? { ...data, features: [...(data.features || [])] }
    : offlineGeoJson()

  for (const operation of operations) {
    if (resourceForPath(operation.path) !== resource) continue
    const method = operation.method.toUpperCase()
    const id = operationId(operation)
    if (method === 'DELETE') {
      result.features = result.features.filter(feature => !sameId(feature.properties?.id, id))
    } else if (method === 'POST' && isCollectionPath(operation.path, resource)) {
      const feature = createGeoFeature(resource, { ...operation.body, id: operation.optimisticId })
      if (feature && !result.features.some(item => sameId(item.properties?.id, feature.properties.id))) {
        result.features.unshift(feature)
      }
    }
  }
  return result
}

async function getCollectionSnapshot(resource, queue) {
  const cached = await readOfflineCache(RESOURCE_PATHS[resource])
  const fallback = Array.isArray(cached) ? cached : legacyCollection(resource)
  return queue.reduce((records, operation) => applyMutationToCollection(records, operation, resource), fallback || [])
}

async function getOfflineValue(path, queue) {
  const pendingOperations = await Promise.all(queue.map(async operation => ({
    ...operation,
    path: await resolveMappedPath(operation.path),
  })))
  const pathname = pathWithoutQuery(path)
  let cached = await readOfflineCache(path)
  if (cached === undefined && pathname !== path) cached = await readOfflineCache(pathname)

  const resource = resourceForPath(path)
  const monitoramentoMatch = pathname.match(/^\/monitoramento\/([^/]+)$/)
  if (resource === 'monitoramento' && monitoramentoMatch) {
    const requestedId = decodeURIComponent(monitoramentoMatch[1])
    const mappedId = await readOfflineIdMapping(requestedId)
    const listCache = await readOfflineCache(RESOURCE_PATHS.monitoramento)
    const listFallback = Array.isArray(listCache) ? listCache : legacyCollection('monitoramento') || []
    let record = cached ?? listFallback.find(item =>
      sameId(item.id, requestedId) || (mappedId != null && sameId(item.id, mappedId))
    )

    for (const operation of pendingOperations) {
      const parts = pathWithoutQuery(operation.path).split('/').filter(Boolean).map(decodeURIComponent)
      const isCreateForRecord = operation.method === 'POST' &&
        isCollectionPath(operation.path, 'monitoramento') &&
        (sameId(operation.optimisticId, requestedId) || (mappedId != null && sameId(operation.optimisticId, mappedId)))
      const isOperationForRecord = parts[0] === 'monitoramento' &&
        (sameId(parts[1], requestedId) || (mappedId != null && sameId(parts[1], mappedId)))

      if (isCreateForRecord) {
        record = applyMutationToCollection(record ? [record] : [], operation, 'monitoramento')[0]
      } else if (record && isOperationForRecord) {
        record = applyMutationToCollection([record], operation, 'monitoramento')[0]
      }
    }
    return record
  }

  if (pathname.startsWith('/geojson/')) {
    if (cached === undefined) {
      const collection = await getCollectionSnapshot(resource, pendingOperations)
      return applyMutationsToGeoJson(offlineGeoJson(), pendingOperations, resource).features.length
        ? applyMutationsToGeoJson(offlineGeoJson(), pendingOperations, resource)
        : {
            type: 'FeatureCollection',
            features: collection.map(record => createGeoFeature(resource, record)).filter(Boolean),
          }
    }
    return applyMutationsToGeoJson(cached, pendingOperations, resource)
  }

  if (resource === 'precipitacoes') {
    let value = cached
    if (value === undefined) {
      value = safeParse(localStorage.getItem(LEGACY_STORAGE_KEYS.precipitacoes), null)
    }
    for (const operation of pendingOperations) {
      if (resourceForPath(operation.path) !== 'precipitacoes') continue
      if (operation.method === 'POST') {
        value = {
          id: operation.optimisticId,
          ...operation.body,
          updated_at: operation.createdAt,
        }
      } else if (operation.method === 'DELETE') {
        value = null
      }
    }
    return value
  }

  if (resource && isCollectionPath(path, resource)) {
    const legacy = legacyCollection(resource)
    const base = Array.isArray(cached) ? cached : legacy || []
    return pendingOperations.reduce((records, operation) => applyMutationToCollection(records, operation, resource), base)
  }

  if (pathname === '/stats') {
    if (cached && !pendingOperations.length) return cached
    const counts = { ocorrencias: 0, vistorias: 0, imoveis: 0, areas_risco: 0 }
    for (const [resource, key] of Object.entries({
      ocorrencias: 'ocorrencias',
      vistorias: 'vistorias',
      imoveis: 'imoveis',
      areas_risco: 'areas-risco',
    })) {
      const collection = await getCollectionSnapshot(key, pendingOperations)
      const hasCache = Array.isArray(await readOfflineCache(RESOURCE_PATHS[key])) || legacyCollection(key)
      if (hasCache) counts[resource] = collection.length
      else if (cached) counts[resource] = cached[resource] ?? cached[resource === 'areas_risco' ? 'areasRisco' : resource] ?? 0
    }
    return counts
  }

  if (cached !== undefined) return cached
  if (resource === 'precipitacoes') {
    const legacy = safeParse(localStorage.getItem(LEGACY_STORAGE_KEYS.precipitacoes), null)
    return legacy
  }
  return undefined
}

function localId() {
  const unique = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  return `offline-${unique}`
}

function hasPendingRootCreate(path, queue) {
  const resource = resourceForPath(path)
  if (!resource) return false
  const parts = pathWithoutQuery(path).split('/').filter(Boolean).map(decodeURIComponent)
  const parentId = parts[0] === RESOURCE_PATHS[resource].slice(1) ? parts[1] : null
  if (!parentId) return false
  return queue.some(operation =>
    operation.method === 'POST' &&
    operation.optimisticId &&
    isCollectionPath(operation.path, resource) &&
    sameId(operation.optimisticId, parentId)
  )
}

function announceQueueChange(count) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('geovistorias:offline-queue-change', { detail: { count } }))
  }
}

async function notifyQueueChange() {
  const queue = await getOfflineQueue()
  announceQueueChange(queue.length)
}

async function writeCollectionMutation(operation) {
  const resource = resourceForPath(operation.path)
  if (resource === 'precipitacoes') {
    if (operation.method === 'POST') {
      await writeOfflineCache(RESOURCE_PATHS.precipitacoes, {
        id: operation.optimisticId,
        ...operation.body,
        updated_at: operation.createdAt || new Date().toISOString(),
      })
    } else if (operation.method === 'DELETE') {
      await writeOfflineCache(RESOURCE_PATHS.precipitacoes, null)
    }
    return
  }
  if (!resource) {
    return
  }

  const cacheKey = RESOURCE_PATHS[resource]
  const cached = await readOfflineCache(cacheKey)
  const base = Array.isArray(cached) ? [...cached] : legacyCollection(resource) || []
  if (resource === 'monitoramento') {
    const parts = pathWithoutQuery(operation.path).split('/').filter(Boolean)
    if (parts[0] === 'monitoramento' && parts[1]) {
      const detail = await readOfflineCache(`/monitoramento/${parts[1]}`)
      if (detail && !base.some(item => sameId(item.id, detail.id))) base.unshift(detail)
    }
  }
  await writeOfflineCache(cacheKey, applyMutationToCollection(base, operation, resource))

  if (resource === 'monitoramento') {
    const parts = pathWithoutQuery(operation.path).split('/').filter(Boolean)
    if (parts[0] === 'monitoramento' && parts[1]) {
      const id = decodeURIComponent(parts[1])
      const mappedId = await readOfflineIdMapping(id)
      const detailPaths = new Set([
        `/monitoramento/${encodeURIComponent(id)}`,
        ...(mappedId == null ? [] : [`/monitoramento/${encodeURIComponent(mappedId)}`]),
      ])
      for (const detailPath of detailPaths) {
        const detail = await readOfflineCache(detailPath)
        if (detail === undefined) continue
        const updated = applyMutationToCollection([detail], operation, resource)[0]
        await writeOfflineCache(detailPath, updated ?? null)
      }
    }
  }

  if (resource === 'ocorrencias' || resource === 'areas-risco') {
    const geoPath = `/geojson/${resource}`
    const geo = await readOfflineCache(geoPath)
    if (geo) await writeOfflineCache(geoPath, applyMutationsToGeoJson(geo, [operation], resource))
  }
}

async function replaceOptimisticId(operation, serverId) {
  if (serverId == null || !operation.optimisticId) return
  await writeOfflineIdMapping(operation.optimisticId, serverId)
  const queuedOperations = await getOfflineQueue()
  for (const queuedOperation of queuedOperations) {
    const segments = queuedOperation.path.split('/')
    const idIndex = segments.findIndex(segment => decodeURIComponent(segment) === String(operation.optimisticId))
    if (idIndex >= 0) {
      segments[idIndex] = encodeURIComponent(String(serverId))
      await updateOfflineOperation(queuedOperation.id, { path: segments.join('/') })
    }
  }
  const resource = resourceForPath(operation.path)
  if (resource && isCollectionPath(operation.path, resource)) {
    const key = RESOURCE_PATHS[resource]
    const list = await readOfflineCache(key)
    if (Array.isArray(list)) {
      await writeOfflineCache(key, list.map(item => sameId(item.id, operation.optimisticId) ? { ...item, id: serverId } : item))
    }
    if (resource === 'ocorrencias' || resource === 'areas-risco') {
      const geoPath = `/geojson/${resource}`
      const geo = await readOfflineCache(geoPath)
      if (geo?.features) {
        await writeOfflineCache(geoPath, {
          ...geo,
          features: geo.features.map(feature => sameId(feature.properties?.id, operation.optimisticId)
            ? { ...feature, properties: { ...feature.properties, id: serverId } }
            : feature),
        })
      }
    }
  } else if (resource === 'precipitacoes') {
    const data = await readOfflineCache(RESOURCE_PATHS.precipitacoes)
    if (data) await writeOfflineCache(RESOURCE_PATHS.precipitacoes, { ...data, id: serverId })
  }
}

async function queueMutation(method, path, body) {
  const resource = resourceForPath(path)
  const id = operationId({ path })
  const queue = await getOfflineQueue()

  // Mantém criação + edição como uma única operação até chegar ao servidor.
  const pendingCreate = resource && queue.find(operation =>
    operation.method === 'POST' &&
    operation.optimisticId &&
    sameId(operation.optimisticId, id) &&
    resourceForPath(operation.path) === resource
  )
  const canMergePendingCreate = pendingCreate && pendingCreate.id !== syncingOperationId
  if ((method === 'PUT' || method === 'PATCH') && canMergePendingCreate) {
    const changes = method === 'PATCH' && body?.edificacao_planta !== undefined
      ? { edificacao_planta: body.edificacao_planta }
      : body
    await updateOfflineOperation(pendingCreate.id, {
      body: { ...pendingCreate.body, ...changes },
    })
    const updated = { ...pendingCreate, body: { ...pendingCreate.body, ...changes } }
    await writeCollectionMutation(updated)
    await notifyQueueChange()
    return { ok: true, id, offline: true, queued: true }
  }

  // Excluir um item ainda não enviado cancela sua criação local.
  if (method === 'DELETE' && canMergePendingCreate) {
    await removeOfflineOperation(pendingCreate.id)
    const deletion = { method, path, body: null }
    await writeCollectionMutation(deletion)
    await notifyQueueChange()
    return { ok: true, offline: true, queued: false }
  }

  const optimisticId = method === 'POST' && resource && isCollectionPath(path, resource)
    ? localId()
    : undefined
  const operation = {
    method,
    path,
    body: body ?? null,
    optimisticId,
    createdAt: new Date().toISOString(),
  }
  await enqueueOfflineOperation(operation)
  await writeCollectionMutation(operation)
  await notifyQueueChange()

  if (method === 'POST' && resource === 'monitoramento' && pathWithoutQuery(path).endsWith('/fotos')) {
    const photo = {
      id: body?.id,
      url: body?.base64,
      codigoTrinca: body?.codigoTrinca,
      pontos: body?.pontos || [],
      linhas: body?.linhas || [],
      observacao: body?.observacao || '',
    }
    return { success: true, id: photo.id, url: photo.url, photo, offline: true, queued: true }
  }
  if (method === 'POST' && optimisticId) return { id: optimisticId, offline: true, queued: true }
  if (method === 'POST') return { ok: true, offline: true, queued: true }
  return { ok: true, id, offline: true, queued: true }
}

async function sendMutation(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const error = new Error(await response.text())
    error.status = response.status
    throw error
  }
  const result = await response.json()
  const resource = resourceForPath(path)
  const operation = {
    method,
    path,
    body: body ?? null,
    optimisticId: method === 'POST' && resource && isCollectionPath(path, resource) ? result?.id : undefined,
    result,
  }
  await writeCollectionMutation(operation)
  return result
}

async function req(method, path, body) {
  if (method !== 'GET') {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return queueMutation(method, path, body)
    }
    if (hasPendingRootCreate(path, await getOfflineQueue())) return queueMutation(method, path, body)
    try {
      return await sendMutation(method, await resolveMappedPath(path), body)
    } catch (error) {
      if (error instanceof TypeError || error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.status >= 500) {
        return queueMutation(method, path, body)
      }
      throw error
    }
  }

  const queue = await getOfflineQueue()
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new TypeError('Sem conexão')
    const detailId = pathWithoutQuery(path).match(/^\/[^/]+\/([^/]+)$/)?.[1]
    const hasPendingCreate = detailId && queue.some(operation =>
      operation.method === 'POST' &&
      operation.optimisticId &&
      isCollectionPath(operation.path, resourceForPath(path)) &&
      sameId(operation.optimisticId, decodeURIComponent(detailId))
    )
    if (hasPendingCreate) return await getOfflineValue(path, queue)

    const requestPath = await resolveMappedPath(path)
    const fetchOptions = {}
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      fetchOptions.signal = AbortSignal.timeout(8000)
    }
    const response = await fetch(`${BASE}${requestPath}`, fetchOptions)
    if (response.headers.get('X-Offline') === 'true' || response.status >= 500) {
      throw new TypeError('API indisponível')
    }
    if (!response.ok) throw new Error(await response.text())
    const data = await response.json()
    await writeOfflineCache(path, data)
    return await getOfflineValue(path, queue)
  } catch (error) {
    if (!(error instanceof TypeError) && error?.name !== 'AbortError' && error?.name !== 'TimeoutError') throw error
    const cached = await getOfflineValue(path, queue)
    if (cached !== undefined) return cached
    throw error
  }
}

export async function getPendingSyncCount() {
  return (await getOfflineQueue()).length
}

export async function syncPendingOperations() {
  if (isSyncing || (typeof navigator !== 'undefined' && !navigator.onLine)) return { synced: 0, pending: await getPendingSyncCount() }
  isSyncing = true
  let synced = 0
  try {
    while (true) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) break
      const [operation] = await getOfflineQueue()
      if (!operation) break
      syncingOperationId = operation.id
      try {
        const path = await resolveMappedPath(operation.path)
        const response = await fetch(`${BASE}${path}`, {
          method: operation.method,
          headers: operation.body ? { 'Content-Type': 'application/json' } : {},
          body: operation.body ? JSON.stringify(operation.body) : undefined,
        })
        if (!response.ok) {
          syncingOperationId = null
          break
        }
        const result = await response.json()
        await replaceOptimisticId(operation, result?.id)
        await removeOfflineOperation(operation.id)
        synced++
      } catch {
        syncingOperationId = null
        break
      }
      syncingOperationId = null
    }
  } finally {
    isSyncing = false
    syncingOperationId = null
    await notifyQueueChange()
  }
  const pending = await getPendingSyncCount()
  if (synced > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('geovistorias:offline-data-synced', { detail: { synced, pending } }))
  }
  return { synced, pending }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { syncPendingOperations() })
  syncPendingOperations()
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

  // Monitoramento — todas as mutações usam a mesma fila offline dos demais cadastros.
  getMonitoramentos: () => req('GET', '/monitoramento'),
  getMonitoramento: (id) => req('GET', `/monitoramento/${encodeURIComponent(id)}`),
  createMonitoramento: (data) => req('POST', '/monitoramento', data),
  updateMonitoramento: (id, data) => req('PUT', `/monitoramento/${encodeURIComponent(id)}`, data),
  deleteMonitoramento: (id) => req('DELETE', `/monitoramento/${encodeURIComponent(id)}`),
  addMonitoramentoFoto: (id, base64, codigoTrinca) => {
    const photoId = `foto-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`
    return req('POST', `/monitoramento/${encodeURIComponent(id)}/fotos`, {
      id: photoId,
      base64,
      codigoTrinca,
    })
  },
  createMonitoramentoRelatorio: (id, data) => req('POST', `/monitoramento/${encodeURIComponent(id)}/relatorios`, data),
  updateMonitoramentoRelatorio: (id, reportId, data) => req('PUT', `/monitoramento/${encodeURIComponent(id)}/relatorios/${encodeURIComponent(reportId)}`, data),
  patchMonitoramentoRelatorio: (id, reportId, data) => req('PATCH', `/monitoramento/${encodeURIComponent(id)}/relatorio/${encodeURIComponent(reportId)}`, data),
  deleteMonitoramentoRelatorio: (id, reportId) => req('DELETE', `/monitoramento/${encodeURIComponent(id)}/relatorios/${encodeURIComponent(reportId)}`),
}
