
export type StatusLeituraCemaden = 'atualizada' | 'atrasada' | 'sem-dados'

function dataCemadenParaDate(valor?: string | null): Date | null {
  const texto = String(valor || '').trim()
  if (!texto) return null
  const brasileiro = texto.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (brasileiro) {
    const ano = Number(brasileiro[3].length === 2 ? `20${brasileiro[3]}` : brasileiro[3])
    const data = new Date(Date.UTC(
      ano,
      Number(brasileiro[2]) - 1,
      Number(brasileiro[1]),
      Number(brasileiro[4]),
      Number(brasileiro[5]),
      Number(brasileiro[6] || 0),
    ))
    return Number.isNaN(data.getTime()) ? null : data
  }
  const isoSemFuso = texto.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/)
  const data = new Date(isoSemFuso ? `${isoSemFuso[1]}T${isoSemFuso[2]}Z` : texto)
  return Number.isNaN(data.getTime()) ? null : data
}

export function statusLeituraCemaden(valor?: string | null): StatusLeituraCemaden {
  const data = dataCemadenParaDate(valor)
  if (!data) return 'sem-dados'
  const idadeHoras = Math.max(0, (Date.now() - data.getTime()) / (60 * 60 * 1000))
  if (idadeHoras <= 1) return 'atualizada'
  if (idadeHoras <= 24) return 'atrasada'
  return 'sem-dados'
}

export function dataHoraCemadenFormatada(valor?: string | null): string {
  const data = dataCemadenParaDate(valor)
  return data
    ? data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
    : valor || 'Sem horário'
}

