import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { FiArrowLeft, FiClipboard, FiSave, FiTrash2, FiMapPin,
         FiDownload, FiBarChart2, FiCheckCircle, FiAlertTriangle } from 'react-icons/fi'
import { api } from '../services/api'
import styles from './Vistoria.module.css'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

// ── SVG: Casas R1–R4 ───────────────────────────────────────────
function CasaR1() {
  return (
    <svg viewBox="0 0 80 70" width="70" height="62">
      <polygon points="5,55 75,55 75,35 40,12 5,35" fill="#166534" stroke="#22c55e" strokeWidth="1.5"/>
      <rect x="15" y="35" width="18" height="20" rx="1" fill="#14532d" stroke="#22c55e" strokeWidth="1"/>
      <rect x="47" y="38" width="11" height="11" rx="1" fill="#bbf7d0" opacity="0.8"/>
      <line x1="4" y1="55" x2="76" y2="55" stroke="#22c55e" strokeWidth="2"/>
      <line x1="2" y1="57" x2="78" y2="60" stroke="#15803d" strokeWidth="3" strokeLinecap="round"/>
      <text x="40" y="68" textAnchor="middle" fill="#4ade80" fontSize="9" fontWeight="bold">~10–15°</text>
    </svg>
  )
}
function CasaR2() {
  return (
    <svg viewBox="0 0 80 70" width="70" height="62">
      <g transform="rotate(-8,40,50)">
        <polygon points="5,55 75,55 75,35 40,12 5,35" fill="#713f12" stroke="#eab308" strokeWidth="1.5"/>
        <rect x="15" y="35" width="18" height="20" rx="1" fill="#422006" stroke="#eab308" strokeWidth="1"/>
        <rect x="47" y="38" width="11" height="11" rx="1" fill="#fef08a" opacity="0.8"/>
        <line x1="15" y1="52" x2="60" y2="53" stroke="#eab308" strokeWidth="1" strokeDasharray="3,2"/>
      </g>
      <line x1="2" y1="62" x2="78" y2="65" stroke="#a16207" strokeWidth="3" strokeLinecap="round"/>
      <text x="40" y="69" textAnchor="middle" fill="#facc15" fontSize="9" fontWeight="bold">~25–30°</text>
    </svg>
  )
}
function CasaR3() {
  return (
    <svg viewBox="0 0 80 72" width="70" height="62">
      <g transform="rotate(-22,40,52)">
        <polygon points="5,55 75,55 75,35 40,12 5,35" fill="#7c2d12" stroke="#f97316" strokeWidth="1.5"/>
        <rect x="15" y="35" width="18" height="20" rx="1" fill="#431407" stroke="#f97316" strokeWidth="1"/>
        <rect x="47" y="38" width="11" height="11" rx="1" fill="#fed7aa" opacity="0.8"/>
        <line x1="12" y1="48" x2="14" y2="58" stroke="#f97316" strokeWidth="1.5"/>
        <line x1="40" y1="30" x2="42" y2="40" stroke="#f97316" strokeWidth="1.5"/>
        <line x1="65" y1="48" x2="67" y2="58" stroke="#f97316" strokeWidth="1.5"/>
      </g>
      <line x1="2" y1="64" x2="78" y2="70" stroke="#9a3412" strokeWidth="3" strokeLinecap="round"/>
      <text x="40" y="71" textAnchor="middle" fill="#fb923c" fontSize="9" fontWeight="bold">~40–45°</text>
    </svg>
  )
}
function CasaR4() {
  return (
    <svg viewBox="0 0 80 72" width="70" height="62">
      <polygon points="8,62 30,40 55,58 72,38 78,62" fill="#7f1d1d" stroke="#ef4444" strokeWidth="1.5"/>
      <polygon points="25,40 55,58 30,58" fill="#450a0a" stroke="#ef4444" strokeWidth="1"/>
      <rect x="48" y="50" width="12" height="10" rx="1" fill="#fecaca" opacity="0.6" transform="rotate(25,54,55)"/>
      <line x1="8" y1="65" x2="30" y2="60" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="2,2"/>
      <line x1="30" y1="60" x2="55" y2="63" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="2,2"/>
      <line x1="2" y1="66" x2="78" y2="70" stroke="#991b1b" strokeWidth="3" strokeLinecap="round"/>
      <text x="40" y="71" textAnchor="middle" fill="#f87171" fontSize="9" fontWeight="bold">&gt;45°</text>
    </svg>
  )
}

