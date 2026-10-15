import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'

const LIST_LABELS = {
  id: 'ID',
  createdAt: 'Data de cadastro',
  proprietario: 'Proprietário',
  cidade: 'Cidade',
  endereco: 'Endereço',
  celular: 'Telefone',
  latitude: 'Latitude',
  longitude: 'Longitude',
  nome: 'Nome',
  areaTerrenho: 'Área do terreno',
  verticesCasa: 'Vértices da casa',
  alturaCasa: 'Altura da casa',
  trincasCasa: 'Trincas da casa',
  edificacaoPlanta: 'Planta da edificação',
}

const today = () => new Date().toISOString().slice(0, 10)
const asArray = value => Array.isArray(value) ? value : []
const asJson = value => value == null ? '' : JSON.stringify(value)
const omitKeys = (value, keys) => Object.fromEntries(
  Object.entries(value || {}).filter(([key]) => !keys.includes(key))
)

function photoRows(properties) {
  return properties.flatMap(property => {
    const sources = [
      { type: 'Monitoramento', report: null, photos: property.fotosAnomalias },
      ...asArray(property.relatoriosSalvos).map(report => ({
        type: 'Relatório',
        report,
        photos: report.fotosAnomalias,
      })),
    ]

    return sources.flatMap(({ type, report, photos }) =>
      asArray(photos).map(photo => ({
        'ID do imóvel': property.id ?? '',
        Proprietário: property.proprietario || '',
        Origem: type,
        'ID do relatório': report?.id ?? '',
        'ID da foto': photo.id ?? '',
        'Código da trinca': photo.codigoTrinca || '',
        Observação: photo.observacao || '',
        'Quantidade de pontos': asArray(photo.pontos).length,
        'Quantidade de linhas': asArray(photo.linhas).length,
        'Pontos (JSON)': asJson(photo.pontos),
        'Linhas e medidas (JSON)': asJson(photo.linhas),
        'Imagem': photo.url?.startsWith('data:image/')
          ? 'Imagem incluída no PDF'
          : photo.url || '',
        'Dados adicionais (JSON)': asJson(omitKeys(photo, ['url', 'base64', 'pontos', 'linhas', 'observacao', 'id', 'codigoTrinca'])),
      }))
    )
  })
}

function makeSheet(rows, headers) {
  const sheet = rows.length
    ? XLSX.utils.json_to_sheet(rows, { header: headers })
    : XLSX.utils.aoa_to_sheet([headers])
  sheet['!cols'] = headers.map(header => ({ wch: Math.min(42, Math.max(12, header.length + 2)) }))
  return sheet
}

export function exportMonitoramentosExcel(properties = []) {
  const propertyRows = properties.map(property => {
    const row = {}
    for (const [key, value] of Object.entries(property)) {
      if (key === 'fotosAnomalias' || key === 'relatoriosSalvos') continue
      const label = LIST_LABELS[key] || key
      row[label] = typeof value === 'object' && value !== null ? asJson(value) : value ?? ''
    }
    row['Quantidade de fotos'] = asArray(property.fotosAnomalias).length
    row['Quantidade de relatórios'] = asArray(property.relatoriosSalvos).length
    row['Dados adicionais (JSON)'] = asJson(omitKeys(property, [
      ...Object.keys(LIST_LABELS),
      'fotosAnomalias',
      'relatoriosSalvos',
    ]))
    return row
  })

  const reportRows = properties.flatMap(property =>
    asArray(property.relatoriosSalvos).map(report => ({
      'ID do imóvel': property.id ?? '',
      Proprietário: property.proprietario || '',
      Endereço: property.endereco || '',
      'ID do relatório': report.id ?? '',
      Relatório: report.nome || '',
      'Data de criação': report.createdAt || '',
      'Data de atualização': report.updatedAt || '',
      Método: report.metodo ?? '',
      'Quantidade de fotos': asArray(report.fotosAnomalias).length,
      'Dados completos (JSON)': asJson(omitKeys(report, ['fotosAnomalias'])),
    }))
  )

  const photoData = photoRows(properties)
  const propertyHeaders = [
    ...new Set(propertyRows.flatMap(row => Object.keys(row))),
  ]
  if (!propertyHeaders.length) propertyHeaders.push('ID', 'Proprietário')
  const reportHeaders = [
    'ID do imóvel', 'Proprietário', 'Endereço', 'ID do relatório', 'Relatório',
    'Data de criação', 'Data de atualização', 'Método', 'Quantidade de fotos',
    'Dados completos (JSON)',
  ]
  const photoHeaders = [
    'ID do imóvel', 'Proprietário', 'Origem', 'ID do relatório', 'ID da foto',
    'Código da trinca', 'Observação', 'Quantidade de pontos', 'Quantidade de linhas',
    'Pontos (JSON)', 'Linhas e medidas (JSON)', 'Imagem', 'Dados adicionais (JSON)',
  ]

  const workbook = XLSX.utils.book_new()
  workbook.Props = {
    Title: 'Geovistorias — Exportação de Monitoramentos',
    Subject: 'Imóveis, relatórios, fotos e medições',
    Author: 'Geovistorias',
    CreatedDate: new Date(),
  }
  XLSX.utils.book_append_sheet(workbook, makeSheet(propertyRows, propertyHeaders), 'Imóveis')
  XLSX.utils.book_append_sheet(workbook, makeSheet(reportRows, reportHeaders), 'Relatórios')
  XLSX.utils.book_append_sheet(workbook, makeSheet(photoData, photoHeaders), 'Fotos e medições')
  XLSX.writeFile(workbook, `geovistorias_monitoramento_${today()}.xlsx`)
}

