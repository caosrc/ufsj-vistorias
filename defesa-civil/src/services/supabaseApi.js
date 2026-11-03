import { supabase } from '../operacional/supabaseClient'
import {
  deleteEntityMedia,
  resolveMediaList,
  resolveMediaUrl,
  saveMediaList,
  storagePathFromUrl,
  uploadDataUrl,
} from './supabaseStorage'

const valueOrJson = (value, fallback = null) => {
  if (value == null || value === '') return fallback
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

function unwrap(result) {
  if (result.error) throw new Error(result.error.message || 'Falha ao acessar o Supabase.')
  return result.data
}

function segments(path) {
  return path.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent)
}

function supabaseError(error) {
  if (error) throw new Error(error.message || 'Falha ao acessar o Supabase.')
}

async function storeImages(values, entidade, entidadeId, campo = 'fotos') {
  return saveMediaList(values, { entidade, entidadeId: String(entidadeId), campo })
}

async function signedImages(values) {
  return resolveMediaList(Array.isArray(values) ? values : [])
}

function jsonColumn(value, fallback = null) {
  if (value == null || value === '') return fallback
  return valueOrJson(value, fallback)
}

function vistoriaPayload(input = {}) {
  return {
    nome: input.nome,
    cpf: input.cpf ?? null,
    telefone: input.telefone ?? null,
    endereco: input.endereco ?? null,
    solo: input.solo ?? null,
    tipo_uso: input.tipo_uso ?? null,
    risco: input.risco ?? null,
    patologias: jsonColumn(input.patologias, []),
    observacao: input.observacao ?? null,
    cidade: input.cidade ?? null,
    cond_encosta: input.condEncosta ?? input.cond_encosta ?? null,
    tipo_talude: input.tipoTalude ?? input.tipo_talude ?? null,
    processos: jsonColumn(input.processos, []),
    moradores: input.moradores === '' || input.moradores == null ? null : Number(input.moradores),
    angulo_encosta: input.anguloEncosta === '' || input.anguloEncosta == null
      ? (input.angulo_encosta ?? null)
      : Number(input.anguloEncosta),
    caract_encosta: jsonColumn(input.caractsEncosta ?? input.caract_encosta, []),
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    area_m2: input.area_m2 ?? null,
    area_vertices: jsonColumn(input.area_vertices),
    construcoes: jsonColumn(input.construcoes),
    altura_imovel: input.alturaImovel ?? input.altura_imovel ?? null,
    edificacao_planta: jsonColumn(input.edificacao_planta),
    edificacao_vertices: jsonColumn(input.edificacao_vertices),
    fotos: Array.isArray(input.fotos) ? input.fotos : [],
  }
}

function mapVistoria(row) {
  return {
    ...row,
    patologias: jsonColumn(row.patologias, []),
    processos: jsonColumn(row.processos, []),
    caract_encosta: jsonColumn(row.caract_encosta, []),
    condEncosta: row.cond_encosta,
    tipoTalude: row.tipo_talude,
    anguloEncosta: row.angulo_encosta,
    caractsEncosta: jsonColumn(row.caract_encosta, []),
    construcoes: jsonColumn(row.construcoes, []),
    alturaImovel: row.altura_imovel,
  }
}

function validarPoligono(geojson) {
  let geometry = geojson
  if (geometry?.type === 'Feature') geometry = geometry.geometry
  const ring = geometry?.type === 'Polygon' ? geometry.coordinates?.[0] : null
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new Error('Desenhe um polígono válido com pelo menos três pontos.')
  }
  const points = ring.map((point) => [Number(point?.[0]), Number(point?.[1])])
  if (points.some(([lng, lat]) =>
    !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    !Number.isFinite(lat) || lat < -90 || lat > 90
  )) throw new Error('A localização da área de risco é inválida.')
  const first = points[0]
  const last = points[points.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first])
  return { type: 'Polygon', coordinates: [points] }
}

