
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Marker, Polygon, Popup, Tooltip, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import ModalSenha from './ModalSenha'
import './AreasRiscoMapa.css'
import { ESTILO_AREA_RISCO, TIPOS_AREAS_RISCO, type AreaRisco, type AreaRiscoInput, type TipoAreaRisco } from '../areasRisco'

export interface AreasRiscoMapaProps {
  painelHost: HTMLDivElement | null
  modoTv: boolean
  areas: AreaRisco[]
  previsaoPorArea: Record<string, number | null>
  alertaSonoroAtivo: boolean
  onAlternarAlertaSonoro: () => void
  carregando: boolean
  salvando: boolean
  agenteLogado: string
  senhaAgente: string | null
  erro: string | null
  onSalvar: (input: AreaRiscoInput) => Promise<void>
  onEditar: (id: string, input: AreaRiscoInput) => Promise<void>
  onExcluir: (id: string) => Promise<void>
  onAbrirOcorrencia?: (id: number) => void
}

const TIPOS = TIPOS_AREAS_RISCO
const ROTULOS_TIPOS_COMPACTOS: Partial<Record<TipoAreaRisco, string>> = {
  'Problemas de vias': 'Vias',
  Deslizamentos: 'Desliz.',
}
const CORES = Object.fromEntries(
  TIPOS.map(tipo => [tipo, ESTILO_AREA_RISCO[tipo].cor]),
) as Record<TipoAreaRisco, string>

const ICONES: Record<TipoAreaRisco, string> = {
  Encostas: '<path d="M4 19 11 6l4 7 2-3 3 9H4Z"/><path d="M8 19h.01M12 19h.01M17 19h.01"/>',
  'Erosões': '<path d="M5 5h14M6 9h12M7 13h10M9 17h6"/><path d="m11 5-2 4 2 4-2 4"/>',
  Drenagem: '<path d="M12 3v13"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  Alagamentos: '<path d="M4 9c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M4 14c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M7 19h10"/>',
  Deslizamentos: '<path d="m4 18 5-8 3 4 3-7 5 11H4Z"/><path d="m7 5 2 2m8 7 2 2"/>',
  'Problemas de vias': '<path d="M8 3 5 21m11-18 3 18"/><path d="M12 4v3m0 3v3m0 3v3"/>',
  Obras: '<path d="m14 6 4 4M5 19l8-8"/><path d="m16 4 4 4-3 3-4-4 3-3ZM4 20l2-5 3 3-5 2Z"/>',
  Interdições: '<path d="M3 9h18M3 15h18M6 9v6m12-6v6"/><path d="m4 9 4 6m4-6 4 6m4-6 4 6"/>',
}

interface DraftArea {
  tipo: TipoAreaRisco
  latitude: number | null
  longitude: number | null
  poligono: Array<[number, number]>
  data_inicio: string
  limite_precipitacao_mm: string
  referencia: string
  observacao: string
}

type GateAction = { tipo: 'editar' | 'excluir'; area: AreaRisco }

