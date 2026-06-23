import { useEffect, useState } from 'react'
import { CIDADES } from '../data/cidades'
import styles from './PainelClima.module.css'

function getWeatherIcon(code) {
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 48) return '🌫️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '❄️'
  if (code <= 82) return '🌧️'
  if (code <= 99) return '⛈️'
  return '🌡️'
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

export default function PainelClima({ cidade }) {
  const [clima, setClima] = useState(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    setLoading(true)
    setErro(null)
    const cidadeObj = CIDADES[cidade]
    if (!cidadeObj) { setLoading(false); return }
    const [lng, lat] = cidadeObj.center
    const API_URL = import.meta.env.VITE_API_URL ?? ''
    fetch(`${API_URL}/api/clima?lat=${lat}&lng=${lng}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(data => {
        if (data.error) throw new Error(data.error)
        setClima(data)
        setLoading(false)
      })
      .catch(() => {
        setErro('Erro ao carregar clima')
        setLoading(false)
      })
  }, [cidade])

  if (loading) return (
    <div className={styles.card}>
      <div className={styles.loading}>Carregando clima...</div>
    </div>
  )

  if (erro) return (
    <div className={styles.card}>
      <div className={styles.erro}>{erro}</div>
    </div>
  )

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.icon}>{getWeatherIcon(clima.weather_code)}</span>
        <div>
          <div className={styles.temp}>{clima.temperature_2m}°C</div>
          <div className={styles.desc}>{getWeatherDesc(clima.weather_code)}</div>
        </div>
      </div>
      <div className={styles.grid}>
        <div className={styles.item}>
          <span className={styles.label}>Sensação</span>
          <span className={styles.value}>{clima.apparent_temperature}°C</span>
        </div>
        <div className={styles.item}>
          <span className={styles.label}>Umidade</span>
          <span className={styles.value}>{clima.relative_humidity_2m}%</span>
        </div>
        <div className={styles.item}>
          <span className={styles.label}>Precipitação</span>
          <span className={styles.value}>{clima.precipitation} mm</span>
        </div>
        <div className={styles.item}>
          <span className={styles.label}>Vento</span>
          <span className={styles.value}>{clima.wind_speed_10m} km/h</span>
        </div>
      </div>
      <div className={styles.cidade}>{CIDADES[cidade]?.nome}</div>
    </div>
  )
}
