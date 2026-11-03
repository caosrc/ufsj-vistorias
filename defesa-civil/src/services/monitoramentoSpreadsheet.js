const PROPERTY_COLUMNS = [
  { header: 'ID', key: 'id', width: 28 },
  { header: 'Data de cadastro', key: 'createdAt', width: 22 },
  { header: 'Proprietário', key: 'proprietario', width: 28 },
  { header: 'Cidade', key: 'cidade', width: 20 },
  { header: 'Endereço', key: 'endereco', width: 34 },
  { header: 'Celular', key: 'celular', width: 18 },
  { header: 'Latitude', key: 'latitude', width: 16 },
  { header: 'Longitude', key: 'longitude', width: 16 },
  { header: 'Nome', key: 'nome', width: 28 },
  { header: 'Área do terreno (JSON)', key: 'areaTerrenho', width: 36 },
  { header: 'Vértices da casa (JSON)', key: 'verticesCasa', width: 36 },
  { header: 'Altura da casa', key: 'alturaCasa', width: 16 },
  { header: 'Trincas da casa (JSON)', key: 'trincasCasa', width: 36 },
  { header: 'Planta da edificação (JSON)', key: 'edificacaoPlanta', width: 36 },
  { header: 'Dados adicionais (JSON)', key: 'extraData', width: 42 },
]

const REPORT_COLUMNS = [
  { header: 'ID do imóvel', key: 'propertyId', width: 28 },
  { header: 'Proprietário', key: 'proprietario', width: 28 },
  { header: 'Endereço', key: 'endereco', width: 34 },
  { header: 'ID do relatório', key: 'reportId', width: 26 },
  { header: 'Relatório', key: 'nome', width: 32 },
  { header: 'Data de criação', key: 'createdAt', width: 22 },
  { header: 'Data de atualização', key: 'updatedAt', width: 22 },
  { header: 'Método', key: 'metodo', width: 12 },
  { header: 'Dados completos (JSON)', key: 'extraData', width: 48 },
]

const PHOTO_COLUMNS = [
  { header: 'ID do imóvel', key: 'propertyId', width: 28 },
  { header: 'Proprietário', key: 'proprietario', width: 28 },
  { header: 'Endereço', key: 'endereco', width: 34 },
  { header: 'Origem', key: 'origem', width: 18 },
  { header: 'ID do relatório', key: 'reportId', width: 26 },
  { header: 'ID da foto', key: 'photoId', width: 26 },
  { header: 'Código do ponto', key: 'codigoTrinca', width: 18 },
  { header: 'Observação', key: 'observacao', width: 34 },
  { header: 'Pontos (JSON)', key: 'pontos', width: 38 },
  { header: 'Linhas e medidas (JSON)', key: 'linhas', width: 42 },
  { header: 'Dados adicionais (JSON)', key: 'extraData', width: 42 },
  { header: 'Foto incorporada', key: 'image', width: 24 },
  { header: 'URL da imagem', key: 'imageUrl', width: 42 },
]

const KNOWN_PROPERTY_KEYS = [
  'id', 'createdAt', 'proprietario', 'cidade', 'endereco', 'celular',
  'latitude', 'longitude', 'nome', 'areaTerrenho', 'verticesCasa',
  'alturaCasa', 'trincasCasa', 'edificacaoPlanta', 'fotosAnomalias',
  'relatoriosSalvos',
]

const KNOWN_REPORT_KEYS = [
  'id', 'nome', 'createdAt', 'updatedAt', 'metodo', 'fotosAnomalias',
]

const KNOWN_PHOTO_KEYS = [
  'id', 'url', 'base64', 'codigoTrinca', 'observacao', 'pontos', 'linhas',
]

const asArray = value => Array.isArray(value) ? value : []
const jsonCell = value => value == null || value === '' ? '' : JSON.stringify(value)

function serializableCell(value) {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'object' ? JSON.stringify(value) : value
}

function extraData(value, knownKeys) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([key]) => !knownKeys.includes(key))
  )
}

function formatSheet(sheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  }
  sheet.getRow(1).height = 30
  sheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF174C3C' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.eachCell(cell => {
        cell.alignment = { vertical: 'top', wrapText: true }
      })
    }
  })
}

async function loadExcelJs() {
  const module = await import('exceljs')
  return module.default || module
}

function imageDataUri(source) {
  if (typeof source !== 'string') return null
  const match = source.match(/^data:image\/(png|jpe?g);base64,([\s\S]+)$/i)
  if (!match) return null
  const extension = match[1].toLowerCase().startsWith('jp') ? 'jpeg' : 'png'
  return { base64: source, extension }
}

