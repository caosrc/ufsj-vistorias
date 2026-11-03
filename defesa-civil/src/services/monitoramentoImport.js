const PROPERTY_FIELDS = [
  'proprietario',
  'cidade',
  'endereco',
  'celular',
  'latitude',
  'longitude',
  'nome',
  'areaTerrenho',
  'verticesCasa',
  'alturaCasa',
  'trincasCasa',
  'edificacaoPlanta',
]

const normalize = value => String(value || '').trim().toLocaleLowerCase('pt-BR')
const sameId = (left, right) => String(left) === String(right)

function findExistingProperty(imported, existingProperties) {
  if (imported.sourceId) {
    const byId = existingProperties.find(property => sameId(property.id, imported.sourceId))
    if (byId) {
      const sameOwner = !imported.data.proprietario ||
        normalize(byId.proprietario) === normalize(imported.data.proprietario)
      const sameAddress = !imported.data.endereco ||
        normalize(byId.endereco) === normalize(imported.data.endereco)
      if (sameOwner && sameAddress) return byId
    }
  }

  const owner = normalize(imported.data.proprietario)
  const address = normalize(imported.data.endereco)
  const matches = existingProperties.filter(property =>
    normalize(property.proprietario) === owner &&
    (address ? normalize(property.endereco) === address : true)
  )
  return matches.length === 1 ? matches[0] : null
}

function apiPayload(property) {
  return Object.fromEntries(PROPERTY_FIELDS.map(key => [key, property[key] ?? null]))
}

function mergePhotos(existingPhotos = [], importedPhotos = []) {
  const merged = [...existingPhotos]
  for (const photo of importedPhotos) {
    const index = merged.findIndex(item =>
      photo.id != null && item.id != null && sameId(item.id, photo.id)
    )
    if (index < 0) {
      merged.push(photo)
      continue
    }
    const existing = merged[index]
    merged[index] = {
      ...existing,
      ...photo,
      url: photo.url || existing.url || '',
    }
  }
  return merged
}

function indexBySource(records) {
  const map = new Map()
  for (const record of records) {
    if (!map.has(record.sourceKey)) map.set(record.sourceKey, [])
    map.get(record.sourceKey).push(record)
  }
  return map
}

function makeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