const PDF_LABELS = {
  id: 'ID',
  createdAt: 'Data de cadastro',
  proprietario: 'Proprietário',
  cidade: 'Cidade',
  endereco: 'Endereço',
  celular: 'Telefone',
  latitude: 'Latitude',
  longitude: 'Longitude',
  nome: 'Nome',
  areaTerrenho: 'Área do terreno',
  verticesCasa: 'Vértices da casa',
  alturaCasa: 'Altura da casa',
  trincasCasa: 'Trincas da casa',
  edificacaoPlanta: 'Planta da edificação',
  updatedAt: 'Última atualização',
  metodo: 'Método',
  anomalias3D: 'Anomalias 3D',
  trincasPlanta: 'Trincas na planta',
}

function pdfText(value) {
  const text = value == null
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)
  // jsPDF's built-in Helvetica font does not include every Unicode glyph.
  return text.replace(/[^\u0000-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, '?')
}

export function exportMonitoramentosPdf(properties = []) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const textWidth = pageWidth - margin * 2
  let y = 27

  const drawHeader = () => {
    doc.setFillColor(15, 23, 42)
    doc.rect(0, 0, pageWidth, 20, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text('GEOVISTORIAS — MONITORAMENTO', margin, 9)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(`Exportado em ${new Date().toLocaleString('pt-BR')}`, margin, 15)
    doc.setTextColor(15, 23, 42)
  }

  const newPage = () => {
    doc.addPage()
    drawHeader()
    y = 27
  }

  const writeLines = (value, { size = 8, bold = false, color = [51, 65, 85], lineHeight = 4.2 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lines = doc.splitTextToSize(pdfText(value), textWidth)
    for (const line of lines) {
      if (y + lineHeight > pageHeight - 14) newPage()
      doc.text(line, margin, y)
      y += lineHeight
    }
    doc.setTextColor(15, 23, 42)
  }

  const section = title => {
    if (y + 11 > pageHeight - 14) newPage()
    doc.setFillColor(219, 234, 254)
    doc.roundedRect(margin, y - 4, textWidth, 8, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(30, 64, 175)
    doc.text(pdfText(title), margin + 2, y + 1.2)
    doc.setTextColor(15, 23, 42)
    y += 9
  }

  const field = (key, value) => {
    if (value == null || value === '') return
    writeLines(`${PDF_LABELS[key] || key}: ${pdfText(value)}`)
  }

  const addPhoto = (photo, index) => {
    const title = `Foto ${index + 1}${photo.codigoTrinca ? ` — ${photo.codigoTrinca}` : ''}`
    writeLines(title, { bold: true, size: 8 })
    if (photo.observacao) field('Observação', photo.observacao)
    if (asArray(photo.pontos).length) field('Pontos', photo.pontos)
    if (asArray(photo.linhas).length) field('Linhas e medidas', photo.linhas)

    const source = photo.url || photo.base64
    if (typeof source !== 'string' || !/^data:image\/(jpeg|jpg|png);base64,/i.test(source)) {
      writeLines('Imagem não disponível para incorporação neste arquivo.', { size: 7, color: [100, 116, 139] })
      return
    }
    try {
      const image = doc.getImageProperties(source)
      const maxWidth = textWidth
      const maxHeight = 78
      const ratio = Math.min(maxWidth / image.width, maxHeight / image.height)
      const width = image.width * ratio
      const height = image.height * ratio
      if (y + height + 4 > pageHeight - 14) newPage()
      const format = /^data:image\/png/i.test(source) ? 'PNG' : 'JPEG'
      doc.addImage(source, format, margin, y, width, height)
      y += height + 4
    } catch {
      writeLines('Não foi possível incorporar a imagem; os dados da foto foram mantidos.', { size: 7 })
    }
  }

  drawHeader()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Relatório geral de monitoramentos', margin, y)
  y += 9
  writeLines(`${properties.length} imóvel(is) · ${properties.reduce((sum, item) => sum + asArray(item.relatoriosSalvos).length, 0)} relatório(s)`)
  y += 3

  if (!properties.length) {
    writeLines('Nenhum imóvel de monitoramento está disponível para exportação.')
  }

  properties.forEach((property, propertyIndex) => {
    newPage()
    section(`Imóvel ${propertyIndex + 1}: ${property.proprietario || property.nome || 'Sem nome'}`)
    for (const [key, value] of Object.entries(property)) {
      if (key === 'fotosAnomalias' || key === 'relatoriosSalvos') continue
      field(key, value)
    }

    const propertyPhotos = asArray(property.fotosAnomalias)
    if (propertyPhotos.length) {
      y += 2
      section('Fotos do monitoramento')
      propertyPhotos.forEach(addPhoto)
    }

    asArray(property.relatoriosSalvos).forEach((report, reportIndex) => {
      y += 2
      section(`Relatório ${reportIndex + 1}: ${report.nome || report.id || 'Sem título'}`)
      for (const [key, value] of Object.entries(report)) {
        if (key === 'fotosAnomalias') continue
        field(key, value)
      }
      asArray(report.fotosAnomalias).forEach(addPhoto)
    })
  })

  const totalPages = doc.getNumberOfPages()
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text(`Página ${page} de ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: 'right' })
  }

  doc.save(`geovistorias_monitoramento_${today()}.pdf`)
}