function convertImageToJpeg(source) {
  return new Promise(resolve => {
    if (typeof source !== 'string' || !source.startsWith('data:image/')) {
      resolve(null)
      return
    }
    const image = new Image()
    image.onload = () => {
      try {
        const maxSize = 1800
        const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve({ base64: canvas.toDataURL('image/jpeg', 0.88), extension: 'jpeg' })
      } catch {
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    image.src = source
  })
}

async function embeddableImage(source) {
  return imageDataUri(source) || await convertImageToJpeg(source)
}

async function appendPhotoRows(workbook, sheet, properties) {
  const rows = properties.flatMap(property => {
    const sources = [
      { origem: 'Monitoramento', report: null, photos: property.fotosAnomalias },
      ...asArray(property.relatoriosSalvos).map(report => ({
        origem: 'Relatório',
        report,
        photos: report.fotosAnomalias,
      })),
    ]

    return sources.flatMap(({ origem, report, photos }) =>
      asArray(photos).map(photo => ({ property, origem, report, photo }))
    )
  })

  for (const { property, origem, report, photo } of rows) {
    const source = photo.url || photo.base64 || ''
    const image = await embeddableImage(source)
    const row = sheet.addRow({
      propertyId: property.id ?? '',
      proprietario: property.proprietario || '',
      endereco: property.endereco || '',
      origem,
      reportId: report?.id ?? '',
      photoId: photo.id ?? '',
      codigoTrinca: photo.codigoTrinca || '',
      observacao: photo.observacao || '',
      pontos: jsonCell(photo.pontos),
      linhas: jsonCell(photo.linhas),
      extraData: jsonCell(extraData(photo, KNOWN_PHOTO_KEYS)),
      image: image ? 'Foto incorporada' : '',
      imageUrl: image ? '' : source,
    })

    if (image) {
      const imageId = workbook.addImage(image)
      row.height = 64
      sheet.addImage(imageId, {
        tl: { col: 11, row: row.number - 1 },
        ext: { width: 150, height: 82 },
        editAs: 'oneCell',
      })
    }
  }
}

export async function buildMonitoramentosWorkbook(properties = []) {
  const ExcelJS = await loadExcelJs()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Geovistorias'
  workbook.subject = 'Imóveis, relatórios, fotos e medições do Monitoramento'
  workbook.title = 'Exportação de Imóveis do Monitoramento'
  workbook.created = new Date()

  const propertySheet = workbook.addWorksheet('Imóveis')
  propertySheet.columns = PROPERTY_COLUMNS
  for (const property of properties) {
    propertySheet.addRow({
      ...Object.fromEntries(PROPERTY_COLUMNS.map(({ key }) => [key, ''])),
      id: property.id ?? '',
      createdAt: serializableCell(property.createdAt),
      proprietario: property.proprietario || '',
      cidade: property.cidade || '',
      endereco: property.endereco || '',
      celular: property.celular || '',
      latitude: property.latitude ?? '',
      longitude: property.longitude ?? '',
      nome: property.nome || '',
      areaTerrenho: jsonCell(property.areaTerrenho),
      verticesCasa: jsonCell(property.verticesCasa),
      alturaCasa: property.alturaCasa ?? '',
      trincasCasa: jsonCell(property.trincasCasa),
      edificacaoPlanta: jsonCell(property.edificacaoPlanta),
      extraData: jsonCell(extraData(property, KNOWN_PROPERTY_KEYS)),
    })
  }
  formatSheet(propertySheet)

  const reportSheet = workbook.addWorksheet('Relatórios')
  reportSheet.columns = REPORT_COLUMNS
  for (const property of properties) {
    for (const report of asArray(property.relatoriosSalvos)) {
      reportSheet.addRow({
        propertyId: property.id ?? '',
        proprietario: property.proprietario || '',
        endereco: property.endereco || '',
        reportId: report.id ?? '',
        nome: report.nome || '',
        createdAt: serializableCell(report.createdAt),
        updatedAt: serializableCell(report.updatedAt),
        metodo: report.metodo ?? '',
        extraData: jsonCell(extraData(report, KNOWN_REPORT_KEYS)),
      })
    }
  }
  formatSheet(reportSheet)

  const photoSheet = workbook.addWorksheet('Fotos e medições')
  photoSheet.columns = PHOTO_COLUMNS
  await appendPhotoRows(workbook, photoSheet, properties)
  formatSheet(photoSheet)

  return workbook.xlsx.writeBuffer()
}

export async function exportMonitoramentosExcel(properties = []) {
  const buffer = await buildMonitoramentosWorkbook(properties)
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `geovistorias_monitoramento_${new Date().toISOString().slice(0, 10)}.xlsx`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function cellValue(value) {
  if (value == null) return ''
  if (value instanceof Date) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('')
  if ('text' in value) return value.text
  if ('result' in value) return value.result
  return value
}

function rowsFromSheet(sheet) {
  if (!sheet || sheet.rowCount < 1) return []
  const headers = sheet.getRow(1).values.slice(1).map(value => String(cellValue(value) || '').trim())
  const rows = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const values = headers.map((header, index) => [
      header,
      header ? cellValue(row.getCell(index + 1).value) : '',
    ])
    const record = Object.fromEntries(values)
    if (Object.values(record).some(value => value !== '' && value != null)) {
      Object.defineProperty(record, '__rowNumber', { value: rowNumber })
      rows.push(record)
    }
  })
  return rows
}

function firstValue(row, ...keys) {
  for (const key of keys) {
    const value = row[key]
    if (value !== '' && value != null) return value
  }
  return undefined
}

function parseJson(value, label) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    throw new Error(`Confira o JSON da coluna “${label}” na planilha.`)
  }
}