function centroid(geometry) {
  const ring = geometry.coordinates[0].slice(0, -1)
  const sum = ring.reduce((result, [lng, lat]) => ({
    lat: result.lat + lat,
    lng: result.lng + lng,
  }), { lat: 0, lng: 0 })
  return { latitude: sum.lat / ring.length, longitude: sum.lng / ring.length }
}

function areaPayload(input = {}) {
  const geometry = validarPoligono(input.geojson)
  if (!['R1', 'R2', 'R3', 'R4'].includes(input.nivel)) throw new Error('Selecione um nível de risco válido.')
  const tipos = new Set(['Encostas', 'Erosões', 'Drenagem', 'Alagamentos', 'Deslizamentos', 'Problemas de vias', 'Obras', 'Interdições'])
  if (!tipos.has(input.tipo)) throw new Error('Selecione um tipo de área de risco válido.')
  if (!['ouro_branco', 'congonhas'].includes(input.cidade)) throw new Error('Selecione Congonhas ou Ouro Branco.')
  const limite = input.tipo === 'Interdições' ? 0 : Number(input.limite_precipitacao_mm)
  if (!Number.isFinite(limite) || limite < 0 || limite > 10000) throw new Error('Informe um limite de chuva válido, em milímetros.')
  const center = centroid(geometry)
  const latitude = input.latitude == null ? center.latitude : Number(input.latitude)
  const longitude = input.longitude == null ? center.longitude : Number(input.longitude)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('A localização da área de risco é inválida.')
  }
  return {
    nivel: input.nivel,
    tipo: input.tipo,
    descricao: input.descricao?.trim() || null,
    cidade: input.cidade,
    latitude,
    longitude,
    data_inicio: input.data_inicio || new Date().toISOString().slice(0, 10),
    limite_precipitacao_mm: limite,
    referencia: input.referencia?.trim() || null,
    observacao: input.observacao?.trim() || null,
    geojson: geometry,
  }
}

async function getOcorrencias() {
  const rows = unwrap(await supabase.from('ocorrencias').select('*').order('created_at', { ascending: false }).limit(1000)) || []
  return Promise.all(rows.map(async (row) => ({
    ...row,
    fotos: await signedImages(row.fotos),
    vistorias: jsonColumn(row.vistorias, []),
  })))
}

async function saveOcorrencia(body) {
  const payload = { ...body, fotos: [], vistorias: jsonColumn(body.vistorias, []) }
  const inserted = unwrap(await supabase.from('ocorrencias').insert(payload).select('id').single())
  const paths = await storeImages(body.fotos || [], 'ocorrencias', inserted.id)
  if (paths.length) {
    const { error } = await supabase.from('ocorrencias').update({ fotos: paths }).eq('id', inserted.id)
    supabaseError(error)
  }
  return { id: inserted.id }
}

async function updateOcorrencia(id, body) {
  const patch = { ...body }
  if (Array.isArray(body.fotos)) patch.fotos = await storeImages(body.fotos, 'ocorrencias', id)
  if (body.vistorias !== undefined) patch.vistorias = jsonColumn(body.vistorias, [])
  const updated = unwrap(await supabase.from('ocorrencias').update(patch).eq('id', id).select('id,fotos').maybeSingle())
  if (!updated) throw new Error('Ocorrência não encontrada.')
  return { ...patch, id: updated.id, fotos: Array.isArray(updated.fotos) ? await signedImages(updated.fotos) : undefined }
}

