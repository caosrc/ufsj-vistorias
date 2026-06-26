import { useState, useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import MonitoramentoLayout from '../components/MonitoramentoLayout'
import { Line, Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import styles from './MonitoramentoEvolucao.module.css'
import { API_BASE, api } from '../services/api'

ChartJS.register(
  CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, Title, Tooltip, Legend, Filler
)

/* ── Plugin: diff labels entre pontos de anomalia ─────────── */
const diffLabelPlugin = {
  id: 'diffLabel',
  afterDatasetsDraw(chart) {
    if (chart.config.type === 'bar') return
    const { ctx } = chart
    chart.data.datasets.forEach((dataset, di) => {
      const meta = chart.getDatasetMeta(di)
      const data = dataset.data
      const nonNull = data.map((v, i) => v != null ? i : -1).filter(i => i !== -1)
      for (let k = 1; k < nonNull.length; k++) {
        const iCurr = nonNull[k]
        const iPrev = nonNull[k - 1]
        const curr = data[iCurr], prev = data[iPrev]
        if (curr == null || prev == null) continue
        const diff = curr - prev
        const point = meta.data[iCurr]
        if (!point) continue
        const sign = diff > 0 ? '+' : ''
        ctx.save()
        ctx.font = 'bold 11px sans-serif'
        ctx.fillStyle = diff > 0 ? '#c0392b' : diff < 0 ? '#27ae60' : '#555'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(`${sign}${diff.toFixed(2).replace('.', ',')} mm`, point.x, point.y - 8)
        ctx.restore()
      }
    })
  }
}

/* ── Plugin: linhas verticais nas datas de vistoria ───────── */
const vistoriaLinePlugin = {
  id: 'vistoriaLines',
  afterDraw(chart) {
    const dates = chart.options.plugins?.vistoriaLines?.dates
    if (!dates?.length) return
    const { ctx, chartArea, scales, data } = chart
    dates.forEach(d => {
      const idx = data.labels.indexOf(d)
      if (idx === -1) return
      const x = scales.x.getPixelForValue(idx)
      ctx.save()
      ctx.strokeStyle = 'rgba(37,99,235,0.55)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(x, chartArea.top)
      ctx.lineTo(x, chartArea.bottom)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#2563eb'
      ctx.font = 'bold 8px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('▼', x, chartArea.top + 9)
      ctx.restore()
    })
  }
}

ChartJS.register(diffLabelPlugin, vistoriaLinePlugin)

const sortAnomalyKeys = (a, b) =>
  parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10)

const PRECIP_KEY = 'precipitacoes_csv'

function addDays(date, n) {
  const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d
}
function toYMD(date) {
  const d = new Date(date)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
}
function toDMM(date) {
  const d = new Date(date)
  return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}`
}
function toDMY(date) {
  const d = new Date(date)
  return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`
}

function barColor(v, max) {
  const r = max > 0 ? v / max : 0
  if (r > 0.65) return 'rgba(220,38,38,0.88)'
  if (r > 0.35) return 'rgba(249,115,22,0.85)'
  if (r > 0.12) return 'rgba(20,184,166,0.82)'
  return 'rgba(96,165,250,0.75)'
}