function numericValue(value, label) {
  if (value === undefined || value === null || value === '') return undefined
  const numeric = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'))
  if (!Number.isFinite(numeric)) throw new Error(`Confira o valor da coluna “${label}”.`)
  return numeric
}

function normalizedIdentity(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR')
}

function sourceKey(id, owner, address) {
  if (id !== undefined && id !== null && String(id).trim()) return `id:${String(id).trim()}`
  return `identity:${normalizedIdentity(owner)}|${normalizedIdentity(address)}`
}

function parsePropertyRow(row, rowNumber) {
  const id = firstValue(row, 'ID', 'id', 'ID do imóvel')
  const owner = firstValue(row, 'Proprietário', 'proprietario')
  const address = firstValue(row, 'Endereço', 'endereco')
  const additional = parseJson(firstValue(row, 'Dados adicionais (JSON)'), 'Dados adicionais (JSON)') || {}
  if (typeof additional !== 'object' || Array.isArray(additional)) {
    throw new Error(`Dados adicionais inválidos na linha ${rowNumber} da aba Imóveis.`)
  }

  const data = { ...additional }
  const mappings = [
    ['proprietario', ['Proprietário', 'proprietario']],
    ['cidade', ['Cidade', 'cidade']],
    ['endereco', ['Endereço', 'endereco']],
    ['celular', ['Celular', 'Telefone', 'celular']],
    ['nome', ['Nome', 'nome']],
  ]
  for (const [key, aliases] of mappings) {
    const value = firstValue(row, ...aliases)
    if (value !== undefined) data[key] = String(value).trim()
  }
  for (const [key, aliases] of [
    ['latitude', ['Latitude', 'latitude']],
    ['longitude', ['Longitude', 'longitude']],
    ['alturaCasa', ['Altura da casa', 'Altura da casa (m)', 'alturaCasa']],
  ]) {
    const value = numericValue(firstValue(row, ...aliases), aliases[0])
    if (value !== undefined) data[key] = value
  }
  for (const [key, aliases] of [
    ['areaTerrenho', ['Área do terreno (JSON)', 'Área do terreno', 'areaTerrenho']],
    ['verticesCasa', ['Vértices da casa (JSON)', 'Vértices da casa', 'verticesCasa']],
    ['trincasCasa', ['Trincas da casa (JSON)', 'Trincas da casa', 'trincasCasa']],
    ['edificacaoPlanta', ['Planta da edificação (JSON)', 'Planta da edificação', 'edificacaoPlanta']],
  ]) {
    const value = parseJson(firstValue(row, ...aliases), aliases[0])
    if (value !== undefined) data[key] = value
  }

  if (!data.proprietario) throw new Error(`Informe o proprietário na linha ${rowNumber} da aba Imóveis.`)
  data.nome ||= data.proprietario

  return {
    sourceId: id === undefined ? '' : String(id).trim(),
    sourceKey: sourceKey(id, owner, address),
    data,
  }
}

function imageAsDataUri(workbook, imageId) {
  const image = workbook.getImage(imageId)
  if (!image) return ''
  if (image.base64) {
    return image.base64.startsWith('data:')
      ? image.base64
      : `data:image/${image.extension};base64,${image.base64}`
  }
  const bytes = image.buffer instanceof Uint8Array
    ? image.buffer
    : image.buffer ? new Uint8Array(image.buffer) : null
  if (!bytes?.length) return ''
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  const mime = image.extension === 'jpeg' || image.extension === 'jpg' ? 'image/jpeg' : `image/${image.extension}`
  return `data:${mime};base64,${btoa(binary)}`
}

function imagesByRow(workbook, sheet) {
  const result = new Map()
  if (!sheet) return result
  for (const image of sheet.getImages()) {
    const rowNumber = Math.floor(image.range.tl.nativeRow ?? image.range.tl.row) + 1
    const source = imageAsDataUri(workbook, image.imageId)
    if (source) result.set(rowNumber, source)
  }
  return result
}