export async function importMonitoramentosWorkbook(data, existingProperties, api, onProgress = () => {}) {
  const targets = new Map()
  const errors = []
  let created = 0
  let updated = 0
  let importedPhotoCount = 0
  let importedReportCount = 0
  let queuedOffline = false

  for (let index = 0; index < data.properties.length; index++) {
    const imported = data.properties[index]
    onProgress(`Salvando imóvel ${index + 1} de ${data.properties.length}…`)
    try {
      const existing = findExistingProperty(imported, existingProperties)
      const merged = { ...(existing || {}), ...imported.data }
      const response = existing
        ? await api.updateMonitoramento(existing.id, apiPayload(merged))
        : await api.createMonitoramento(apiPayload(merged))
      queuedOffline ||= Boolean(response?.offline)
      const targetId = response?.id ?? existing?.id
      if (targetId == null) throw new Error('A API não retornou o ID do imóvel salvo.')

      const target = {
        id: targetId,
        record: {
          ...merged,
          id: targetId,
          fotosAnomalias: existing?.fotosAnomalias || [],
          relatoriosSalvos: existing?.relatoriosSalvos || [],
        },
      }
      targets.set(imported.sourceKey, target)
      if (existing) updated++
      else created++
    } catch (error) {
      errors.push(`Imóvel ${imported.data.proprietario}: ${makeErrorMessage(error)}`)
    }
  }

  const photosBySource = indexBySource(data.photos)
  const reportsBySource = indexBySource(data.reports)
  let processedPhotos = 0
  const totalPhotoRows = data.photos.length

  for (const [sourceKey, entries] of photosBySource) {
    const target = targets.get(sourceKey)
    if (!target) {
      errors.push(`Fotos do imóvel ${sourceKey}: o cadastro correspondente não foi importado.`)
      continue
    }

    const propertyPhotos = entries.filter(entry =>
      !entry.origem.toLocaleLowerCase('pt-BR').includes('relat')
    )
    for (const entry of propertyPhotos) {
      processedPhotos++
      onProgress(`Importando fotos e medidas ${processedPhotos} de ${totalPhotoRows}…`)
      const previous = target.record.fotosAnomalias.find(item =>
        entry.photo.id != null && item.id != null && sameId(item.id, entry.photo.id)
      )
      const photo = {
        ...previous,
        ...entry.photo,
        url: entry.photo.url || previous?.url || '',
      }
      if (!photo.url && !photo.pontos?.length && !photo.linhas?.length) {
        errors.push(`Foto ${photo.id || ''} do imóvel ${target.record.proprietario}: sem imagem ou medidas.`)
        continue
      }
      try {
        const response = await api.addMonitoramentoFoto(
          target.id,
          photo.url,
          photo.codigoTrinca,
          photo
        )
        queuedOffline ||= Boolean(response?.offline)
        const savedPhoto = response?.photo || photo
        target.record.fotosAnomalias = mergePhotos(target.record.fotosAnomalias, [savedPhoto])
        importedPhotoCount++
      } catch (error) {
        errors.push(`Foto ${photo.id || ''} do imóvel ${target.record.proprietario}: ${makeErrorMessage(error)}`)
      }
    }
  }

  const reportEntries = []
  for (const entries of reportsBySource.values()) reportEntries.push(...entries)
  for (const entries of photosBySource.values()) {
    for (const entry of entries) {
      const isReportPhoto = entry.origem.toLocaleLowerCase('pt-BR').includes('relat')
      if (!isReportPhoto) continue
      if (!entry.reportId) {
        errors.push(`Foto de relatório do imóvel ${target.record.proprietario}: informe o ID do relatório.`)
        continue
      }
      if (!reportEntries.some(item =>
        item.sourceKey === entry.sourceKey && sameId(item.report.id, entry.reportId)
      )) {
        reportEntries.push({
          sourceKey: entry.sourceKey,
          report: {
            id: entry.reportId,
            nome: 'Relatório importado',
            createdAt: new Date().toISOString(),
            metodo: 1,
          },
        })
      }
    }
  }

  const reportsPhotos = new Map()
  for (const [sourceKey, entries] of photosBySource) {
    for (const entry of entries) {
      if (!entry.reportId || !entry.origem.toLocaleLowerCase('pt-BR').includes('relat')) continue
      const key = `${sourceKey}\u0000${entry.reportId}`
      if (!reportsPhotos.has(key)) reportsPhotos.set(key, [])
      reportsPhotos.get(key).push(entry.photo)
    }
  }

  for (let index = 0; index < reportEntries.length; index++) {
    const entry = reportEntries[index]
    const target = targets.get(entry.sourceKey)
    if (!target) {
      errors.push(`Relatório ${entry.report.id}: o imóvel correspondente não foi importado.`)
      continue
    }
    onProgress(`Salvando relatório ${index + 1} de ${reportEntries.length}…`)
    const currentReport = target.record.relatoriosSalvos.find(item =>
      sameId(item.id, entry.report.id)
    )
    const importedPhotos = reportsPhotos.get(`${entry.sourceKey}\u0000${entry.report.id}`) || []
    const report = {
      ...(currentReport || {}),
      ...entry.report,
      id: entry.report.id,
      fotosAnomalias: mergePhotos(currentReport?.fotosAnomalias || [], importedPhotos),
    }
    try {
      if (currentReport) {
        const response = await api.updateMonitoramentoRelatorio(target.id, report.id, report)
        queuedOffline ||= Boolean(response?.offline)
        target.record.relatoriosSalvos = target.record.relatoriosSalvos.map(item =>
          sameId(item.id, report.id) ? report : item
        )
      } else {
        const response = await api.createMonitoramentoRelatorio(target.id, report)
        queuedOffline ||= Boolean(response?.offline)
        target.record.relatoriosSalvos = [...target.record.relatoriosSalvos, report]
      }
      importedReportCount++
      importedPhotoCount += importedPhotos.length
    } catch (error) {
      errors.push(`Relatório ${report.nome || report.id}: ${makeErrorMessage(error)}`)
    }
  }

  return {
    created,
    updated,
    photos: importedPhotoCount,
    reports: importedReportCount,
    offline: queuedOffline,
    errors,
  }
}