// ── SVG: Tipos de Talude ────────────────────────────────────────
function TaludeNatural() {
  return (
    <svg viewBox="0 0 80 55" width="72" height="50">
      <polygon points="2,50 78,50 78,30 45,8 2,30" fill="#14532d" opacity="0.4" stroke="none"/>
      <path d="M2,50 Q20,28 45,18 Q62,10 78,15" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round"/>
      {[10,22,35,50,62,73].map((x,i) => (
        <g key={i} transform={`translate(${x},${[38,30,24,22,20,24][i]})`}>
          <line x1="0" y1="0" x2="0" y2="-7" stroke="#22c55e" strokeWidth="1.5"/>
          <circle cx="-3" cy="-9" r="3" fill="#16a34a" opacity="0.8"/>
          <circle cx="3" cy="-10" r="2.5" fill="#15803d" opacity="0.8"/>
        </g>
      ))}
      <line x1="2" y1="50" x2="78" y2="50" stroke="#4ade80" strokeWidth="1.5"/>
    </svg>
  )
}
function TaludeCorte() {
  return (
    <svg viewBox="0 0 80 55" width="72" height="50">
      <polygon points="2,50 50,50 50,10 2,10" fill="#78350f" opacity="0.35" stroke="none"/>
      <line x1="2" y1="50" x2="50" y2="50" stroke="#eab308" strokeWidth="2"/>
      <line x1="50" y1="50" x2="50" y2="10" stroke="#eab308" strokeWidth="2.5"/>
      <line x1="50" y1="10" x2="78" y2="10" stroke="#eab308" strokeWidth="2"/>
      <line x1="40" y1="10" x2="40" y2="30" stroke="#f97316" strokeWidth="1" strokeDasharray="3,2"/>
      <text x="25" y="33" textAnchor="middle" fill="#fbbf24" fontSize="8">solo</text>
      <text x="64" y="20" textAnchor="middle" fill="#fbbf24" fontSize="8">topo</text>
      <path d="M56,10 L56,20 L78,20" fill="none" stroke="#eab308" strokeWidth="1" opacity="0.5"/>
    </svg>
  )
}
function AlertaLancado() {
  return (
    <svg viewBox="0 0 80 55" width="72" height="50">
      <path d="M2,50 Q25,35 50,15 Q65,8 78,12" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round"/>
      {[15,28,42,56,68].map((x,i)=>(
        <polygon key={i} points={`${x},${[42,32,24,20,21][i]} ${x+5},${[38,28,20,16,17][i]} ${x+10},${[44,34,26,22,23][i]}`} fill="#f97316" opacity="0.7"/>
      ))}
      <line x1="2" y1="50" x2="78" y2="50" stroke="#7c2d12" strokeWidth="2"/>
      <text x="40" y="52" textAnchor="middle" fill="#fb923c" fontSize="8">detritos lançados</text>
    </svg>
  )
}
function ParedRochosa() {
  return (
    <svg viewBox="0 0 80 55" width="72" height="50">
      <rect x="25" y="8" width="30" height="42" rx="2" fill="#374151" stroke="#9ca3af" strokeWidth="1.5"/>
      {[[25,18,55,18],[25,28,55,28],[25,38,55,38]].map(([x1,y1,x2,y2],i)=>
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6b7280" strokeWidth="0.8"/>)}
      {[[25,8,37,18],[37,8,55,18],[25,18,33,28],[33,18,55,28],[25,28,41,38],[41,28,55,38]].map(([x1,y1,x2,y2],i)=>
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6b7280" strokeWidth="0.5"/>)}
      <path d="M2,50 L25,50 L25,8 L2,8" fill="#1f2937" stroke="#4b5563" strokeWidth="1"/>
      <path d="M55,8 L55,50 L78,50 L78,8" fill="#1f2937" stroke="#4b5563" strokeWidth="1"/>
      <line x1="2" y1="50" x2="78" y2="50" stroke="#6b7280" strokeWidth="2"/>
    </svg>
  )
}
function BlocosRocha() {
  return (
    <svg viewBox="0 0 80 55" width="72" height="50">
      <path d="M2,50 Q40,38 78,42" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round"/>
      {[[10,44,12],[25,35,16],[42,40,10],[55,32,18],[70,38,12]].map(([x,y,s],i)=>(
        <polygon key={i} points={`${x},${y} ${x+s},${y-4} ${x+s},${y}`} fill="#374151" stroke="#9ca3af" strokeWidth="1"/>
      ))}
      {[[8,45],[22,36],[40,41],[53,33],[68,39]].map(([x,y],i)=>(
        <ellipse key={i} cx={x} cy={y} rx={4} ry={3} fill="#4b5563" stroke="#9ca3af" strokeWidth="1"/>
      ))}
      <text x="40" y="53" textAnchor="middle" fill="#9ca3af" fontSize="8">matacões</text>
    </svg>
  )
}

const TIPOS_TALUDE = [
  { id:'natural', label:'Talude Natural',          Icone: TaludeNatural },
  { id:'corte',   label:'Talude de Corte',          Icone: TaludeCorte   },
  { id:'alerta',  label:'Alerta Lançado',           Icone: AlertaLancado },
  { id:'rocha',   label:'Parede Rochosa',           Icone: ParedRochosa  },
  { id:'blocos',  label:'Blocos de Rocha/Matacões', Icone: BlocosRocha   },
]

const COND_ENCOSTA = [
  { id:'estavel',  label:'Estável',        cor:'#22c55e', icon:'✅', desc:'Sem sinais de instabilidade' },
  { id:'atencao',  label:'Atenção',        cor:'#eab308', icon:'⚠️', desc:'Sinais de movimentação' },
  { id:'critico',  label:'Crítico',        cor:'#ef4444', icon:'🚨', desc:'Risco iminente — evacuação' },
]

const PROCESSOS = [
  { id:'rastejo',      label:'Rastejo / Creep',             icon:'🌀', desc:'Movimentação lenta e contínua' },
  { id:'transl',       label:'Escorregamento Translacional', icon:'↗️', desc:'Ruptura planar, blocos deslizantes' },
  { id:'rotat',        label:'Escorregamento Rotacional',    icon:'🔄', desc:'Ruptura circular / côncava' },
  { id:'queda',        label:'Queda / Tombamento de Blocos', icon:'🪨', desc:'Desprendimento de rocha ou solo' },
  { id:'corrida',      label:'Corrida de Lama/Detritos',    icon:'🌊', desc:'Fluxo rápido saturado' },
  { id:'subsidencia',  label:'Subsidência',                 icon:'⬇️', desc:'Recalque / afundamento do solo' },
]

const TIPOS_SOLO = [
  { id:'argiloso',  label:'Argiloso/Coeso',    cor:'#b45309', icon:'🟫' },
  { id:'arenoso',   label:'Arenoso/Granular',  cor:'#d97706', icon:'🟡' },
  { id:'rocha',     label:'Rocha',             cor:'#6b7280', icon:'⬛' },
  { id:'aterro',    label:'Aterro',            cor:'#78350f', icon:'🟤' },
  { id:'misto',     label:'Misto',             cor:'#059669', icon:'🟩' },
  { id:'organico',  label:'Orgânico/Turfoso',  cor:'#15803d', icon:'🌿' },
]

const TIPOS_USO = ['Residencial','Comercial','Institucional','Terreno vazio','Área rural']

const PATOLOGIAS = [
  { id:'trinca',     label:'Trinca nas Paredes',    icon:'🧱' },
  { id:'recalque',   label:'Recalque de Fundação',  icon:'🏗️' },
  { id:'umidade',    label:'Umidade/Infiltração',   icon:'💧' },
  { id:'erosao',     label:'Erosão no Terreno',     icon:'🌊' },
  { id:'talude',     label:'Instabilidade de Talude',icon:'⛰️' },
  { id:'cobertura',  label:'Cobertura Danificada',  icon:'🏠' },
  { id:'drenagem',   label:'Ausência de Drenagem',  icon:'🚧' },
  { id:'esgoto',     label:'Lançamento de Esgoto',  icon:'⚠️' },
  { id:'fundacao',   label:'Fundação Exposta',      icon:'🏛️' },
  { id:'vegetacao',  label:'Vegetação Inadequada',  icon:'🌱' },
  { id:'encosta',    label:'Encosta sem Contenção', icon:'🗻' },
  { id:'vizinho',    label:'Interferência de Vizinho',icon:'🏘️' },
]

const NIVEIS_RISCO = [
  { value:'R1', label:'Baixo Risco',      color:'#22c55e', Casa: CasaR1, desc:'Terreno estável. Monitoramento periódico.',         ang:'~10–15°' },
  { value:'R2', label:'Médio Risco',      color:'#eab308', Casa: CasaR2, desc:'Instabilidade potencial. Investigação geotécnica.', ang:'~25–30°' },
  { value:'R3', label:'Alto Risco',       color:'#f97316', Casa: CasaR3, desc:'Risco elevado. Obras de contenção urgentes.',        ang:'~40–45°' },
  { value:'R4', label:'Muito Alto Risco', color:'#ef4444', Casa: CasaR4, desc:'Risco geológico severo. Evacuação imediata.',         ang:'>45°'    },
]

// ── Export helpers ───────────────────────────────────────────────
function exportExcel(vistorias) {
  const rows = vistorias.map(v => ({
    'ID':                  v.id,
    'Data':                v.data ? new Date(v.data).toLocaleString('pt-BR') : '',
    'Nome':                v.nome || '',
    'CPF':                 v.cpf || '',
    'Telefone':            v.telefone || '',
    'Endereço':            v.endereco || '',
    'Latitude':            v.lat || v.coordenada?.lat || '',
    'Longitude':           v.lng || v.coordenada?.lng || '',
    'Condição da Encosta': v.condEncosta || '',
    'Tipo de Talude':      v.tipoTalude || '',
    'Processos':           Array.isArray(v.processos) ? v.processos.join('; ') : '',
    'Tipo de Solo':        v.solo || '',
    'Uso do Imóvel':       v.tipoUso || v.tipo_uso || '',
    'Moradores':           v.moradores || '',
    'Patologias':          Array.isArray(v.patologias) ? v.patologias.join('; ') : '',
    'Grau de Risco':       v.risco || '',
    'Observações':         v.observacao || '',
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Vistorias')
  XLSX.writeFile(wb, `geovistorias_${new Date().toISOString().slice(0,10)}.xlsx`)
}

async function exportKMZ(vistorias) {
  const toF = (f, d) => (f == null || f === '') ? '' : `<${d}>${f}</${d}>`
  const placemarks = vistorias
    .filter(v => (v.lat || v.coordenada?.lat) && (v.lng || v.coordenada?.lng))
    .map(v => {
      const lat = v.lat || v.coordenada?.lat
      const lng = v.lng || v.coordenada?.lng
      const cor = NIVEIS_RISCO.find(r => r.value === v.risco)?.color?.replace('#','') || 'ffffff'
      return `
  <Placemark>
    <name>${v.nome || 'Sem nome'} — ${v.risco || ''}</name>
    <description><![CDATA[
      <b>Endereço:</b> ${v.endereco || ''}<br/>
      <b>Risco:</b> ${v.risco || ''}<br/>
      <b>Solo:</b> ${v.solo || ''}<br/>
      <b>Processos:</b> ${Array.isArray(v.processos) ? v.processos.join(', ') : ''}<br/>
      <b>Patologias:</b> ${Array.isArray(v.patologias) ? v.patologias.join(', ') : ''}<br/>
      <b>Observações:</b> ${v.observacao || ''}
    ]]></description>
    <Style><IconStyle><color>ff${cor}</color><scale>1.1</scale></IconStyle></Style>
    <Point><coordinates>${lng},${lat},0</coordinates></Point>
    ${toF(v.data ? new Date(v.data).toISOString() : '', 'TimeStamp')}
  </Placemark>`
    }).join('\n')

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Geovistorias — ${new Date().toLocaleDateString('pt-BR')}</name>
    ${placemarks}
  </Document>
</kml>`

  const zip = new JSZip()
  zip.file('doc.kml', kml)
  const blob = await zip.generateAsync({ type: 'blob' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `geovistorias_${new Date().toISOString().slice(0,10)}.kmz`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Dashboard Component ──────────────────────────────────────────
function Dashboard({ vistorias }) {
  if (vistorias.length === 0) {
    return <div className={styles.vazio}>Nenhuma vistoria registrada.</div>
  }

  const byRisco = NIVEIS_RISCO.map(r => ({
    ...r, count: vistorias.filter(v => v.risco === r.value).length,
  }))
  const total = vistorias.length
  const comCoord = vistorias.filter(v => v.lat || v.coordenada?.lat).length

  const processoCounts = {}
  vistorias.forEach(v => {
    (Array.isArray(v.processos) ? v.processos : []).forEach(p => {
      processoCounts[p] = (processoCounts[p] || 0) + 1
    })
  })
  const patCounts = {}
  vistorias.forEach(v => {
    (Array.isArray(v.patologias) ? v.patologias : []).forEach(p => {
      patCounts[p] = (patCounts[p] || 0) + 1
    })
  })

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div className={styles.dashGrid}>
        <div className={styles.dashCard}>
          <div className={styles.dashCardNum}>{total}</div>
          <div className={styles.dashCardLabel}>Total de Vistorias</div>
        </div>
        <div className={styles.dashCard}>
          <div className={styles.dashCardNum} style={{color:'#ef4444'}}>{vistorias.filter(v=>v.risco==='R4').length}</div>
          <div className={styles.dashCardLabel}>Risco Muito Alto (R4)</div>
        </div>
        <div className={styles.dashCard}>
          <div className={styles.dashCardNum} style={{color:'#f97316'}}>{vistorias.filter(v=>v.risco==='R3').length}</div>
          <div className={styles.dashCardLabel}>Risco Alto (R3)</div>
        </div>
        <div className={styles.dashCard}>
          <div className={styles.dashCardNum} style={{color:'#38bdf8'}}>{comCoord}</div>
          <div className={styles.dashCardLabel}>Com Geolocalização</div>
        </div>
      </div>

      <div className={styles.dashSection}>
        <div className={styles.dashTitle}>Distribuição por Grau de Risco</div>
        {byRisco.map(r => (
          <div key={r.value} className={styles.dashBarRow}>
            <span style={{color:r.color, fontWeight:700, minWidth:28}}>{r.value}</span>
            <div className={styles.dashBarTrack}>
              <div className={styles.dashBarFill} style={{width:`${total>0?(r.count/total)*100:0}%`, background:r.color}}/>
            </div>
            <span style={{color:'#94a3b8', minWidth:20, textAlign:'right'}}>{r.count}</span>
          </div>
        ))}
      </div>

      {Object.keys(processoCounts).length > 0 && (
        <div className={styles.dashSection}>
          <div className={styles.dashTitle}>Processos Mais Frequentes</div>
          {Object.entries(processoCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([p,n])=>(
            <div key={p} className={styles.dashBarRow}>
              <span style={{color:'#94a3b8', minWidth:140, fontSize:11}}>{PROCESSOS.find(x=>x.id===p)?.label || p}</span>
              <div className={styles.dashBarTrack}>
                <div className={styles.dashBarFill} style={{width:`${(n/total)*100}%`, background:'#3b82f6'}}/>
              </div>
              <span style={{color:'#94a3b8', minWidth:20, textAlign:'right'}}>{n}</span>
            </div>
          ))}
        </div>
      )}

      {Object.keys(patCounts).length > 0 && (
        <div className={styles.dashSection}>
          <div className={styles.dashTitle}>Patologias Mais Frequentes</div>
          {Object.entries(patCounts).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([p,n])=>(
            <div key={p} className={styles.dashBarRow}>
              <span style={{color:'#94a3b8', minWidth:140, fontSize:11}}>{PATOLOGIAS.find(x=>x.id===p)?.label || p}</span>
              <div className={styles.dashBarTrack}>
                <div className={styles.dashBarFill} style={{width:`${(n/total)*100}%`, background:'#f97316'}}/>
              </div>
              <span style={{color:'#94a3b8', minWidth:20, textAlign:'right'}}>{n}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
        <button className={styles.exportBtn} onClick={() => exportExcel(vistorias)}>
          <FiDownload size={14}/> Exportar Excel
        </button>
        <button className={styles.exportBtn} style={{background:'#065f46', borderColor:'#065f46'}} onClick={() => exportKMZ(vistorias)}>
          <FiDownload size={14}/> Exportar KMZ
        </button>
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────
export default function Vistoria() {
  const [abaAtiva, setAbaAtiva] = useState('form')

  // Dados do responsável
  const [nome,      setNome]      = useState('')
  const [cpf,       setCpf]       = useState('')
  const [telefone,  setTelefone]  = useState('')
  const [endereco,  setEndereco]  = useState('')
  const [moradores, setMoradores] = useState('')

  // Caracterização do local
  const [condEncosta, setCondEncosta] = useState('')
  const [tipoTalude,  setTipoTalude]  = useState('')
  const [processos,   setProcessos]   = useState([])

  // Solo e imóvel
  const [solo,    setSolo]    = useState('')
  const [tipoUso, setTipoUso] = useState('')

  // Patologias e risco
  const [patologias,  setPatologias]  = useState([])
  const [risco,       setRisco]       = useState('')
  const [observacao,  setObservacao]  = useState('')

  const [vistorias,   setVistorias]   = useState([])
  const [coordAtual,  setCoordAtual]  = useState(null)
  const [sucesso,     setSucesso]     = useState(false)
  const [carregando,  setCarregando]  = useState(false)

  useEffect(() => {
    carregar()
    const coord = localStorage.getItem('ultimaCoordenada')
    if (coord) setCoordAtual(JSON.parse(coord))
  }, [])

  async function carregar() {
    setCarregando(true)
    try {
      const dados = await api.getVistorias()
      setVistorias(dados)
    } catch {
      setVistorias(JSON.parse(localStorage.getItem('vistorias') || '[]'))
    } finally {
      setCarregando(false)
    }
  }

  function toggleProcesso(id) {
    setProcessos(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id])
  }
  function togglePatologia(id) {
    setPatologias(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id])
  }

  async function salvar(e) {
    e.preventDefault()
    if (!nome || !risco) return alert('Preencha o responsável e o grau de risco.')
    const payload = {
      nome, cpf, telefone, endereco, moradores,
      condEncosta, tipoTalude, processos,
      solo, tipo_uso: tipoUso,
      risco, patologias, observacao,
      cidade: 'ouro_branco',
      lat: coordAtual?.lat,
      lng: coordAtual?.lng,
      data: new Date().toISOString(),
    }
    try {
      await api.createVistoria(payload)
    } catch {
      const dados = JSON.parse(localStorage.getItem('vistorias') || '[]')
      dados.push({ id: Date.now(), ...payload, coordenada: coordAtual })
      localStorage.setItem('vistorias', JSON.stringify(dados))
    }
    setNome(''); setCpf(''); setTelefone(''); setEndereco(''); setMoradores('')
    setCondEncosta(''); setTipoTalude(''); setProcessos([])
    setSolo(''); setTipoUso(''); setRisco(''); setPatologias([]); setObservacao('')
    setSucesso(true)
    setTimeout(() => setSucesso(false), 3500)
    carregar()
    setAbaAtiva('lista')
  }

  async function remover(id) {
    if (!confirm('Remover esta vistoria?')) return
    try {
      await api.deleteVistoria(id)
    } catch {
      const lista = JSON.parse(localStorage.getItem('vistorias') || '[]').filter(v => v.id !== id)
      localStorage.setItem('vistorias', JSON.stringify(lista))
    }
    carregar()
  }

  const getRiscoColor = r => NIVEIS_RISCO.find(x => x.value === r)?.color || '#64748b'

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link to='/' className={styles.back}><FiArrowLeft /> Voltar ao Mapa</Link>
        <h1><FiClipboard /> Vistoria Residencial</h1>
        <p className={styles.headerSub}>Modelo NBR 11682 / IPT–Defesa Civil</p>
      </div>

      <div className={styles.abas}>
        {[['form','Nova Vistoria'],['lista',`Realizadas (${vistorias.length})`],['dashboard','Dashboard']].map(([k,l])=>(
          <button key={k} className={`${styles.aba} ${abaAtiva===k?styles.abaAtiva:''}`} onClick={()=>setAbaAtiva(k)}>{l}</button>
        ))}
      </div>

      {/* ── FORMULÁRIO ── */}
      {abaAtiva === 'form' && (
        <div className={styles.formCard}>
          {coordAtual ? (
            <div className={styles.coordInfo}>
              <FiMapPin size={14}/>
              Localização: {coordAtual.lat?.toFixed(5)}, {coordAtual.lng?.toFixed(5)}
            </div>
          ) : (
            <div className={styles.coordWarning}>
              <FiMapPin size={14}/>
              Vá ao mapa e clique na localização do imóvel antes de cadastrar.
            </div>
          )}

          <form onSubmit={salvar} className={styles.form}>

            {/* ── 1. Dados do Responsável ── */}
            <div className={styles.section}>
              <h3>1. Dados do Responsável</h3>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Nome *</label>
                  <input placeholder='Nome completo' value={nome} onChange={e=>setNome(e.target.value)} required/>
                </div>
                <div className={styles.field}>
                  <label>CPF</label>
                  <input placeholder='000.000.000-00' value={cpf} onChange={e=>setCpf(e.target.value)}/>
                </div>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Telefone</label>
                  <input placeholder='(00) 00000-0000' value={telefone} onChange={e=>setTelefone(e.target.value)}/>
                </div>
                <div className={styles.field}>
                  <label>Endereço</label>
                  <input placeholder='Rua, número, bairro' value={endereco} onChange={e=>setEndereco(e.target.value)}/>
                </div>
              </div>
              <div className={styles.field} style={{marginTop:10}}>
                <label>Nº de Moradores</label>
                <input type='number' min='0' placeholder='0' value={moradores} onChange={e=>setMoradores(e.target.value)} style={{maxWidth:120}}/>
              </div>
            </div>

            {/* ── 2. Condição da Encosta ── */}
            <div className={styles.section}>
              <h3>2. Condição da Encosta / Área</h3>
              <div className={styles.condGrid}>
                {COND_ENCOSTA.map(c=>(
                  <button type='button' key={c.id}
                    className={`${styles.condBtn} ${condEncosta===c.id ? styles.condBtnAtivo : ''}`}
                    style={condEncosta===c.id ? {borderColor:c.cor, background:c.cor+'22'} : {}}
                    onClick={()=>setCondEncosta(condEncosta===c.id?'':c.id)}
                  >
                    <span className={styles.condIcon}>{c.icon}</span>
                    <span style={{fontWeight:700, color: condEncosta===c.id ? c.cor : '#e2e8f0'}}>{c.label}</span>
                    <span className={styles.condDesc}>{c.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── 3. Tipo de Talude / Encosta ── */}
            <div className={styles.section}>
              <h3>3. Tipo de Encosta / Talude</h3>
              <p className={styles.sectionHint}>Selecione o que melhor representa a situação do local</p>
              <div className={styles.taludeGrid}>
                {TIPOS_TALUDE.map(t=>(
                  <button type='button' key={t.id}
                    className={`${styles.taludeBtn} ${tipoTalude===t.id ? styles.taludeBtnAtivo : ''}`}
                    onClick={()=>setTipoTalude(tipoTalude===t.id?'':t.id)}
                  >
                    <t.Icone/>
                    <span className={styles.taludeLabel}>{t.label}</span>
                    {tipoTalude===t.id && <span className={styles.checkMark}>✓</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 4. Processos Identificados ── */}
            <div className={styles.section}>
              <h3>4. Processos Identificados</h3>
              <p className={styles.sectionHint}>Selecione todos que se aplicam</p>
              <div className={styles.processoGrid}>
                {PROCESSOS.map(p=>(
                  <button type='button' key={p.id}
                    className={`${styles.processoBtn} ${processos.includes(p.id)?styles.processoBtnAtivo:''}`}
                    onClick={()=>toggleProcesso(p.id)}
                  >
                    <span className={styles.processoIcon}>{p.icon}</span>
                    <div>
                      <div className={styles.processoLabel}>{p.label}</div>
                      <div className={styles.processoDesc}>{p.desc}</div>
                    </div>
                    {processos.includes(p.id) && <FiCheckCircle size={14} color='#38bdf8' style={{marginLeft:'auto', flexShrink:0}}/>}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 5. Solo e Imóvel ── */}
            <div className={styles.section}>
              <h3>5. Tipo de Solo</h3>
              <div className={styles.soloGrid}>
                {TIPOS_SOLO.map(s=>(
                  <button type='button' key={s.id}
                    className={`${styles.soloBtn} ${solo===s.id?styles.soloBtnAtivo:''}`}
                    style={solo===s.id?{borderColor:s.cor, background:s.cor+'22'}:{}}
                    onClick={()=>setSolo(solo===s.id?'':s.id)}
                  >
                    <span style={{fontSize:18}}>{s.icon}</span>
                    <span style={{fontSize:12, fontWeight:600, color:solo===s.id?s.cor:'#94a3b8'}}>{s.label}</span>
                  </button>
                ))}
              </div>
              <div className={styles.field} style={{marginTop:14}}>
                <label>Uso do Imóvel</label>
                <div className={styles.usoGrid}>
                  {TIPOS_USO.map(u=>(
                    <button type='button' key={u}
                      className={`${styles.usoBtn} ${tipoUso===u?styles.usoBtnAtivo:''}`}
                      onClick={()=>setTipoUso(tipoUso===u?'':u)}
                    >{u}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── 6. Patologias ── */}
            <div className={styles.section}>
              <h3>6. Patologias Identificadas</h3>
              <div className={styles.patGrid}>
                {PATOLOGIAS.map(p=>(
                  <button type='button' key={p.id}
                    className={`${styles.patBtn} ${patologias.includes(p.id)?styles.patBtnAtivo:''}`}
                    onClick={()=>togglePatologia(p.id)}
                  >
                    <span>{p.icon}</span>
                    <span>{p.label}</span>
                    {patologias.includes(p.id) && <span className={styles.patCheck}>✓</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 7. Grau de Risco ── */}
            <div className={styles.section}>
              <h3>7. Grau de Risco — NBR 11682 / IPT</h3>
              <p className={styles.sectionHint}>Selecione o nível que representa a situação observada</p>
              <div className={styles.riscoGrid}>
                {NIVEIS_RISCO.map(n=>(
                  <button type='button' key={n.value}
                    className={`${styles.riscoBtn} ${risco===n.value?styles.riscoBtnAtivo:''}`}
                    style={risco===n.value?{borderColor:n.color, background:n.color+'18'}:{}}
                    onClick={()=>setRisco(risco===n.value?'':n.value)}
                  >
                    <div className={styles.riscoCasa}>
                      <n.Casa/>
                    </div>
                    <div style={{textAlign:'center'}}>
                      <div className={styles.riscoBadge} style={{background:n.color}}>{n.value}</div>
                      <div className={styles.riscoLabel}>{n.label}</div>
                      <div className={styles.riscoDesc}>{n.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ── 8. Observações ── */}
            <div className={styles.section}>
              <label className={styles.obsLabel}>8. Observações Técnicas</label>
              <textarea
                placeholder='Condições técnicas, medidas recomendadas, referências de campo...'
                value={observacao}
                onChange={e=>setObservacao(e.target.value)}
                rows={4}
              />
            </div>

            <button type='submit' className={styles.saveBtn}>
              <FiSave/> Salvar Vistoria
            </button>
            {sucesso && (
              <div className={styles.sucesso}>
                <FiCheckCircle size={16}/> Vistoria salva com sucesso!
              </div>
            )}
          </form>
        </div>
      )}

      {/* ── LISTA ── */}
      {abaAtiva === 'lista' && (
        <div className={styles.listaCard}>
          <div style={{display:'flex', gap:10, marginBottom:16, flexWrap:'wrap'}}>
            <button className={styles.exportBtn} onClick={() => exportExcel(vistorias)}>
              <FiDownload size={13}/> Exportar Excel
            </button>
            <button className={styles.exportBtn} style={{background:'#065f46', borderColor:'#065f46'}} onClick={() => exportKMZ(vistorias)}>
              <FiDownload size={13}/> Exportar KMZ
            </button>
          </div>
          {carregando ? (
            <div className={styles.vazio}>Carregando...</div>
          ) : vistorias.length === 0 ? (
            <div className={styles.vazio}>Nenhuma vistoria registrada ainda.</div>
          ) : (
            <div className={styles.lista}>
              {[...vistorias].reverse().map(v => (
                <div key={v.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <div className={styles.cardNome}>
                      <span className={styles.riscoBadgeSm} style={{background:getRiscoColor(v.risco)}}>{v.risco}</span>
                      {v.nome}
                    </div>
                    <button className={styles.deleteBtn} onClick={() => remover(v.id)}>
                      <FiTrash2 size={14}/>
                    </button>
                  </div>
                  <div className={styles.cardGrid}>
                    {v.endereco   && <span><strong>Endereço:</strong> {v.endereco}</span>}
                    {v.solo       && <span><strong>Solo:</strong> {TIPOS_SOLO.find(s=>s.id===v.solo)?.label || v.solo}</span>}
                    {(v.tipoUso||v.tipo_uso) && <span><strong>Uso:</strong> {v.tipoUso||v.tipo_uso}</span>}
                    {v.condEncosta && <span><strong>Encosta:</strong> {COND_ENCOSTA.find(c=>c.id===v.condEncosta)?.label || v.condEncosta}</span>}
                    {v.tipoTalude && <span><strong>Talude:</strong> {TIPOS_TALUDE.find(t=>t.id===v.tipoTalude)?.label || v.tipoTalude}</span>}
                    {v.moradores  && <span><strong>Moradores:</strong> {v.moradores}</span>}
                    {v.telefone   && <span><strong>Tel:</strong> {v.telefone}</span>}
                  </div>
                  {Array.isArray(v.processos) && v.processos.length > 0 && (
                    <div className={styles.tagRow}>
                      <FiAlertTriangle size={11} color='#f97316'/>
                      {v.processos.map(p=>(
                        <span key={p} className={styles.tagProcesso}>
                          {PROCESSOS.find(x=>x.id===p)?.icon} {PROCESSOS.find(x=>x.id===p)?.label.split('/')[0] || p}
                        </span>
                      ))}
                    </div>
                  )}
                  {Array.isArray(v.patologias) && v.patologias.length > 0 && (
                    <div className={styles.patologiasLista}>
                      {v.patologias.map(p=>(
                        <span key={p} className={styles.patTag}>
                          {PATOLOGIAS.find(x=>x.id===p)?.icon} {PATOLOGIAS.find(x=>x.id===p)?.label || p}
                        </span>
                      ))}
                    </div>
                  )}
                  {v.observacao && <div className={styles.obs}>{v.observacao}</div>}
                  {(v.lat||v.coordenada?.lat) && (
                    <div className={styles.coord}>
                      <FiMapPin size={10}/>
                      {(v.lat||v.coordenada?.lat)?.toFixed(5)}, {(v.lng||v.coordenada?.lng)?.toFixed(5)}
                    </div>
                  )}
                  <div className={styles.data}>{v.data?new Date(v.data).toLocaleString('pt-BR'):''}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── DASHBOARD ── */}
      {abaAtiva === 'dashboard' && (
        <div className={styles.listaCard}>
          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:20}}>
            <FiBarChart2 size={18} color='#38bdf8'/>
            <span style={{fontWeight:700, fontSize:16, color:'#f0f9ff'}}>Dashboard de Vistorias</span>
          </div>
          <Dashboard vistorias={vistorias}/>
        </div>
      )}
    </div>
  )
}