function parsePhotoRows(workbook, sheet) {
  const embeddedImages = imagesByRow(workbook, sheet)
  return rowsFromSheet(sheet).map(row => {
    const rowNumber = row.__rowNumber
    const propertyId = firstValue(row, 'ID do imóvel', 'ID', 'propertyId')
    const owner = firstValue(row, 'Proprietário', 'proprietario')
    const address = firstValue(row, 'Endereço', 'endereco')
    const additional = parseJson(firstValue(row, 'Dados adicionais (JSON)'), 'Dados adicionais (JSON)') || {}
    if (typeof additional !== 'object' || Array.isArray(additional)) {
      throw new Error(`Dados adicionais inválidos na linha ${rowNumber} da aba Fotos e medições.`)
    }
    const photoId = firstValue(row, 'ID da foto', 'photoId') || `foto-importada-${rowNumber}`
    const points = parseJson(firstValue(row, 'Pontos (JSON)', 'Pontos', 'pontos'), 'Pontos (JSON)')
    const lines = parseJson(firstValue(row, 'Linhas e medidas (JSON)', 'Linhas e medidas', 'linhas'), 'Linhas e medidas (JSON)')
    const imageCell = String(firstValue(row, 'URL da imagem', 'Imagem') || '')
    const embedded = embeddedImages.get(rowNumber)
    const photo = {
      ...additional,
      id: String(photoId),
      codigoTrinca: String(firstValue(row, 'Código do ponto', 'Código da trinca', 'codigoTrinca') || ''),
      observacao: String(firstValue(row, 'Observação', 'observacao') || ''),
      ...(points !== undefined ? { pontos: points } : {}),
      ...(lines !== undefined ? { linhas: lines } : {}),
      url: embedded || (imageCell.startsWith('data:image/') || /^https?:\/\//i.test(imageCell) ? imageCell : ''),
    }

    return {
      sourceKey: sourceKey(propertyId, owner, address),
      reportId: String(firstValue(row, 'ID do relatório', 'reportId') || ''),
      origem: String(firstValue(row, 'Origem', 'origem') || 'Monitoramento'),
      photo,
    }
  })
}

function parseReportRows(sheet) {
  return rowsFromSheet(sheet).map(row => {
    const rowNumber = row.__rowNumber
    const propertyId = firstValue(row, 'ID do imóvel', 'propertyId')
    const owner = firstValue(row, 'Proprietário', 'proprietario')
    const address = firstValue(row, 'Endereço', 'endereco')
    const additional = parseJson(firstValue(row, 'Dados completos (JSON)'), 'Dados completos (JSON)') || {}
    if (typeof additional !== 'object' || Array.isArray(additional)) {
      throw new Error(`Dados completos inválidos na linha ${rowNumber} da aba Relatórios.`)
    }
    const reportId = firstValue(row, 'ID do relatório', 'reportId')
    if (reportId === undefined) throw new Error(`Informe o ID do relatório na linha ${rowNumber} da aba Relatórios.`)

    const report = {
      ...additional,
      id: String(reportId),
    }
    for (const [key, aliases] of [
      ['nome', ['Relatório', 'Nome', 'nome']],
      ['createdAt', ['Data de criação', 'createdAt']],
      ['updatedAt', ['Data de atualização', 'updatedAt']],
      ['metodo', ['Método', 'metodo']],
    ]) {
      const value = firstValue(row, ...aliases)
      if (value !== undefined) report[key] = cellValue(value)
    }

    return {
      sourceKey: sourceKey(propertyId, owner, address),
      report,
    }
  })
}

export async function readMonitoramentosWorkbook(file) {
  const ExcelJS = await loadExcelJs()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const propertySheet = workbook.getWorksheet('Imóveis')
    || workbook.getWorksheet('Imoveis')
    || workbook.worksheets.find(sheet => normalizedIdentity(sheet.name).includes('imoveis'))
  if (!propertySheet) throw new Error('A planilha precisa ter uma aba chamada “Imóveis”.')

  const properties = rowsFromSheet(propertySheet).map(row => parsePropertyRow(row, row.__rowNumber))
  if (!properties.length) throw new Error('A aba Imóveis não contém cadastros para importar.')
  const keys = new Set()
  for (const property of properties) {
    if (keys.has(property.sourceKey)) throw new Error('A planilha contém mais de uma linha para o mesmo imóvel.')
    keys.add(property.sourceKey)
  }

  const reports = parseReportRows(workbook.getWorksheet('Relatórios'))
  const photos = parsePhotoRows(workbook, workbook.getWorksheet('Fotos e medições'))
  return { properties, reports, photos }
}