async function monitoramentoRows(id = null) {
  let query = supabase.from('vistoria_monitoramento').select('*').order('created_at', { ascending: false })
  if (id != null) query = query.eq('id', id)
  const rows = unwrap(await query)
  if (!rows?.length) return id == null ? [] : null

  const ids = rows.map((row) => row.id)
  const [photoRows, reportRows] = await Promise.all([
    supabase.from('monitoramento_fotos').select('*').in('monitoramento_id', ids),
    supabase.from('monitoramento_relatorios').select('*').in('monitoramento_id', ids).order('created_at', { ascending: false }),
  ])
  supabaseError(photoRows.error)
  supabaseError(reportRows.error)

  const photosByMonitor = new Map()
  for (const photo of photoRows.data || []) {
    const key = String(photo.monitoramento_id)
    const list = photosByMonitor.get(key) || []
    list.push(photo)
    photosByMonitor.set(key, list)
  }
  const reportsByMonitor = new Map()
  for (const report of reportRows.data || []) {
    const key = String(report.monitoramento_id)
    const list = reportsByMonitor.get(key) || []
    list.push(report)
    reportsByMonitor.set(key, list)
  }

  const mapped = await Promise.all(rows.map(async (row) => {
    const idKey = String(row.id)
    const media = photosByMonitor.get(idKey) || []
    const rootPhotos = await Promise.all(media.filter((item) => !item.relatorio_id).map(async (item) => ({
      ...(item.dados || {}),
      id: item.id,
      url: await resolveMediaUrl(item.storage_path),
    })))
    const reports = await Promise.all((reportsByMonitor.get(idKey) || []).map(async (reportRow) => {
      const report = jsonColumn(reportRow.dados, {})
      const reportPhotos = await Promise.all(media
        .filter((item) => String(item.relatorio_id || '') === String(reportRow.id))
        .map(async (item) => ({
          ...(item.dados || {}),
          id: item.id,
          url: await resolveMediaUrl(item.storage_path),
        })))
      return { ...report, id: report.id || reportRow.id, fotosAnomalias: reportPhotos }
    }))
    return {
      id: row.id,
      createdAt: row.created_at,
      proprietario: row.proprietario,
      cidade: row.cidade,
      endereco: row.endereco,
      celular: row.celular,
      latitude: row.latitude,
      longitude: row.longitude,
      nome: row.nome,
      fotosAnomalias: rootPhotos,
      relatoriosSalvos: reports,
      areaTerrenho: jsonColumn(row.area_terreno, []),
      verticesCasa: jsonColumn(row.vertices_casa, []),
      alturaCasa: row.altura_casa || null,
      trincasCasa: jsonColumn(row.trincas_casa, []),
      edificacaoPlanta: jsonColumn(row.edificacao_planta, null),
    }
  }))
  return id == null ? mapped : mapped[0]
}

function monitoramentoPayload(input = {}) {
  return {
    proprietario: input.proprietario,
    cidade: input.cidade || null,
    endereco: input.endereco || null,
    celular: input.celular || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    nome: input.nome || input.proprietario,
    area_terreno: jsonColumn(input.areaTerrenho ?? input.areaTerreno),
    vertices_casa: jsonColumn(input.verticesCasa),
    altura_casa: input.alturaCasa ? Number.parseFloat(input.alturaCasa) : null,
    trincas_casa: jsonColumn(input.trincasCasa, []),
    edificacao_planta: jsonColumn(input.edificacaoPlanta),
  }
}

async function saveMonitoramentoPhoto(id, body) {
  const photoId = String(body.id || `foto-${globalThis.crypto?.randomUUID?.() || Date.now()}`)
  const { data: previous, error: previousError } = await supabase
    .from('monitoramento_fotos')
    .select('storage_path')
    .eq('monitoramento_id', id)
    .eq('id', photoId)
    .maybeSingle()
  supabaseError(previousError)
  const storage = body.base64
    ? await uploadDataUrl(body.base64, {
        entidade: 'monitoramento',
        entidadeId: String(id),
        campo: 'vistoria',
        metadata: { photoId },
      })
    : previous?.storage_path ? `storage://${previous.storage_path}` : null
  const path = storagePathFromUrl(storage)
  const dados = {
    codigoTrinca: body.codigoTrinca || '',
    pontos: Array.isArray(body.pontos) ? body.pontos : [],
    linhas: Array.isArray(body.linhas) ? body.linhas : [],
    observacao: body.observacao || '',
  }
  const saved = unwrap(await supabase.from('monitoramento_fotos').upsert({
    id: photoId,
    monitoramento_id: id,
    relatorio_id: null,
    storage_path: path,
    dados,
  }, { onConflict: 'monitoramento_id,id' }).select().single())
  if (previous?.storage_path && previous.storage_path !== path) {
    await removeMediaPath(previous.storage_path)
  }
  const url = await resolveMediaUrl(saved.storage_path)
  const photo = { ...saved.dados, id: saved.id, url }
  return { success: true, id: saved.id, url, photo }
}

