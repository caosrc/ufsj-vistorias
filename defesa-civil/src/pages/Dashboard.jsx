import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { FiMap, FiAlertTriangle, FiHome, FiClipboard, FiArrowLeft, FiRefreshCw } from 'react-icons/fi'
import { CIDADES } from '../data/cidades'
import { api } from '../services/api'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  const [stats, setStats] = useState({ ocorrencias: 0, vistorias: 0, imoveis: 0, areasRisco: 0 })
  const [recentOcorrencias, setRecentOcorrencias] = useState([])
  const [recentVistorias, setRecentVistorias] = useState([])
  const [clima, setClima] = useState(null)
  const [cidadeSelecionada, setCidadeSelecionada] = useState('ouro_branco')
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    loadTudo()
  }, [cidadeSelecionada])

  async function loadTudo() {
    setCarregando(true)
    await Promise.all([loadStats(), loadClima()])
    setCarregando(false)
  }

  async function loadStats() {
    try {
      const statsApi = await api.getStats()
      setStats({
        ocorrencias: statsApi.ocorrencias ?? 0,
        vistorias: statsApi.vistorias ?? 0,
        imoveis: statsApi.imoveis ?? 0,
        areasRisco: statsApi.areasRisco ?? statsApi.areas_risco ?? 0
      })
      const ocs = await api.getOcorrencias()
      setRecentOcorrencias(ocs.slice(0, 5))
      const vis = await api.getVistorias()
      setRecentVistorias(vis.slice(0, 5))
    } catch {
      const ocorrencias = JSON.parse(localStorage.getItem('ocorrencias') || '[]')
      const vistorias = JSON.parse(localStorage.getItem('vistorias') || '[]')
      const imoveis = JSON.parse(localStorage.getItem('imoveis') || '[]')
      const areasRisco = JSON.parse(localStorage.getItem('areasRisco') || '[]')
      setStats({
        ocorrencias: ocorrencias.length,
        vistorias: vistorias.length,
        imoveis: imoveis.length,
        areasRisco: areasRisco.length
      })
      setRecentOcorrencias(ocorrencias.slice(-5).reverse())
      setRecentVistorias(vistorias.slice(-5).reverse())
    }
  }

  async function loadClima() {
    const cidade = CIDADES[cidadeSelecionada]
    const [lng, lat] = cidade.center
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&forecast_days=1&timezone=America%2FSao_Paulo`
      )
      const data = await res.json()
      setClima(data.current)
    } catch (e) {
      console.error('Erro clima', e)
    }
  }

  function getWeatherDesc(code) {
    if (code === 0) return 'Tempo limpo'
    if (code <= 3) return 'Parcialmente nublado'
    if (code <= 48) return 'Nevoeiro'
    if (code <= 67) return 'Chuva'
    if (code <= 77) return 'Neve'
    if (code <= 82) return 'Chuva intensa'
    if (code <= 99) return 'Tempestade'
    return 'Desconhecido'
  }

  function getWeatherIcon(code) {
    if (code === 0) return '☀️'
    if (code <= 3) return '⛅'
    if (code <= 48) return '🌫️'
    if (code <= 67) return '🌧️'
    if (code <= 82) return '⛈️'
    if (code <= 99) return '🌩️'
    return '🌡️'
  }

  function getRiscoColor(risco) {
    const map = { R1: '#22c55e', R2: '#eab308', R3: '#f97316', R4: '#ef4444' }
    return map[risco] || '#64748b'
  }

  function getNivelColor(nivel) {
    const map = { baixo: '#22c55e', medio: '#eab308', alto: '#f97316', critico: '#ef4444' }
    return map[nivel] || '#64748b'
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Link to='/' className={styles.backBtn}>
            <FiArrowLeft /> Voltar ao Mapa
          </Link>
          <h1 className={styles.title}>
            <FiClipboard /> Painel Operacional
          </h1>
        </div>
        <div className={styles.headerRight}>
          <select
            className={styles.cidadeSelect}
            value={cidadeSelecionada}
            onChange={e => setCidadeSelecionada(e.target.value)}
          >
            {Object.values(CIDADES).map(c => (
              <option key={c.codigo} value={c.codigo}>{c.nome}</option>
            ))}
          </select>
          <button className={styles.refreshBtn} onClick={loadTudo} disabled={carregando}>
            <FiRefreshCw className={carregando ? styles.girando : ''} /> Atualizar
          </button>
        </div>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard} style={{ borderColor: '#ef4444' }}>
          <FiAlertTriangle size={28} color='#ef4444' />
          <div>
            <div className={styles.statNum}>{stats.ocorrencias}</div>
            <div className={styles.statLabel}>Ocorrências</div>
          </div>
        </div>
        <div className={styles.statCard} style={{ borderColor: '#3b82f6' }}>
          <FiClipboard size={28} color='#3b82f6' />
          <div>
            <div className={styles.statNum}>{stats.vistorias}</div>
            <div className={styles.statLabel}>Vistorias</div>
          </div>
        </div>
        <div className={styles.statCard} style={{ borderColor: '#10b981' }}>
          <FiHome size={28} color='#10b981' />
          <div>
            <div className={styles.statNum}>{stats.imoveis}</div>
            <div className={styles.statLabel}>Imóveis</div>
          </div>
        </div>
        <div className={styles.statCard} style={{ borderColor: '#f59e0b' }}>
          <FiMap size={28} color='#f59e0b' />
          <div>
            <div className={styles.statNum}>{stats.areasRisco}</div>
            <div className={styles.statLabel}>Áreas de Risco</div>
          </div>
        </div>
      </div>

      {clima && (
        <div className={styles.climaCard}>
          <h2>
            <span className={styles.climaIcon}>{getWeatherIcon(clima.weather_code)}</span>
            Condições Meteorológicas — {CIDADES[cidadeSelecionada].nome}
          </h2>
          <div className={styles.climaGrid}>
            <div className={styles.climaItem}>
              <span className={styles.climaLabel}>Temperatura</span>
              <span className={styles.climaVal}>{clima.temperature_2m}°C</span>
            </div>
            <div className={styles.climaItem}>
              <span className={styles.climaLabel}>Umidade</span>
              <span className={styles.climaVal}>{clima.relative_humidity_2m}%</span>
            </div>
            <div className={styles.climaItem}>
              <span className={styles.climaLabel}>Precipitação</span>
              <span className={styles.climaVal}>{clima.precipitation} mm</span>
            </div>
            <div className={styles.climaItem}>
              <span className={styles.climaLabel}>Vento</span>
              <span className={styles.climaVal}>{clima.wind_speed_10m} km/h</span>
            </div>
            <div className={styles.climaItem}>
              <span className={styles.climaLabel}>Condição</span>
              <span className={styles.climaVal}>{getWeatherDesc(clima.weather_code)}</span>
            </div>
          </div>
        </div>
      )}

      <div className={styles.tablesRow}>
        <div className={styles.tableCard}>
          <h2><FiAlertTriangle /> Últimas Ocorrências</h2>
          {recentOcorrencias.length === 0 ? (
            <p className={styles.empty}>Nenhuma ocorrência registrada.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Nível</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {recentOcorrencias.map((oc, i) => (
                  <tr key={oc.id || i}>
                    <td>{oc.tipo}</td>
                    <td>
                      <span className={styles.badge} style={{ background: getNivelColor(oc.nivel) }}>
                        {oc.nivel}
                      </span>
                    </td>
                    <td>{oc.data ? new Date(oc.data).toLocaleDateString('pt-BR') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={styles.tableCard}>
          <h2><FiClipboard /> Últimas Vistorias</h2>
          {recentVistorias.length === 0 ? (
            <p className={styles.empty}>Nenhuma vistoria registrada.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Responsável</th>
                  <th>Risco</th>
                  <th>Solo</th>
                </tr>
              </thead>
              <tbody>
                {recentVistorias.map((v, i) => (
                  <tr key={v.id || i}>
                    <td>{v.nome || '-'}</td>
                    <td>
                      <span className={styles.badge} style={{ background: getRiscoColor(v.risco) }}>
                        {v.risco || '-'}
                      </span>
                    </td>
                    <td>{v.solo || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
