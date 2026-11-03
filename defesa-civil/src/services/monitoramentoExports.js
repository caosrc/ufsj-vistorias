import { jsPDF } from 'jspdf'
export { exportMonitoramentosExcel } from './monitoramentoSpreadsheet'

const today = () => new Date().toISOString().slice(0, 10)
const asArray = value => Array.isArray(value) ? value : []

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