async function removeMediaPath(path) {
  if (!path) return
  await supabase.storage.from('defesa-civil-private').remove([path])
  await supabase.from('arquivos_app').delete().eq('storage_path', path)
}

async function saveReport(id, input) {
  const reportId = String(input.id || globalThis.crypto?.randomUUID?.() || `rel-${Date.now()}`)
  const originalPhotos = Array.isArray(input.fotosAnomalias) ? input.fotosAnomalias : []
  const { data: previousRows, error: previousError } = await supabase
    .from('monitoramento_fotos')
    .select('id,storage_path')
    .eq('monitoramento_id', id)
    .eq('relatorio_id', reportId)
  supabaseError(previousError)

  const reportPhotos = []
  const mediaRows = []
  for (const [index, photo] of originalPhotos.entries()) {
    const photoId = String(photo.id || `${reportId}-foto-${index + 1}`)
    const storage = photo.url
      ? await uploadDataUrl(photo.url, {
          entidade: 'monitoramento',
          entidadeId: String(id),
          campo: `relatorio-${reportId}`,
          metadata: { reportId, photoId },
        })
      : photo.storage_path ? `storage://${photo.storage_path}` : null
    const path = storagePathFromUrl(storage)
    const { url, ...dadosFoto } = photo
    void url
    reportPhotos.push({ ...dadosFoto, id: photoId })
    mediaRows.push({
      id: photoId,
      monitoramento_id: id,
      relatorio_id: reportId,
      storage_path: path,
      dados: dadosFoto,
    })
  }

  const report = { ...input, id: reportId, fotosAnomalias: reportPhotos }
  unwrap(await supabase.from('monitoramento_relatorios').upsert({
    id: reportId,
    monitoramento_id: id,
    dados: report,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'monitoramento_id,id' }).select('id').single())

  if (mediaRows.length) {
    unwrap(await supabase.from('monitoramento_fotos').upsert(mediaRows, { onConflict: 'monitoramento_id,id' }))
  }
  const keepIds = new Set(mediaRows.map((item) => item.id))
  const removed = (previousRows || []).filter((item) => !keepIds.has(item.id))
  if (removed.length) {
    const { error } = await supabase.from('monitoramento_fotos')
      .delete()
      .eq('monitoramento_id', id)
      .eq('relatorio_id', reportId)
      .in('id', removed.map((item) => item.id))
    supabaseError(error)
    await Promise.all(removed.map((item) => removeMediaPath(item.storage_path)))
  }
  return report
}

