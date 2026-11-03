
import './ChuvaCentro24h.css'
import { ChartaChuva, type PontoSerie } from './MonitoramentoCNL'

type AcumuladosChuvaCentro = {
  umaHora: number | null
  tresHoras: number | null
  seisHoras: number | null
  dozeHoras: number | null
  vinteQuatroHoras: number | null
}

export type EstacaoChuvaCentro = {
  nome: string
  codigo?: string
  dataHora?: string
  acumulados: AcumuladosChuvaCentro
}

type Props = {
  estacao: EstacaoChuvaCentro | null | undefined
  pontos: PontoSerie[]
}

const HORA_MS = 60 * 60 * 1000

function formatarMm(valor: number | null | undefined) {
  return valor == null || !Number.isFinite(valor)
    ? '—'
    : `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} mm`
}

function rotuloLeituraCemaden(valor?: string) {
  if (!valor) return 'Horário não informado'
  const match = valor.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2})/)
  if (!match) return valor
  const ano = match[3].length === 2 ? `20${match[3]}` : match[3]
  return `${match[1]}/${match[2]}/${ano} · ${match[4]}:${match[5]}`
}

function dataHoraCatalogo(valor?: string) {
  if (!valor) return null
  const match = valor.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2})/)
  if (!match) return null
  const [, dia, mes, anoTexto, hora, minuto] = match
  const ano = Number(anoTexto.length === 2 ? `20${anoTexto}` : anoTexto)
  return Date.UTC(ano, Number(mes) - 1, Number(dia), Number(hora), Number(minuto))
}

function intervaloJanela(horas: number, dataHora?: string) {
  const fim = dataHoraCatalogo(dataHora)
  if (fim == null) return 'janela móvel oficial'
  const formatador = new Intl.DateTimeFormat('pt-BR', {
    day: horas === 24 ? '2-digit' : undefined,
    month: horas === 24 ? '2-digit' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  })
  const inicio = fim - horas * HORA_MS
  return `${formatador.format(new Date(inicio))} – ${formatador.format(new Date(fim))}`
}

function IconeChuva() {
  return (
    <svg viewBox="0 0 40 36" aria-hidden="true">
      <path d="M10 23.5h18a6.5 6.5 0 0 0 .4-13A9.7 9.7 0 0 0 10 12.3a5.6 5.6 0 0 0 0 11.2Z" />
      <path d="m14 27-2 5m10-5-2 5m10-5-2 5" className="chuva-centro-gota-brilho" />
    </svg>
  )
}

function IconeIndicador() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="6" width="20" height="21" rx="2" /><path d="M9 3v6m10-6v6M4 12h20m3 9v7m-3-3h6" /></svg>
}

function IconeRelogio() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11.5" /><path d="M16 9v7l5 3" /></svg>
}

export function ChuvaCentro24h({ estacao, pontos }: Props) {
  const acumulados = estacao?.acumulados
  const janelas = [
    { rotulo: 'Última hora', horas: 1, valor: acumulados?.umaHora ?? null },
    { rotulo: 'Últimas 6 horas', horas: 6, valor: acumulados?.seisHoras ?? null },
    { rotulo: 'Últimas 12 horas', horas: 12, valor: acumulados?.dozeHoras ?? null },
    { rotulo: 'Últimas 24 horas', horas: 24, valor: acumulados?.vinteQuatroHoras ?? null },
  ]
  const total24h = acumulados?.vinteQuatroHoras ?? null
  const temDados = janelas.some(janela => janela.valor != null) || pontos.length > 0
  const tituloEstacao = 'Centro de Conselheiro Lafaiete (CEMADEN)'

  return (
    <section className="chuva-centro-card" aria-labelledby="chuva-centro-titulo">
      <header className="chuva-centro-topo">
        <div className="chuva-centro-titulo-grupo">
          <span className="chuva-centro-eyebrow">MONITORAMENTO CEMADEN · PLUVIÔMETRO</span>
          <h2 id="chuva-centro-titulo">Precipitação acumulada nas últimas 24 horas</h2>
          <p>Estação: {tituloEstacao}</p>
        </div>
        <div className="chuva-centro-total" aria-label={`Acumulado oficial em 24 horas: ${formatarMm(total24h)}`}>
          <span className="chuva-centro-total-icone"><IconeChuva /></span>
          <div>
            <small>Acumulado em 24 horas</small>
            <strong>{formatarMm(total24h)}</strong>
            <small>Atualizado: {rotuloLeituraCemaden(estacao?.dataHora)}</small>
          </div>
        </div>
      </header>

      <div className="chuva-centro-corpo">
        <div className="chuva-centro-meta">
          <span>Estação {estacao?.codigo || 'CEMADEN 3121'}</span>
          <span>Valores oficiais do catálogo CEMADEN</span>
        </div>

        {temDados ? (
          <div className="chuva-centro-grafico-wrap">
            <div className="chuva-centro-grafico-cabecalho">
              <strong><IconeIndicador /> Acumulado de precipitação</strong>
            </div>
            <ChartaChuva
              pontos={pontos}
              estacao={estacao}
              mostrarTitulo={false}
              mostrarNotaLegenda={false}
            />
          </div>
        ) : (
          <div className="chuva-centro-sem-acumulado">
            O catálogo CEMADEN ainda não retornou acumulados para esta estação.
          </div>
        )}

        <div className="chuva-centro-indicadores">
          {janelas.map((janela, indice) => (
            <article className="chuva-centro-indicador" key={janela.rotulo}>
              <span className="chuva-centro-indicador-icone chuva-centro-indicador-icone-periodo">
                <IconeRelogio />
              </span>
              <span>{janela.rotulo}</span>
              <strong>{formatarMm(janela.valor)}</strong>
              <small>{intervaloJanela(janela.horas, estacao?.dataHora)}</small>
              {indice === 3 && <small className="chuva-centro-indicador-fonte">Acumulado oficial de 24 h</small>}
            </article>
          ))}
        </div>
        <p className="chuva-centro-fonte">
          Fonte: CEMADEN · Estação Centro, Conselheiro Lafaiete/MG · Atualização automática a cada 5 minutos.
        </p>
      </div>
    </section>
  )
}

