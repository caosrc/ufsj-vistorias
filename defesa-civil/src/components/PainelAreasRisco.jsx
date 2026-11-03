import { useEffect, useRef, useState } from 'react'
import {
  FiAlertTriangle, FiCloudRain, FiVolume2, FiVolumeX, FiPlus,
  FiRefreshCw, FiMapPin, FiEdit2, FiTrash2,
} from 'react-icons/fi'
import { CORES_AREAS_RISCO, ICONES_AREAS_RISCO, TIPOS_AREAS_RISCO } from '../data/areasRisco'
import styles from './PainelAreasRisco.module.css'

const SOUND_KEY = 'geovistorias:alerta-sonoro-areas-risco'

function lerSomSalvo() {
  try {
    const salvo = localStorage.getItem(SOUND_KEY)
    return salvo == null || salvo === 'true'
  } catch { return true }
}

function formatarChuva(valor) {
  return valor == null || !Number.isFinite(Number(valor))
    ? 'Sem previsão'
    : `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm`
}

function formatarAtualizacao(valor) {
  if (!valor) return 'Atualização não disponível'
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return 'Atualização não disponível'
  return `Atualizado às ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

export default function PainelAreasRisco({
  aberto,
  nomeCidade,
  areas,
  previsoes,
  atualizadoEm,
  carregando,
  erro,
  aoFechar,
  aoNovaArea,
  aoEditarArea,
  aoRemoverArea,
  aoAtualizar,
  aoFocarArea,
  status,
}) {
  const [somAtivo, setSomAtivo] = useState(lerSomSalvo)
  const audioRef = useRef(null)
  const alertas = areas.filter(area => {
    if (area.tipo === 'Interdições') return false
    const previsto = Number(previsoes?.[area.id])
    const limite = Number(area.limite_precipitacao_mm)
    return Number.isFinite(previsto) && Number.isFinite(limite) && previsto > limite
  })

  async function emitirSom() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass) return
      audioRef.current ??= new AudioContextClass()
      const context = audioRef.current
      if (context.state === 'suspended') await context.resume()
      if (context.state !== 'running') return
      const oscillator = context.createOscillator()
      const volume = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 880
      volume.gain.setValueAtTime(0.0001, context.currentTime)
      volume.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.04)
      volume.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.38)
      oscillator.connect(volume)
      volume.connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.4)
    } catch { /* Som depende do suporte e da permissão do navegador. */ }
  }

  function alternarSom() {
    const proximo = !somAtivo
    setSomAtivo(proximo)
    try { localStorage.setItem(SOUND_KEY, String(proximo)) } catch {}
    if (proximo && alertas.length) void emitirSom()
  }

  useEffect(() => {
    if (!somAtivo || alertas.length === 0) return undefined
    void emitirSom()
    const timer = window.setInterval(() => { void emitirSom() }, 15000)
    const liberarAudio = () => {
      void emitirSom()
    }
    window.addEventListener('pointerdown', liberarAudio)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pointerdown', liberarAudio)
    }
  }, [somAtivo, alertas.map(area => area.id).sort().join('|')])

  useEffect(() => () => {
    if (audioRef.current && audioRef.current.state !== 'closed') void audioRef.current.close()
  }, [])

  const contagemPorTipo = TIPOS_AREAS_RISCO
    .map(tipo => ({ tipo, quantidade: areas.filter(area => area.tipo === tipo).length }))
    .filter(item => item.quantidade > 0)

  if (!aberto) return null

  return (
    <section className={styles.panel} aria-label="Áreas de risco e previsão de chuva">
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.icon}><FiCloudRain /></span>
          <div>
            <h2>Áreas de risco</h2>
            <span>{nomeCidade} · previsão para 24 h</span>
          </div>
        </div>
        <button className={styles.close} onClick={aoFechar} aria-label="Fechar painel">×</button>
      </header>

      <div className={styles.summary}>
        <div className={styles.updated}>
          {carregando && <FiRefreshCw className={styles.spinning} />}
          <span>{formatarAtualizacao(atualizadoEm)}</span>
          <span>Fonte: Open-Meteo</span>
        </div>
        <div className={`${styles.alertCount} ${alertas.length ? styles.alertCountActive : ''}`}>
          <FiAlertTriangle />
          <strong>{alertas.length}</strong>
          <span>{alertas.length === 1 ? 'área em alerta' : 'áreas em alerta'}</span>
        </div>
      </div>

      {alertas.length > 0 && (
        <div className={styles.alertBanner} role="status">
          <strong>CHUVA ACIMA DO LIMITE</strong>
          <span>{alertas.length} área(s) exigem acompanhamento em {nomeCidade}.</span>
        </div>
      )}

      {erro && (
        <div className={styles.warning} role="status">
          {atualizadoEm
            ? 'Previsão indisponível no momento. Exibindo a última previsão salva neste dispositivo.'
            : 'Não foi possível consultar a previsão. Os limites continuam salvos.'}
        </div>
      )}

      {status && <div className={styles.status} role="status">{status}</div>}

      <div className={styles.actions}>
        <button className={styles.primary} onClick={aoNovaArea}><FiPlus /> Desenhar área</button>
        <button className={styles.iconButton} onClick={aoAtualizar} disabled={carregando} title="Atualizar previsão" aria-label="Atualizar previsão">
          <FiRefreshCw className={carregando ? styles.spinning : ''} />
        </button>
        <button
          className={`${styles.iconButton} ${somAtivo ? styles.soundActive : ''}`}
          onClick={alternarSom}
          title={somAtivo ? 'Desativar alerta sonoro' : 'Ativar alerta sonoro'}
          aria-label={somAtivo ? 'Desativar alerta sonoro' : 'Ativar alerta sonoro'}
          aria-pressed={somAtivo}
        >
          {somAtivo ? <FiVolume2 /> : <FiVolumeX />}
        </button>
      </div>

      <div className={styles.listHeader}>
        <span>Áreas cadastradas</span>
        <strong>{areas.length}</strong>
      </div>
      {contagemPorTipo.length > 0 && (
        <div className={styles.typeCounts} aria-label="Quantidade por tipo de área">
          {contagemPorTipo.map(({ tipo, quantidade }) => (
            <span key={tipo} title={tipo}>
              <i style={{ background: CORES_AREAS_RISCO[tipo] || '#64748b' }}>
                {ICONES_AREAS_RISCO[tipo]}
              </i>
              {quantidade}
            </span>
          ))}
        </div>
      )}
      {areas.length === 0 ? (
        <div className={styles.empty}>
          <FiMapPin />
          <span>Nenhuma área cadastrada para {nomeCidade}.</span>
          <small>Desenhe um polígono no mapa e defina o limite de chuva.</small>
        </div>
      ) : (
        <div className={styles.list}>
          {areas.map(area => {
            const chuva = previsoes?.[area.id]
            const limite = Number(area.limite_precipitacao_mm)
            const emAlerta = area.tipo !== 'Interdições'
              && Number.isFinite(Number(chuva))
              && Number(chuva) > limite
            return (
              <article
                className={`${styles.areaRow} ${emAlerta ? styles.areaRowAlert : ''}`}
                key={area.id}
              >
                <button type="button" className={styles.areaMain} onClick={() => aoFocarArea(area)}>
                  <span className={styles.typeIcon} style={{ background: CORES_AREAS_RISCO[area.tipo] || '#d97706' }}>
                    {ICONES_AREAS_RISCO[area.tipo] || '⚠'}
                  </span>
                  <span className={styles.areaDetails}>
                    <strong>{area.tipo || 'Área de risco'}{emAlerta && <em>ALERTA</em>}</strong>
                    <span>{area.referencia || area.descricao || 'Sem referência local'}</span>
                    <small>
                      {area.tipo === 'Interdições'
                        ? 'Interdição cadastrada'
                        : `Limite ${formatarChuva(limite)} · Previsto ${formatarChuva(chuva)}`}
                    </small>
                  </span>
                  <FiMapPin className={styles.pin} />
                </button>
                <div className={styles.areaActions}>
                  <button
                    type="button"
                    className={styles.areaAction}
                    onClick={() => aoEditarArea(area)}
                    title={`Editar ${area.tipo || 'área de risco'}`}
                    aria-label={`Editar ${area.tipo || 'área de risco'}`}
                  >
                    <FiEdit2 /><span>Editar</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.areaAction} ${styles.areaActionDanger}`}
                    onClick={() => aoRemoverArea(area)}
                    title={`Remover ${area.tipo || 'área de risco'}`}
                    aria-label={`Remover ${area.tipo || 'área de risco'}`}
                  >
                    <FiTrash2 /><span>Remover</span>
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
      <footer className={styles.footer}>
        {somAtivo
          ? alertas.length ? 'Alerta sonoro ativo · repetição a cada 15 s' : 'Som ativo · aguardando previsão acima do limite'
          : 'Alertas visuais ativos · som desligado'}
      </footer>
    </section>
  )
}
