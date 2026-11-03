
import { useCallback, useEffect, useState } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import type { Map as LeafletMap } from 'leaflet'

export const MINAS_GERAIS_BOUNDS: [[number, number], [number, number]] = [
  [-22.92, -51.05],
  [-14.22, -39.85],
]

export interface EstacaoCemadenMg {
  id: number
  nome: string
  municipio: string
  codigo: string
  latitude: number | null
  longitude: number | null
  precipitacaoAtual: number | null
  precipitacaoDataHora: string
}

export interface DadosCemadenMg {
  sucesso: true
  estacoes: EstacaoCemadenMg[]
  totalEstacoes: number
  estacoesGeorreferenciadas: number
  estacoesSemCoordenadas: number
  atualizadoEm: string
  fonte: string
}

function numeroOuNulo(valor: unknown): number | null {
  if (valor == null || valor === '') return null
  const numero = Number(valor)
  return Number.isFinite(numero) ? numero : null
}

export function useEstacoesCemadenMg(habilitado: boolean) {
  const [dados, setDados] = useState<DadosCemadenMg | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    if (!habilitado) return
    setCarregando(true)
    try {
      const resposta = await fetch(`/api/monitoramento-mg?_ts=${Date.now()}`, { cache: 'no-store' })
      const corpo = await resposta.json().catch(() => ({}))
      if (!resposta.ok || corpo?.sucesso !== true || !Array.isArray(corpo?.estacoes)) {
        throw new Error(typeof corpo?.erro === 'string' ? corpo.erro : 'Estações CEMADEN de Minas Gerais indisponíveis')
      }
      const estacoes = corpo.estacoes.map((estacao: Record<string, unknown>) => ({
        id: Number(estacao.id),
        nome: String(estacao.nome || ''),
        municipio: String(estacao.municipio || ''),
        codigo: String(estacao.codigo || ''),
        latitude: numeroOuNulo(estacao.latitude),
        longitude: numeroOuNulo(estacao.longitude),
        precipitacaoAtual: numeroOuNulo(estacao.precipitacaoAtual),
        precipitacaoDataHora: String(estacao.precipitacaoDataHora || ''),
      })).filter((estacao: EstacaoCemadenMg) => Number.isFinite(estacao.id))

      setDados({
        sucesso: true,
        estacoes,
        totalEstacoes: Number(corpo.totalEstacoes) || estacoes.length,
        estacoesGeorreferenciadas: Number(corpo.estacoesGeorreferenciadas) || estacoes.filter(
          estacao => estacao.latitude != null && estacao.longitude != null,
        ).length,
        estacoesSemCoordenadas: Number(corpo.estacoesSemCoordenadas) || 0,
        atualizadoEm: String(corpo.atualizadoEm || ''),
        fonte: String(corpo.fonte || 'CEMADEN'),
      })
      setErro('')
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Estações CEMADEN de Minas Gerais indisponíveis')
    } finally {
      setCarregando(false)
    }
  }, [habilitado])

  useEffect(() => {
    if (!habilitado) return
    void carregar()
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === 'visible') void carregar()
    }, 5 * 60 * 1000)
    return () => window.clearInterval(intervalo)
  }, [habilitado, carregar])

  return { dados, carregando, erro, atualizar: carregar }
}

export function CapturaEstadoMapa({
  referencia,
  aoMudarZoom,
}: {
  referencia: { current: LeafletMap | null }
  aoMudarZoom: (zoom: number) => void
}) {
  const mapaAtual = useMap()
  useMapEvents({
    zoomend: () => aoMudarZoom(mapaAtual.getZoom()),
  })

  useEffect(() => {
    referencia.current = mapaAtual
    return () => {
      if (referencia.current === mapaAtual) referencia.current = null
    }
  }, [mapaAtual, referencia])

  return null
}