async function supabaseRequest(method, path, body) {
  const parts = segments(path)
  const root = parts[0]
  const id = parts[1]
  const sub = parts[2]
  const subId = parts[3]

  if (root === 'ocorrencias') {
    if (parts.length === 1 && method === 'GET') return getOcorrencias()
    if (parts.length === 1 && method === 'POST') return saveOcorrencia(body || {})
    if (parts.length === 2 && method === 'DELETE') {
      await deleteEntityMedia('ocorrencias', id)
      supabaseError((await supabase.from('ocorrencias').delete().eq('id', id)).error)
      return { ok: true }
    }
    if (parts.length === 2 && ['PUT', 'PATCH'].includes(method)) return updateOcorrencia(id, body || {})
  }

  if (root === 'vistorias') {
    if (parts.length === 1 && method === 'GET') {
      const rows = unwrap(await supabase.from('vistorias').select('*').order('data', { ascending: false }).limit(1000)) || []
      return Promise.all(rows.map(async (row) => ({
        ...mapVistoria(row),
        fotos: await signedImages(row.fotos),
      })))
    }
    if (parts.length === 1 && method === 'POST') {
      const input = body || {}
      const payload = vistoriaPayload(input)
      payload.fotos = []
      const row = unwrap(await supabase.from('vistorias').insert(payload).select('id').single())
      const fotos = await storeImages(input.fotos || [], 'vistorias', row.id)
      if (fotos.length) supabaseError((await supabase.from('vistorias').update({ fotos }).eq('id', row.id)).error)
      return { id: row.id }
    }
    if (parts.length === 2 && method === 'PUT') {
      const payload = vistoriaPayload(body || {})
      if (Array.isArray(body?.fotos)) payload.fotos = await storeImages(body.fotos, 'vistorias', id)
      const row = unwrap(await supabase.from('vistorias').update(payload).eq('id', id).select('id').maybeSingle())
      if (!row) throw new Error('Vistoria não encontrada.')
      return { ok: true }
    }
    if (parts.length === 3 && sub === 'edificacao' && method === 'PATCH') {
      supabaseError((await supabase.from('vistorias').update({
        edificacao_planta: jsonColumn(body?.edificacao_planta),
      }).eq('id', id)).error)
      return { ok: true }
    }
    if (parts.length === 2 && method === 'DELETE') {
      await deleteEntityMedia('vistorias', id)
      supabaseError((await supabase.from('vistorias').delete().eq('id', id)).error)
      return { ok: true }
    }
  }

  if (root === 'imoveis') {
    if (parts.length === 1 && method === 'GET') {
      return unwrap(await supabase.from('imoveis').select('*').order('criado_em', { ascending: false }).limit(1000)) || []
    }
    if (parts.length === 1 && method === 'POST') {
      const row = unwrap(await supabase.from('imoveis').insert(body || {}).select('id').single())
      return { id: row.id }
    }
    if (parts.length === 2 && method === 'DELETE') {
      supabaseError((await supabase.from('imoveis').delete().eq('id', id)).error)
      return { ok: true }
    }
  }

  if (root === 'areas-risco') {
    if (parts.length === 1 && method === 'GET') {
      const rows = unwrap(await supabase.from('areas_risco').select('*').order('criado_em', { ascending: false }).limit(1000)) || []
      return rows.map((row) => ({ ...row, geojson: jsonColumn(row.geojson) }))
    }
    if (parts.length === 1 && method === 'POST') {
      const row = unwrap(await supabase.from('areas_risco').insert(areaPayload(body || {})).select('id').single())
      return { id: row.id }
    }
    if (parts.length === 2 && method === 'PUT') {
      const row = unwrap(await supabase.from('areas_risco').update(areaPayload(body || {})).eq('id', id).select('id').maybeSingle())
      if (!row) throw new Error('Área de risco não encontrada.')
      return { id: row.id }
    }
    if (parts.length === 2 && method === 'DELETE') {
      supabaseError((await supabase.from('areas_risco').delete().eq('id', id)).error)
      return { ok: true }
    }
  }

  if (root === 'geojson' && parts.length === 2 && method === 'GET') {
    if (id === 'ocorrencias') {
      const rows = unwrap(await supabase.from('ocorrencias').select('id,tipo,nivel,descricao,data,created_at,lat,lng').not('lat', 'is', null).not('lng', 'is', null)) || []
      return {
        type: 'FeatureCollection',
        features: rows.map((row) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
          properties: { id: row.id, tipo: row.tipo, nivel: row.nivel, descricao: row.descricao, data: row.data || row.created_at },
        })),
      }
    }
    if (id === 'areas-risco') {
      const rows = unwrap(await supabase.from('areas_risco').select('*').not('geojson', 'is', null)) || []
      return {
        type: 'FeatureCollection',
        features: rows.map((row) => ({
          type: 'Feature',
          geometry: jsonColumn(row.geojson),
          properties: {
            id: row.id, nivel: row.nivel, tipo: row.tipo, cidade: row.cidade,
            latitude: row.latitude, longitude: row.longitude, data_inicio: row.data_inicio,
            limite_precipitacao_mm: row.limite_precipitacao_mm, referencia: row.referencia,
            observacao: row.observacao, descricao: row.descricao,
          },
        })),
      }
    }
  }

  if (root === 'stats' && method === 'GET') {
    const names = ['ocorrencias', 'vistorias', 'imoveis', 'areas_risco']
    const counts = await Promise.all(names.map(async (table) => {
      const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true })
      supabaseError(error)
      return count || 0
    }))
    return { ocorrencias: counts[0], vistorias: counts[1], imoveis: counts[2], areas_risco: counts[3] }
  }

  if (root === 'precipitacoes') {
    if (method === 'GET') {
      return unwrap(await supabase.from('precipitacoes').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle())
    }
    if (method === 'POST') {
      supabaseError((await supabase.from('precipitacoes').delete().neq('id', 0)).error)
      return { id: unwrap(await supabase.from('precipitacoes').insert({
        filename: body?.filename ?? null,
        dados: jsonColumn(body?.dados, []),
        updated_at: new Date().toISOString(),
      }).select('id').single()).id }
    }
    if (method === 'DELETE') {
      supabaseError((await supabase.from('precipitacoes').delete().neq('id', 0)).error)
      return { ok: true }
    }
  }

  if (root === 'monitoramento') {
    if (parts.length === 1 && method === 'GET') return monitoramentoRows()
    if (parts.length === 1 && method === 'POST') {
      if (!body?.proprietario) throw new Error('proprietario obrigatório')
      const newId = `imovel_${Date.now()}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 9)}`
      unwrap(await supabase.from('vistoria_monitoramento').insert({ id: newId, ...monitoramentoPayload(body) }).select('id').single())
      return monitoramentoRows(newId)
    }
    if (parts.length === 2 && method === 'GET') return monitoramentoRows(id)
    if (parts.length === 2 && method === 'PUT') {
      const updated = unwrap(await supabase.from('vistoria_monitoramento').update({
        ...monitoramentoPayload(body),
        updated_at: new Date().toISOString(),
      }).eq('id', id).select('id').maybeSingle())
      if (!updated) throw new Error('Imóvel não encontrado.')
      return monitoramentoRows(id)
    }
    if (parts.length === 2 && method === 'DELETE') {
      await deleteEntityMedia('monitoramento', id)
      supabaseError((await supabase.from('vistoria_monitoramento').delete().eq('id', id)).error)
      return { ok: true }
    }
    if (parts.length === 3 && sub === 'fotos' && method === 'POST') return saveMonitoramentoPhoto(id, body || {})
    if (parts.length === 3 && sub === 'relatorios' && method === 'POST') {
      await saveReport(id, body || {})
      return { ok: true }
    }
    if (parts.length === 4 && sub === 'relatorios' && method === 'PUT') {
      await saveReport(id, { ...(body || {}), id: subId })
      return { ok: true }
    }
    if (parts.length === 4 && sub === 'relatorios' && method === 'DELETE') {
      const { data: photos, error: photoError } = await supabase.from('monitoramento_fotos')
        .select('storage_path')
        .eq('monitoramento_id', id)
        .eq('relatorio_id', subId)
      supabaseError(photoError)
      supabaseError((await supabase.from('monitoramento_relatorios').delete().eq('monitoramento_id', id).eq('id', subId)).error)
      await Promise.all((photos || []).map((photo) => removeMediaPath(photo.storage_path)))
      return { ok: true }
    }
    if (parts.length === 4 && sub === 'relatorio' && method === 'PATCH') {
      const { data: row, error } = await supabase.from('monitoramento_relatorios')
        .select('dados')
        .eq('monitoramento_id', id)
        .eq('id', subId)
        .maybeSingle()
      supabaseError(error)
      if (!row) throw new Error('Relatório não encontrado.')
      const report = jsonColumn(row.dados, {})
      if (body?.createdAt) report.createdAt = body.createdAt
      if (body?.medicoes && Array.isArray(report.fotosAnomalias)) {
        report.fotosAnomalias = report.fotosAnomalias.map((photo) => ({
          ...photo,
          linhas: (photo.linhas || []).map((line) => {
            const key = `${photo.id}_${line.id}`
            return body.medicoes[key] !== undefined ? { ...line, comprimentos: body.medicoes[key] } : line
          }),
        }))
      }
      await saveReport(id, report)
      return { ok: true, relatorio: report }
    }
  }

  throw new Error(`Operação Supabase não implementada: ${method} /${parts.join('/')}`)
}

export { supabaseRequest }