export default function MonitoramentoEvolucao() {
  const { id } = useParams()
  const [imovel, setImovel] = useState(null)
  const [charts, setCharts] = useState([])
  const [loading, setLoading] = useState(true)
  const [precipData, setPrecipData] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PRECIP_KEY) || 'null') } catch { return null }
  })

  useEffect(() => {
    // Carrega imóvel e precipitação em paralelo
    const loadImovel = fetch(`${API_BASE}/monitoramento/${id}`)
      .then(r => r.json())
      .then(data => setImovel(data))
      .catch(() => {})

    const loadPrecip = api.getPrecipitacoes()
      .then(rec => {
        if (rec?.dados && Object.keys(rec.dados).length > 0) {
          setPrecipData(rec.dados)
          localStorage.setItem(PRECIP_KEY, JSON.stringify(rec.dados))
        }
      })
      .catch(() => {})

    Promise.all([loadImovel, loadPrecip]).finally(() => setLoading(false))
  }, [id])

  /* ── Intervalo completo de datas (compartilhado entre gráficos) ── */
  const fullDays = useMemo(() => {
    if (!imovel?.relatoriosSalvos?.length) return []
    const reportDates = [...imovel.relatoriosSalvos]
      .map(r => new Date(r.createdAt))
      .sort((a, b) => a - b)
    const minDate = reportDates[0]
    const maxDate = reportDates[reportDates.length - 1]
    const days = []
    const cur = new Date(minDate); cur.setUTCHours(0, 0, 0, 0)
    const end = new Date(maxDate); end.setUTCHours(23, 59, 59, 999)
    while (cur <= end) {
      days.push({ label: toDMM(cur), ymd: toYMD(cur) })
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    return days
  }, [imovel])

  /* ── Datas de vistoria em DD/MM (para o gráfico de chuva) ────── */
  const vistoriaDMM = useMemo(() => {
    if (!imovel?.relatoriosSalvos?.length) return []
    return [...imovel.relatoriosSalvos]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(r => toDMM(new Date(r.createdAt)))
  }, [imovel])

  /* ── Datas de vistoria em DD/MM/AAAA (para gráficos de anomalia) */
  const vistoriaDMY = useMemo(() => {
    if (!imovel?.relatoriosSalvos?.length) return []
    return [...imovel.relatoriosSalvos]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(r => toDMY(new Date(r.createdAt)))
  }, [imovel])

  /* ── Gráficos de anomalias — labels = datas das vistorias ─────── */
  useEffect(() => {
    if (!imovel?.relatoriosSalvos?.length) { setCharts([]); return }

    const sorted = [...imovel.relatoriosSalvos].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    const labels = sorted.map(r => toDMY(new Date(r.createdAt)))

    const anomaliesMap = new Map()
    sorted.forEach(rel => {
      rel.fotosAnomalias?.forEach(foto => {
        const code = foto.codigoTrinca.toUpperCase()
        if (!anomaliesMap.has(code)) anomaliesMap.set(code, [])
        const existing = anomaliesMap.get(code)
        foto.linhas?.forEach((linha, li) => {
          const lineLabel = linha.nome ? `Medida ${linha.nome.toUpperCase()}` : `Linha ${li + 1}`
          if (!existing.some(l => l.index === li)) existing.push({ label: lineLabel, index: li })
        })
      })
    })

    const result = []
    const colors = [
      { bg: 'rgba(128,0,128,0.2)', border: 'purple' },
      { bg: 'rgba(255,165,0,0.2)', border: 'orange' },
      { bg: 'rgba(0,128,0,0.2)', border: 'green' },
    ]

    Array.from(anomaliesMap.keys()).sort(sortAnomalyKeys).forEach(code => {
      const lines = anomaliesMap.get(code)

      lines.forEach(({ label, index }) => {
        let initAvg = undefined
        for (const rel of sorted) {
          const foto = rel.fotosAnomalias?.find(f => f.codigoTrinca.toUpperCase() === code)
          if (foto?.linhas?.[index]) {
            const valid = foto.linhas[index].comprimentos.filter(c => typeof c === 'number' && c > 0)
            if (valid.length) { initAvg = valid.reduce((a, b) => a + b, 0) / valid.length; break }
          }
        }

        const data = sorted.map(rel => {
          const foto = rel.fotosAnomalias?.find(f => f.codigoTrinca.toUpperCase() === code)
          if (!foto?.linhas?.[index]) return null
          const valid = foto.linhas[index].comprimentos.filter(c => typeof c === 'number' && c > 0)
          if (!valid.length || initAvg === undefined) return null
          return valid.reduce((a, b) => a + b, 0) / valid.length - initAvg
        })

        const c = colors[index % colors.length]
        result.push({
          anomalyId: code, lineLabel: label,
          chartData: {
            labels,
            datasets: [{
              label,
              data,
              backgroundColor: c.bg,
              borderColor: c.border,
              borderWidth: 2,
              fill: false,
              spanGaps: true,
              pointRadius: data.map(v => v != null ? 5 : 0),
            }]
          }
        })
      })
    })
    setCharts(result)
  }, [imovel])

  /* ── Dados do gráfico de precipitação ─────────────────────── */
  const precipChartData = useMemo(() => {
    if (!precipData || !fullDays.length) return null
    const values  = fullDays.map(d => precipData[d.ymd] ? Math.round(precipData[d.ymd] * 10) / 10 : 0)
    const maxVal  = Math.max(...values, 0.1)
    const colors  = values.map(v => barColor(v, maxVal))
    return {
      labels: fullDays.map(d => d.label),
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: colors.map(c => c.replace(/[\d.]+\)$/, '1)')),
        borderWidth: 1,
        borderRadius: 2,
        borderSkipped: false,
        categoryPercentage: 0.85,
        barPercentage: 0.9,
      }]
    }
  }, [precipData, fullDays])

  /* ── Opções do gráfico de precipitação ────────────────────── */
  const precipOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: { left: 0, right: 0 } },
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: {
        callbacks: {
          title: ([ctx]) => ctx.label,
          label: ctx => `${ctx.parsed.y.toFixed(1)} mm`,
        }
      },
      vistoriaLines: { dates: vistoriaDMM },
    },
    scales: {
      y: {
        beginAtZero: true,
        afterFit(scale) { scale.width = 55 },
        ticks: { display: false },
        title: { display: true, text: 'mm', font: { size: 9 }, color: '#9ca3af' },
        grid: { color: 'rgba(0,0,0,0.04)' },
      },
      x: {
        offset: false,
        ticks: {
          font: { size: 9 },
          maxRotation: 0,
          minRotation: 0,
          autoSkip: false,
          color: (ctx) => {
            const label = precipChartData?.labels?.[ctx.index] ?? ''
            return vistoriaDMM.includes(label) ? '#1d4ed8' : '#d1d5db'
          },
          callback: function (val) {
            const label = this.getLabelForValue(val)
            return vistoriaDMM.includes(label) ? label : ''
          },
        },
        grid: { display: false },
      }
    }
  }), [vistoriaDMM, precipChartData])

  /* ── Opções dos gráficos de anomalia ─────────────────────── */
  const chartOptions = (anomalyId, lineLabel) => ({
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { left: 0, right: 0 } },
    scales: {
      y: {
        min: -25, max: 50,
        afterFit(scale) { scale.width = 55 },
        ticks: { stepSize: 5 },
        title: { display: true, text: 'Variação da Abertura (mm)' }
      },
      x: {
        ticks: {
          font: { size: 10 },
          maxRotation: 45,
          minRotation: 0,
          color: '#1d4ed8',
        },
        title: { display: true, text: 'Data da Vistoria' },
        grid: { display: false },
      }
    },
    plugins: {
      legend: { display: true, position: 'top' },
      title: { display: true, text: `Monitoramento ${anomalyId} - ${lineLabel}`, font: { size: 16 } },
      tooltip: {
        callbacks: {
          label: ctx => ctx.parsed.y !== null
            ? `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2).replace('.', ',')} mm`
            : 'Sem Medição'
        }
      },
      vistoriaLines: { dates: vistoriaDMY },
    }
  })

  if (loading) return <MonitoramentoLayout><div className={styles.loading}>Carregando...</div></MonitoramentoLayout>

  const hasPrecip = !!precipChartData

  return (
    <MonitoramentoLayout>
      {/* ── Cabeçalho ─────────────────────────────────────────── */}
      <div className={styles.header}>
        <div>
          <Link to={`/monitoramento/${id}`} className={styles.backLink}>← Voltar para {imovel?.proprietario}</Link>
          <h1 className={styles.title}>Gráfico de Evolução das Anomalias</h1>
          <p className={styles.subtitle}>Evolução individual das linhas de cada anomalia ao longo do tempo.</p>
        </div>
        <button className={styles.btnPrint} onClick={() => window.print()}>🖨️ Imprimir / PDF</button>
      </div>

      {/* ── Gráfico de precipitação — STICKY ─────────────────── */}
      {hasPrecip && (
        <div className={styles.precipWrap}>
          <div className={styles.precipHeader}>
            <span className={styles.precipTitle}>🌧️ Precipitação Diária (mm)</span>
            <span className={styles.precipLegend}>
              <span className={styles.dot} style={{ background: 'rgba(220,38,38,0.88)' }} /> Alta &nbsp;
              <span className={styles.dot} style={{ background: 'rgba(249,115,22,0.85)' }} /> Média &nbsp;
              <span className={styles.dot} style={{ background: 'rgba(20,184,166,0.82)' }} /> Baixa &nbsp;
              <span className={styles.dot} style={{ background: 'rgba(96,165,250,0.75)' }} /> Mínima &nbsp;
              <span className={styles.dot} style={{ background: 'rgba(37,99,235,0.55)', borderRadius: 0, width: 1, height: 10 }} /> Vistoria
            </span>
          </div>
          <div className={styles.precipChart}>
            <Bar options={precipOptions} data={precipChartData} />
          </div>
        </div>
      )}

      {/* ── Gráficos de anomalias ─────────────────────────────── */}
      {charts.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>📊</div>
          <h3>Dados insuficientes</h3>
          <p>É necessário ter pelo menos um relatório com anomalias e medições de linhas.</p>
          <Link to={`/monitoramento/${id}/novo-relatorio`} className={styles.btnNew}>Criar Relatório</Link>
        </div>
      ) : (
        <div className={styles.chartsGrid}>
          {charts.map(({ anomalyId, lineLabel, chartData }) => (
            <div key={`${anomalyId}-${lineLabel}`} className={styles.chartCard}>
              <div style={{ position: 'relative', height: 400 }}>
                <Line options={chartOptions(anomalyId, lineLabel)} data={chartData} />
              </div>
            </div>
          ))}
        </div>
      )}
    </MonitoramentoLayout>
  )
}
