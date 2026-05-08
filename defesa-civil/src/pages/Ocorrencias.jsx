import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { FiArrowLeft, FiAlertTriangle, FiSave, FiTrash2, FiMapPin } from 'react-icons/fi'
import styles from './Ocorrencias.module.css'

const TIPOS = [
  'Deslizamento de terra',
  'Alagamento',
  'Erosão',
  'Incêndio',
  'Colapso de estrutura',
  'Queda de árvore',
  'Inundação',
  'Desabamento',
  'Afundamento de solo',
  'Outro'
]

const NIVEIS = [
  { value: 'baixo', label: 'Baixo', color: '#22c55e' },
  { value: 'medio', label: 'Médio', color: '#eab308' },
  { value: 'alto', label: 'Alto', color: '#f97316' },
  { value: 'critico', label: 'Crítico', color: '#ef4444' }
]

export default function Ocorrencias() {
  const [tipo, setTipo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [nivel, setNivel] = useState('medio')
  const [endereco, setEndereco] = useState('')
  const [ocorrencias, setOcorrencias] = useState([])
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroNivel, setFiltroNivel] = useState('')
  const [coordAtual, setCoordAtual] = useState(null)
  const [sucesso, setSucesso] = useState(false)

  useEffect(() => {
    carregar()
    const coord = localStorage.getItem('ultimaCoordenada')
    if (coord) setCoordAtual(JSON.parse(coord))
  }, [])

  function carregar() {
    setOcorrencias(JSON.parse(localStorage.getItem('ocorrencias') || '[]'))
  }

  function salvar(e) {
    e.preventDefault()
    if (!tipo) return alert('Selecione o tipo de ocorrência.')
    const lista = JSON.parse(localStorage.getItem('ocorrencias') || '[]')
    lista.push({
      id: Date.now(),
      tipo,
      descricao,
      nivel,
      endereco,
      coordenada: coordAtual,
      data: new Date().toISOString()
    })
    localStorage.setItem('ocorrencias', JSON.stringify(lista))
    setTipo('')
    setDescricao('')
    setNivel('medio')
    setEndereco('')
    setSucesso(true)
    setTimeout(() => setSucesso(false), 3000)
    carregar()
  }

  function remover(id) {
    if (!confirm('Remover esta ocorrência?')) return
    const lista = (JSON.parse(localStorage.getItem('ocorrencias') || '[]'))
      .filter(o => o.id !== id)
    localStorage.setItem('ocorrencias', JSON.stringify(lista))
    carregar()
  }

  const ocFiltradas = ocorrencias.filter(o => {
    if (filtroTipo && o.tipo !== filtroTipo) return false
    if (filtroNivel && o.nivel !== filtroNivel) return false
    return true
  }).reverse()

  function getNivelColor(n) {
    return NIVEIS.find(x => x.value === n)?.color || '#64748b'
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link to='/' className={styles.back}><FiArrowLeft /> Voltar ao Mapa</Link>
        <h1><FiAlertTriangle /> Cadastro de Ocorrências</h1>
      </div>

      <div className={styles.layout}>
        <div className={styles.formCard}>
          <h2>Nova Ocorrência</h2>

          {coordAtual ? (
            <div className={styles.coordInfo}>
              <FiMapPin size={14} />
              Coordenada do mapa: {coordAtual.lat?.toFixed(5)}, {coordAtual.lng?.toFixed(5)}
            </div>
          ) : (
            <div className={styles.coordWarning}>
              <FiMapPin size={14} />
              Clique no mapa para definir a localização antes de salvar.
            </div>
          )}

          <form onSubmit={salvar} className={styles.form}>
            <label>Tipo de Ocorrência *</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} required>
              <option value=''>Selecione...</option>
              {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <label>Nível de Severidade</label>
            <div className={styles.nivelGroup}>
              {NIVEIS.map(n => (
                <button
                  type='button'
                  key={n.value}
                  className={`${styles.nivelBtn} ${nivel === n.value ? styles.nivelBtnActive : ''}`}
                  style={nivel === n.value ? { background: n.color, borderColor: n.color } : {}}
                  onClick={() => setNivel(n.value)}
                >
                  {n.label}
                </button>
              ))}
            </div>

            <label>Endereço / Referência</label>
            <input
              placeholder='Ex: Rua das Flores, 123'
              value={endereco}
              onChange={e => setEndereco(e.target.value)}
            />

            <label>Descrição</label>
            <textarea
              placeholder='Descreva a ocorrência em detalhes...'
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              rows={4}
            />

            <button type='submit' className={styles.saveBtn}>
              <FiSave /> Registrar Ocorrência
            </button>

            {sucesso && (
              <div className={styles.sucesso}>Ocorrência registrada com sucesso!</div>
            )}
          </form>
        </div>

        <div className={styles.listCard}>
          <div className={styles.listHeader}>
            <h2>Ocorrências Registradas ({ocorrencias.length})</h2>
            <div className={styles.filtros}>
              <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
                <option value=''>Todos os tipos</option>
                {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={filtroNivel} onChange={e => setFiltroNivel(e.target.value)}>
                <option value=''>Todos os níveis</option>
                {NIVEIS.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
              </select>
            </div>
          </div>

          {ocFiltradas.length === 0 ? (
            <div className={styles.vazio}>Nenhuma ocorrência registrada.</div>
          ) : (
            <div className={styles.list}>
              {ocFiltradas.map(oc => (
                <div key={oc.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <div>
                      <span
                        className={styles.nivelTag}
                        style={{ background: getNivelColor(oc.nivel) }}
                      >
                        {NIVEIS.find(n => n.value === oc.nivel)?.label}
                      </span>
                      <strong className={styles.cardTipo}>{oc.tipo}</strong>
                    </div>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => remover(oc.id)}
                      title='Remover'
                    >
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                  {oc.endereco && <div className={styles.cardInfo}><FiMapPin size={11} /> {oc.endereco}</div>}
                  {oc.descricao && <div className={styles.cardDesc}>{oc.descricao}</div>}
                  {oc.coordenada && (
                    <div className={styles.cardCoord}>
                      Lat: {oc.coordenada.lat?.toFixed(4)} | Lng: {oc.coordenada.lng?.toFixed(4)}
                    </div>
                  )}
                  <div className={styles.cardData}>
                    {oc.data ? new Date(oc.data).toLocaleString('pt-BR') : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