function dataHoje() {
  const hoje = new Date()
  const local = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function novaArea(tipo: TipoAreaRisco = 'Encostas'): DraftArea {
  return {
    tipo,
    latitude: null,
    longitude: null,
    poligono: [],
    data_inicio: dataHoje(),
    limite_precipitacao_mm: tipo === 'Interdições' ? '0' : '',
    referencia: '',
    observacao: '',
  }
}

function iconeArea(tipo: TipoAreaRisco, alerta = false) {
  const cor = CORES[tipo]
  const html = `<span class="arm-marker${alerta ? ' arm-marker-alerta' : ''}" style="--arm-type-color:${cor}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONES[tipo]}</svg></span>`
  return L.divIcon({
    className: 'arm-marker-shell',
    html,
    iconSize: [34, 42],
    iconAnchor: [17, 38],
    popupAnchor: [0, -37],
  })
}

function InteracaoMapa({
  modo,
  aoMarcar,
  aoAdicionarPonto,
}: {
  modo: 'marcador' | 'poligono' | null
  aoMarcar: (latitude: number, longitude: number) => void
  aoAdicionarPonto: (ponto: [number, number]) => void
}) {
  useMapEvents({
    click(event) {
      if (modo === 'marcador') aoMarcar(event.latlng.lat, event.latlng.lng)
      if (modo === 'poligono') aoAdicionarPonto([event.latlng.lat, event.latlng.lng])
    },
  })
  return null
}

function formatarData(data: string) {
  if (!data) return '—'
  const parsed = new Date(`${data.slice(0, 10)}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? data : parsed.toLocaleDateString('pt-BR')
}

function formatarPrecipitacao(valor: number | null | undefined) {
  return valor == null
    ? 'Sem dado'
    : `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm`
}

export default function AreasRiscoMapa({
  painelHost,
  modoTv,
  areas,
  previsaoPorArea,
  alertaSonoroAtivo,
  onAlternarAlertaSonoro,
  carregando,
  salvando,
  agenteLogado,
  senhaAgente,
  erro,
  onSalvar,
  onEditar,
  onExcluir,
  onAbrirOcorrencia,
}: AreasRiscoMapaProps) {
  const [filtro, setFiltro] = useState<TipoAreaRisco | 'Todas'>('Todas')
  const [tiposVisiveisNoMapa, setTiposVisiveisNoMapa] = useState<Set<TipoAreaRisco>>(() => new Set(TIPOS))
  const [listaAreasAberta, setListaAreasAberta] = useState(false)
  const [rascunho, setRascunho] = useState<DraftArea | null>(null)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [modoMapa, setModoMapa] = useState<'marcador' | 'poligono' | null>(null)
  const [portao, setPortao] = useState<GateAction | null>(null)
  const [localErro, setLocalErro] = useState('')
  const [recolhido, setRecolhido] = useState(!modoTv)
  const painelRef = useRef<HTMLDivElement>(null)
  const scrollAntesDoFormularioRef = useRef(0)
  const formularioAberto = rascunho !== null

  useEffect(() => {
    const painel = painelRef.current
    if (!painel) return

    if (formularioAberto) {
      painel.scrollTo({ top: painel.scrollHeight, behavior: 'smooth' })
    } else {
      painel.scrollTo({ top: scrollAntesDoFormularioRef.current, behavior: 'auto' })
    }
  }, [formularioAberto])

  useEffect(() => {
    if (modoTv) setRecolhido(false)
  }, [modoTv])

  const contagens = useMemo(() => {
    const iniciais = Object.fromEntries(TIPOS.map(tipo => [tipo, 0])) as Record<TipoAreaRisco, number>
    return areas.reduce((resultado, area) => {
      resultado[area.tipo] += 1
      return resultado
    }, iniciais)
  }, [areas])

  const alertas = useMemo(
    () => areas.filter(area => {
      if (area.tipo === 'Interdições') return false
      const previsto = previsaoPorArea[area.id]
      return previsto != null && Number.isFinite(previsto) && previsto > area.limite_precipitacao_mm
    }),
    [areas, previsaoPorArea],
  )

  const areasVisiveis = filtro === 'Todas' ? areas : areas.filter(area => area.tipo === filtro)
  const areasNoMapa = areas.filter(area => tiposVisiveisNoMapa.has(area.tipo))
  const todosTiposVisiveisNoMapa = tiposVisiveisNoMapa.size === TIPOS.length

  function alternarTipoNoMapa(tipo: TipoAreaRisco) {
    setTiposVisiveisNoMapa(atuais => {
      const atualizados = new Set(atuais)
      if (atualizados.has(tipo)) atualizados.delete(tipo)
      else atualizados.add(tipo)
      return atualizados
    })
  }

  function alternarTodosTiposNoMapa() {
    setTiposVisiveisNoMapa(todosTiposVisiveisNoMapa ? new Set() : new Set(TIPOS))
  }

  function iniciarCadastro() {
    scrollAntesDoFormularioRef.current = painelRef.current?.scrollTop ?? 0
    setRascunho(novaArea(filtro === 'Todas' ? 'Encostas' : filtro))
    setEditandoId(null)
    setModoMapa('marcador')
    setLocalErro('')
    setRecolhido(false)
  }

  function abrirEdicao(area: AreaRisco) {
    if (area.ocorrencia_id != null) {
      setLocalErro('Esta interdição é gerenciada pela ocorrência vinculada. Abra a ocorrência para alterá-la.')
      return
    }
    if (!agenteLogado || !senhaAgente) {
      setLocalErro('Não foi possível validar a senha do agente desta sessão.')
      return
    }
    setLocalErro('')
    setPortao({ tipo: 'editar', area })
  }

  function abrirExclusao(area: AreaRisco) {
    if (area.ocorrencia_id != null) {
      setLocalErro('Esta interdição é gerenciada pela ocorrência vinculada. Abra a ocorrência para alterá-la.')
      return
    }
    if (!agenteLogado || !senhaAgente) {
      setLocalErro('Não foi possível validar a senha do agente desta sessão.')
      return
    }
    setLocalErro('')
    setPortao({ tipo: 'excluir', area })
  }

  function concluirAutorizacao() {
    if (!portao) return
    if (portao.tipo === 'editar') {
      const area = portao.area
      scrollAntesDoFormularioRef.current = painelRef.current?.scrollTop ?? 0
      setRascunho({
        tipo: area.tipo,
        latitude: area.latitude,
        longitude: area.longitude,
        poligono: area.poligono.map(ponto => [ponto[0], ponto[1]]),
        data_inicio: area.data_inicio.slice(0, 10),
        limite_precipitacao_mm: String(area.limite_precipitacao_mm),
        referencia: area.referencia ?? '',
        observacao: area.observacao ?? '',
      })
      setEditandoId(area.id)
      setModoMapa(null)
      setLocalErro('')
      setRecolhido(false)
    } else {
      void excluirArea(portao.area)
    }
    setPortao(null)
  }

  function fecharFormulario() {
    setRascunho(null)
    setEditandoId(null)
    setModoMapa(null)
  }

  async function excluirArea(area: AreaRisco) {
    try {
      setLocalErro('')
      await onExcluir(area.id)
    } catch (e) {
      setLocalErro(e instanceof Error ? e.message : 'Não foi possível excluir a área.')
    }
  }

  function atualizarRascunho(partial: Partial<DraftArea>) {
    setRascunho(atual => atual ? { ...atual, ...partial } : atual)
  }

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!rascunho) return
    if (rascunho.latitude == null || rascunho.longitude == null) {
      setLocalErro('Marque a localização no mapa antes de salvar.')
      return
    }
    const isInterdicao = rascunho.tipo === 'Interdições'
    const limite = isInterdicao ? 0 : Number(rascunho.limite_precipitacao_mm)
    if (!isInterdicao && (!Number.isFinite(limite) || limite < 0)) {
      setLocalErro('Informe um limite de precipitação válido, em milímetros.')
      return
    }
    const input: AreaRiscoInput = {
      tipo: rascunho.tipo,
      latitude: rascunho.latitude,
      longitude: rascunho.longitude,
      poligono: rascunho.poligono,
      data_inicio: rascunho.data_inicio,
      limite_precipitacao_mm: limite,
      referencia: rascunho.referencia.trim() || null,
      observacao: rascunho.observacao.trim() || null,
    }
    try {
      setLocalErro('')
      if (editandoId) await onEditar(editandoId, input)
      else await onSalvar(input)
      setRascunho(null)
      setEditandoId(null)
      setModoMapa(null)
    } catch (e) {
      setLocalErro(e instanceof Error ? e.message : 'Não foi possível salvar a área.')
    }
  }

  const mapModeLabel = modoMapa === 'marcador'
    ? 'Clique no mapa para posicionar o ponto de referência.'
    : modoMapa === 'poligono'
      ? `Clique no mapa para adicionar vértices (${rascunho?.poligono.length ?? 0}).`
      : ''

  return (
    <>
      <InteracaoMapa
        modo={modoMapa}
        aoMarcar={(latitude, longitude) => {
          atualizarRascunho({ latitude, longitude })
          setModoMapa('poligono')
          setLocalErro('')
        }}
        aoAdicionarPonto={ponto => atualizarRascunho({
          poligono: [...(rascunho?.poligono ?? []), ponto],
        })}
      />
      {areasNoMapa.map(area => {
        const previsto = previsaoPorArea[area.id]
        const emAlerta = area.tipo !== 'Interdições' && previsto != null && Number.isFinite(previsto) && previsto > area.limite_precipitacao_mm
        const cor = CORES[area.tipo]
        return (
          <Fragment key={`area-layer-${area.id}`}>
            {area.poligono.length >= 3 && (
              <Polygon
                positions={area.poligono}
                pathOptions={{
                  color: cor,
                  weight: emAlerta ? 4 : 2,
                  fillColor: cor,
                  fillOpacity: emAlerta ? 0.3 : 0.17,
                  className: emAlerta ? 'arm-polygon-alerta' : undefined,
                }}
              />
            )}
            <Marker
              position={[area.latitude, area.longitude]}
              icon={iconeArea(area.tipo, emAlerta)}
              zIndexOffset={emAlerta ? 900 : 400}
            >
              <Tooltip direction="top" offset={[0, -28]} permanent={emAlerta} className={emAlerta ? 'arm-tooltip-alerta' : 'arm-tooltip'}>
                {emAlerta ? 'ALERTA · ' : ''}{area.tipo}
              </Tooltip>
              <Popup>
                <div className="arm-popup">
                  <div className="arm-popup-title" style={{ color: cor }}>{area.tipo}</div>
                  {emAlerta && <div className="arm-popup-alert">PREVISÃO ACIMA DO LIMITE</div>}
                  <div>{area.tipo === 'Interdições' ? 'Interdição desde:' : 'Início:'} <strong>{formatarData(area.data_inicio)}</strong></div>
                  {area.tipo === 'Interdições'
                    ? <div className="arm-popup-interdiction-status">Local de interdição cadastrado</div>
                    : <>
                      <div>Limite: <strong>{area.limite_precipitacao_mm} mm</strong></div>
                      <div>Previsão 24 h: <strong>{formatarPrecipitacao(previsto)}</strong></div>
                    </>}
                  {area.referencia && <div>Referência: {area.referencia}</div>}
                  {area.observacao && <div className="arm-popup-notes">{area.observacao}</div>}
                  {area.ocorrencia_id != null && <div className="arm-popup-linked">Vinculada à ocorrência #{area.ocorrencia_id}</div>}
                  <div className="arm-popup-by">Cadastro: {area.criado_por || '—'}</div>
                  <div className="arm-popup-actions">
                    {area.ocorrencia_id != null ? (
                      <button
                        type="button"
                        className="arm-popup-open-occurrence"
                        data-testid={`button-abrir-ocorrencia-area-${area.id}`}
                        onClick={() => onAbrirOcorrencia?.(area.ocorrencia_id!)}
                      >
                        Abrir ocorrência #{area.ocorrencia_id}
                      </button>
                    ) : <>
                      <button type="button" data-testid={`button-editar-area-${area.id}`} onClick={() => abrirEdicao(area)}>Editar</button>
                      <button type="button" data-testid={`button-excluir-area-${area.id}`} onClick={() => abrirExclusao(area)}>Excluir</button>
                    </>}
                  </div>
                </div>
              </Popup>
            </Marker>
          </Fragment>
        )
      })}
      {rascunho && rascunho.poligono.length >= 3 && (
        <Polygon
          positions={rascunho.poligono}
          pathOptions={{ color: CORES[rascunho.tipo], weight: 3, fillColor: CORES[rascunho.tipo], fillOpacity: 0.24, dashArray: '7 5' }}
        />
      )}
      {rascunho && rascunho.latitude != null && rascunho.longitude != null && (
        <Marker position={[rascunho.latitude, rascunho.longitude]} icon={iconeArea(rascunho.tipo)} zIndexOffset={1000}>
          <Tooltip permanent direction="top" offset={[0, -25]}>Ponto de referência</Tooltip>
        </Marker>
      )}
      {rascunho?.poligono.map((ponto, indice) => (
        <Marker
          key={`draft-vertex-${indice}`}
          position={ponto}
          draggable
          icon={L.divIcon({
            className: 'arm-vertex-shell',
            html: '<span class="arm-vertex" aria-hidden="true"></span>',
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          })}
          eventHandlers={{
            dragend(event) {
              const novaPosicao = event.target.getLatLng()
              atualizarRascunho({
                  poligono: (rascunho?.poligono ?? []).map((item, i) =>
                  i === indice ? [novaPosicao.lat, novaPosicao.lng] as [number, number] : item,
                ),
              })
            },
          }}
        />
      ))}
      {painelHost && createPortal(
        <div
          ref={painelRef}
          className={`arm-panel${recolhido ? ' arm-panel-recolhido' : ''}${formularioAberto ? ' arm-panel-form-active' : ''}${modoTv ? ' arm-panel-tv' : ''}`}
        >
        <div className="arm-panel-head">
          <div className="arm-head-mark" aria-hidden="true"><span /></div>
          <div className="arm-head-copy">
            <div className="arm-eyebrow">DEFESA CIVIL · LAFAIETE</div>
            <h2>Áreas de risco</h2>
          </div>
          <button
            type="button"
            className={`arm-sound-toggle${alertaSonoroAtivo ? ' arm-sound-toggle-active' : ''}`}
            aria-label={`${alertaSonoroAtivo ? 'Desativar' : 'Ativar'} alerta sonoro de chuva`}
            aria-pressed={alertaSonoroAtivo}
            title={`${alertaSonoroAtivo ? 'Desativar' : 'Ativar'} alerta sonoro de chuva`}
            data-testid="toggle-alerta-sonoro-areas-risco"
            onClick={onAlternarAlertaSonoro}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 5 6 9H3v6h3l5 4V5Z" />
              {alertaSonoroAtivo
                ? <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>
                : <><path d="m16 9 5 6" /><path d="m21 9-5 6" /></>}
            </svg>
            <span>Som {alertaSonoroAtivo ? 'ligado' : 'desligado'}</span>
          </button>
          <button
            type="button"
            className="arm-collapse"
            aria-label={recolhido ? 'Expandir painel' : 'Recolher painel'}
            title={recolhido ? 'Mostrar áreas de risco' : 'Ocultar áreas de risco'}
            aria-expanded={!recolhido}
            data-testid="button-recolher-painel-riscos"
            onClick={() => setRecolhido(value => !value)}
          >
            <span aria-hidden="true">{recolhido ? '↓' : '↑'}</span>
          </button>
          {modoTv && (
            <button
              type="button"
              className="arm-add-tv"
              aria-label="Cadastrar área de risco"
              title="Cadastrar área de risco"
              data-testid="button-nova-area-tv"
              onClick={iniciarCadastro}
              disabled={Boolean(rascunho)}
            >
              <span aria-hidden="true">+</span>
            </button>
          )}
        </div>
        {!recolhido && (
          <>
            <div className="arm-summary">
              <div><strong data-testid="text-total-areas">{areas.length}</strong><span>locais mapeados</span></div>
              <div className={alertas.length ? 'arm-alert-count arm-alert-count-active' : 'arm-alert-count'}>
                <strong data-testid="text-total-alertas">{alertas.length}</strong><span>em alerta</span>
              </div>
            </div>
            <div className="arm-forecast-note" data-testid="text-fonte-previsao">
              Previsão acumulada em 24 h nas áreas de risco · Open-Meteo
            </div>
            <div className="arm-sound-note" data-testid="status-alerta-sonoro">
              {alertaSonoroAtivo
                ? alertas.length > 0
                  ? `Alerta ativo em ${alertas.length} área(s) · repetição sonora a cada 15 s`
                  : 'Som ligado · aguardando previsão acima do limite'
                : 'Som desligado'}
            </div>
            {alertas.length > 0 && (
              <div className="arm-alert-banner" role="status" data-testid="status-alerta-precipitacao">
                <span className="arm-alert-pulse" />
                <div><strong>ATENÇÃO · CHUVA ACIMA DO LIMITE</strong><span>{alertas.length} área(s) exigem acompanhamento</span></div>
              </div>
            )}
            <div className="arm-toolbar">
                <span>ÁREAS DE RISCO</span>
              <button type="button" onClick={iniciarCadastro} data-testid="button-nova-area" disabled={Boolean(rascunho)}>
                <span aria-hidden="true">+</span> {filtro === 'Interdições' ? 'Nova interdição' : 'Nova área'}
              </button>
            </div>
            {carregando ? (
              <div className="arm-loading" role="status" data-testid="status-carregando-areas">
                <i /><i /><i /> Atualizando áreas…
              </div>
            ) : (
              <>
                <div className="arm-map-layer-heading">
                  <div>
                    <span>TIPOS NO MAPA</span>
                  </div>
                  <button
                    type="button"
                    onClick={alternarTodosTiposNoMapa}
                    aria-label={todosTiposVisiveisNoMapa ? 'Ocultar todas as classificações do mapa' : 'Exibir todas as classificações no mapa'}
                    title={todosTiposVisiveisNoMapa ? 'Ocultar todas as classificações do mapa' : 'Exibir todas as classificações no mapa'}
                    data-testid="toggle-mapa-todas-areas"
                  >
                    {todosTiposVisiveisNoMapa ? 'Nenhuma' : 'Todas'}
                  </button>
                </div>
                <div className="arm-types" aria-label="Filtrar lista por tipo e selecionar tipos visíveis no mapa">
                  <button
                    type="button"
                    className={`arm-type-row arm-type-all${filtro === 'Todas' ? ' arm-type-selected' : ''}`}
                    onClick={() => setFiltro('Todas')}
                    aria-label="Filtrar lista por todas as áreas"
                    aria-pressed={filtro === 'Todas'}
                    data-testid="filter-area-todas"
                  >
                    <span className="arm-type-symbol">ALL</span><span className="arm-type-name">Todas as áreas</span><b>{areas.length}</b>
                  </button>
                  {TIPOS.map(tipo => {
                    const visivelNoMapa = tiposVisiveisNoMapa.has(tipo)
                    return (
                      <div className="arm-type-entry" key={tipo}>
                        <button
                          type="button"
                          className={`arm-type-row${filtro === tipo ? ' arm-type-selected' : ''}`}
                          onClick={() => setFiltro(tipo)}
                          aria-label={`Filtrar lista por ${tipo}`}
                          aria-pressed={filtro === tipo}
                          title={tipo}
                          data-testid={`filter-area-${TIPOS.indexOf(tipo)}`}
                        >
                          <span className="arm-type-symbol" style={{ '--arm-type-color': CORES[tipo] } as CSSProperties}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><g dangerouslySetInnerHTML={{ __html: ICONES[tipo] }} /></svg>
                          </span>
                          <span className="arm-type-name">{ROTULOS_TIPOS_COMPACTOS[tipo] ?? tipo}</span><b>{contagens[tipo]}</b>
                        </button>
                        <button
                          type="button"
                          className={`arm-map-toggle${visivelNoMapa ? ' arm-map-toggle-active' : ''}`}
                          onClick={() => alternarTipoNoMapa(tipo)}
                          aria-label={`${visivelNoMapa ? 'Ocultar' : 'Exibir'} áreas de ${tipo} no mapa`}
                          aria-pressed={visivelNoMapa}
                          title={`${visivelNoMapa ? 'Ocultar' : 'Exibir'} ${tipo} no mapa`}
                          data-testid={`toggle-mapa-area-${TIPOS.indexOf(tipo)}`}
                        >
                          <span aria-hidden="true">{visivelNoMapa ? '✓' : '—'}</span>
                        </button>
                      </div>
                    )
                  })}
                </div>
                {tiposVisiveisNoMapa.size === 0 && (
                  <div className="arm-map-layer-empty" role="status" data-testid="status-sem-tipos-no-mapa">
                    Nenhum tipo marcado: as áreas de risco estão ocultas no mapa.
                  </div>
                )}
              </>
            )}
            {areasVisiveis.length === 0 ? !carregando && (
              <div className="arm-empty" data-testid="status-sem-areas">
                <span className="arm-empty-rule" />
                <strong>
                  {filtro === 'Todas'
                    ? 'Nenhuma área cadastrada'
                    : filtro === 'Interdições'
                      ? 'Nenhuma interdição cadastrada'
                      : `Sem áreas de ${filtro.toLowerCase()}`}
                </strong>
                <span>Marque um ponto no mapa para cadastrar.</span>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="arm-list-toggle"
                  aria-expanded={listaAreasAberta}
                  aria-controls="arm-area-list"
                  onClick={() => setListaAreasAberta(value => !value)}
                  data-testid="toggle-lista-areas"
                >
                  <span>{listaAreasAberta ? 'Ocultar locais' : `Locais (${areasVisiveis.length})`}</span>
                  <span aria-hidden="true">{listaAreasAberta ? '−' : '+'}</span>
                </button>
                {listaAreasAberta && (
                  <div className="arm-area-list" id="arm-area-list" data-testid="list-areas-risco">
                    {areasVisiveis.map(area => {
                      const previsao = previsaoPorArea[area.id]
                      const alerta = previsao != null && Number.isFinite(previsao) && previsao > area.limite_precipitacao_mm
                      return (
                        <div className={`arm-area-row${alerta ? ' arm-area-row-alerta' : ''}`} key={area.id} data-testid={`row-area-${area.id}`}>
                          <span className="arm-area-color" style={{ backgroundColor: CORES[area.tipo] }} />
                          <div className="arm-area-copy">
                            <strong>{area.tipo}{alerta && <span className="arm-alert-tag">ALERTA</span>}</strong>
                            <span>{area.referencia || `Início ${formatarData(area.data_inicio)}`}</span>
                          </div>
                          <span className="arm-rain-value" data-testid={`status-previsao-area-${area.id}`}>
                            {area.tipo === 'Interdições'
                              ? area.ocorrencia_id != null ? `Ocorrência #${area.ocorrencia_id}` : 'Interdição'
                              : previsao == null ? '—' : formatarPrecipitacao(previsao)}
                          </span>
                          {area.ocorrencia_id != null ? (
                            <button
                              type="button"
                              aria-label={`Abrir ocorrência ${area.ocorrencia_id}`}
                              data-testid={`button-abrir-ocorrencia-lista-${area.id}`}
                              onClick={() => onAbrirOcorrencia?.(area.ocorrencia_id!)}
                            >
                              Abrir
                            </button>
                          ) : <>
                            <button type="button" aria-label={`Editar ${area.tipo}`} data-testid={`button-editar-lista-${area.id}`} onClick={() => abrirEdicao(area)}>Editar</button>
                            <button type="button" aria-label={`Excluir ${area.tipo}`} className="arm-delete-inline" data-testid={`button-excluir-lista-${area.id}`} onClick={() => abrirExclusao(area)}>×</button>
                          </>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
            {erro && <div className="arm-error" role="alert" data-testid="status-erro-servidor">{erro}</div>}
            {localErro && <div className="arm-error" role="alert" data-testid="status-erro-local">{localErro}</div>}
            {rascunho && (
              <div className="arm-form-card" ref={node => {
                if (node) L.DomEvent.disableClickPropagation(node)
              }}>
                <div className="arm-form-heading">
                  <div><span className="arm-eyebrow">{editandoId ? 'ATUALIZAÇÃO DE CADASTRO' : 'NOVO REGISTRO'}</span><h3>{editandoId ? 'Editar área de risco' : rascunho.tipo === 'Interdições' ? 'Cadastrar interdição' : 'Cadastrar área'}</h3></div>
                  <button type="button" aria-label="Fechar formulário" data-testid="button-fechar-formulario-area" onClick={fecharFormulario}>×</button>
                </div>
                <form onSubmit={salvar}>
                  <label className="arm-field">
                    <span>Tipo de registro</span>
                    <select
                      value={rascunho.tipo}
                      onChange={event => {
                        const tipo = event.target.value as TipoAreaRisco
                        atualizarRascunho({
                          tipo,
                          limite_precipitacao_mm: tipo === 'Interdições' ? '0' : rascunho.limite_precipitacao_mm === '0' ? '' : rascunho.limite_precipitacao_mm,
                        })
                      }}
                      data-testid="select-tipo-risco"
                    >
                      {TIPOS.map(tipo => <option key={tipo} value={tipo}>{tipo}</option>)}
                    </select>
                  </label>
                  <div className="arm-map-instructions">
                    <div className="arm-step-row"><b className={rascunho.latitude != null ? 'arm-step-done' : ''}>01</b><span>{rascunho.latitude == null ? 'Posicione o ponto de referência' : `${rascunho.latitude.toFixed(5)}, ${rascunho.longitude?.toFixed(5)}`}</span></div>
                    <button type="button" className={modoMapa === 'marcador' ? 'arm-map-action arm-map-action-active' : 'arm-map-action'} data-testid="button-marcar-localizacao" onClick={() => setModoMapa('marcador')}>Marcar no mapa</button>
                    <div className="arm-step-row"><b className={rascunho.poligono.length >= 3 ? 'arm-step-done' : ''}>02</b><span>Perímetro · opcional · {rascunho.poligono.length} vértice(s)</span></div>
                    <div className="arm-draw-actions">
                      <button type="button" className={modoMapa === 'poligono' ? 'arm-map-action arm-map-action-active' : 'arm-map-action'} disabled={rascunho.latitude == null} data-testid="button-desenhar-poligono" onClick={() => setModoMapa('poligono')}>Adicionar vértices</button>
                      <button type="button" className="arm-quiet-action" disabled={!rascunho.poligono.length} data-testid="button-desfazer-vertice" onClick={() => atualizarRascunho({ poligono: rascunho.poligono.slice(0, -1) })}>Desfazer</button>
                      <button type="button" className="arm-quiet-action" disabled={!rascunho.poligono.length} data-testid="button-limpar-poligono" onClick={() => atualizarRascunho({ poligono: [] })}>Limpar</button>
                    </div>
                    {modoMapa && <div className="arm-map-mode" role="status" data-testid="status-modo-mapa">{mapModeLabel}</div>}
                    {rascunho.poligono.length > 0 && <div className="arm-vertex-hint">Arraste os nós no mapa para ajustar o contorno.</div>}
                  </div>
                  <div className="arm-field-grid">
                    <label className="arm-field"><span>{rascunho.tipo === 'Interdições' ? 'Início da interdição' : 'Início do risco'}</span><input type="date" value={rascunho.data_inicio} onChange={event => atualizarRascunho({ data_inicio: event.target.value })} required data-testid="input-data-inicio" /></label>
                    {rascunho.tipo !== 'Interdições' && (
                      <label className="arm-field"><span>Limite de chuva <small>mm</small></span><input type="number" min="0" step="0.1" placeholder="Ex.: 35" value={rascunho.limite_precipitacao_mm} onChange={event => atualizarRascunho({ limite_precipitacao_mm: event.target.value })} required data-testid="input-limite-precipitacao" /></label>
                    )}
                  </div>
                  <label className="arm-field"><span>Referência local <small>opcional</small></span><input type="text" maxLength={120} placeholder="Rua, bairro ou ponto próximo" value={rascunho.referencia} onChange={event => atualizarRascunho({ referencia: event.target.value })} data-testid="input-referencia-local" /></label>
                  <label className="arm-field"><span>Observações <small>opcional</small></span><textarea rows={2} maxLength={500} placeholder="Condição observada, acesso ou orientação à equipe" value={rascunho.observacao} onChange={event => atualizarRascunho({ observacao: event.target.value })} data-testid="input-observacao-risco" /></label>
                  {(localErro || erro) && <div className="arm-error" role="alert" data-testid="status-erro-formulario">{localErro || erro}</div>}
                  <div className="arm-form-actions">
                    <button type="button" className="arm-cancel" data-testid="button-cancelar-area" disabled={salvando} onClick={fecharFormulario}>Cancelar</button>
                    <button type="submit" className="arm-submit" data-testid="button-salvar-area" disabled={salvando}>
                      {salvando ? 'Salvando…' : editandoId ? 'Salvar alterações' : 'Registrar área'}
                    </button>
                  </div>
                </form>
              </div>
            )}
            <div className="arm-panel-foot">
              <span className="arm-foot-dot" /> Operador: <strong>{agenteLogado || 'Não identificado'}</strong>
            </div>
          </>
        )}
      </div>,
      painelHost,
      )}
      {portao && (
        <ModalSenha
          titulo={portao.tipo === 'editar' ? 'Autorizar edição de área' : 'Autorizar exclusão de área'}
          senhaCorreta={senhaAgente || ''}
          onConfirmar={concluirAutorizacao}
          onCancelar={() => setPortao(null)}
        />
      )}
    </>
  )
}

