import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { FiArrowLeft, FiClipboard, FiSave, FiTrash2, FiMapPin } from 'react-icons/fi'
import { api } from '../services/api'
import styles from './Vistoria.module.css'

const NIVEIS_RISCO = [
  { value: 'R1', label: 'R1 — Baixo Risco', color: '#22c55e', desc: 'Sem perigo iminente' },
  { value: 'R2', label: 'R2 — Médio Risco', color: '#eab308', desc: 'Risco moderado' },
  { value: 'R3', label: 'R3 — Alto Risco', color: '#f97316', desc: 'Risco elevado' },
  { value: 'R4', label: 'R4 — Muito Alto Risco', color: '#ef4444', desc: 'Risco muito alto, evacuação recomendada' }
]

const TIPOS_SOLO = ['Argiloso', 'Arenoso', 'Rocha', 'Aterro', 'Misto', 'Orgânico']
const TIPOS_USO = ['Residencial', 'Comercial', 'Institucional', 'Terreno vazio', 'Área rural']
const PATOLOGIAS = [
  'Trinca nas paredes',
  'Recalque de fundação',
  'Umidade/infiltração',
  'Erosão no terreno',
  'Instabilidade de talude',
  'Cobertura danificada',
  'Ausência de drenagem',
  'Lançamento de esgoto'
]

export default function Vistoria() {
  const [nome, setNome] = useState('')
  const [cpf, setCpf] = useState('')
  const [telefone, setTelefone] = useState('')
  const [endereco, setEndereco] = useState('')
  const [solo, setSolo] = useState('')
  const [tipoUso, setTipoUso] = useState('')
  const [risco, setRisco] = useState('')
  const [patologias, setPatologias] = useState([])
  const [observacao, setObservacao] = useState('')
  const [vistorias, setVistorias] = useState([])
  const [coordAtual, setCoordAtual] = useState(null)
  const [sucesso, setSucesso] = useState(false)
  const [abaAtiva, setAbaAtiva] = useState('form')
  const [carregando, setCarregando] = useState(false)

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

  function togglePatologia(p) {
    setPatologias(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    )
  }

  async function salvar(e) {
    e.preventDefault()
    if (!nome || !risco) return alert('Preencha o responsável e o grau de risco.')
    const payload = {
      nome, cpf, telefone, endereco,
      solo, tipo_uso: tipoUso, risco,
      patologias,
      observacao,
      cidade: 'ouro_branco',
      lat: coordAtual?.lat,
      lng: coordAtual?.lng,
      data: new Date().toISOString()
    }
    try {
      await api.createVistoria(payload)
    } catch {
      const dados = JSON.parse(localStorage.getItem('vistorias') || '[]')
      dados.push({ id: Date.now(), ...payload, coordenada: coordAtual })
      localStorage.setItem('vistorias', JSON.stringify(dados))
    }
    setNome(''); setCpf(''); setTelefone(''); setEndereco('')
    setSolo(''); setTipoUso(''); setRisco('')
    setPatologias([]); setObservacao('')
    setSucesso(true)
    setTimeout(() => setSucesso(false), 3000)
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

  function getRiscoColor(r) {
    return NIVEIS_RISCO.find(x => x.value === r)?.color || '#64748b'
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link to='/' className={styles.back}><FiArrowLeft /> Voltar ao Mapa</Link>
        <h1><FiClipboard /> Vistoria Residencial</h1>
      </div>

      <div className={styles.abas}>
        <button
          className={`${styles.aba} ${abaAtiva === 'form' ? styles.abaAtiva : ''}`}
          onClick={() => setAbaAtiva('form')}
        >
          Nova Vistoria
        </button>
        <button
          className={`${styles.aba} ${abaAtiva === 'lista' ? styles.abaAtiva : ''}`}
          onClick={() => setAbaAtiva('lista')}
        >
          Realizadas ({vistorias.length})
        </button>
      </div>

      {abaAtiva === 'form' && (
        <div className={styles.formCard}>
          {coordAtual ? (
            <div className={styles.coordInfo}>
              <FiMapPin size={14} />
              Localização: {coordAtual.lat?.toFixed(5)}, {coordAtual.lng?.toFixed(5)}
            </div>
          ) : (
            <div className={styles.coordWarning}>
              <FiMapPin size={14} />
              Vá ao mapa e clique na localização do imóvel antes de cadastrar.
            </div>
          )}

          <form onSubmit={salvar} className={styles.form}>
            <div className={styles.section}>
              <h3>Dados do Responsável</h3>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Nome do Responsável *</label>
                  <input placeholder='Nome completo' value={nome} onChange={e => setNome(e.target.value)} required />
                </div>
                <div className={styles.field}>
                  <label>CPF</label>
                  <input placeholder='000.000.000-00' value={cpf} onChange={e => setCpf(e.target.value)} />
                </div>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Telefone</label>
                  <input placeholder='(00) 00000-0000' value={telefone} onChange={e => setTelefone(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>Endereço</label>
                  <input placeholder='Rua, número, bairro' value={endereco} onChange={e => setEndereco(e.target.value)} />
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <h3>Características do Imóvel</h3>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Tipo de Solo</label>
                  <select value={solo} onChange={e => setSolo(e.target.value)}>
                    <option value=''>Selecione...</option>
                    {TIPOS_SOLO.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Uso do Imóvel</label>
                  <select value={tipoUso} onChange={e => setTipoUso(e.target.value)}>
                    <option value=''>Selecione...</option>
                    {TIPOS_USO.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <h3>Patologias Identificadas</h3>
              <div className={styles.patologiaGrid}>
                {PATOLOGIAS.map(p => (
                  <label key={p} className={`${styles.patologiaItem} ${patologias.includes(p) ? styles.patologiaAtiva : ''}`}>
                    <input
                      type='checkbox'
                      checked={patologias.includes(p)}
                      onChange={() => togglePatologia(p)}
                    />
                    {p}
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.section}>
              <h3>Grau de Risco *</h3>
              <div className={styles.riscoGrid}>
                {NIVEIS_RISCO.map(n => (
                  <button
                    type='button'
                    key={n.value}
                    className={`${styles.riscoBtn} ${risco === n.value ? styles.riscoBtnAtivo : ''}`}
                    style={risco === n.value ? { borderColor: n.color, background: n.color + '22' } : {}}
                    onClick={() => setRisco(n.value)}
                  >
                    <span className={styles.riscoBadge} style={{ background: n.color }}>{n.value}</span>
                    <div>
                      <div className={styles.riscoLabel}>{n.label.split('—')[1]?.trim()}</div>
                      <div className={styles.riscoDesc}>{n.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.section}>
              <label>Observações Técnicas</label>
              <textarea
                placeholder='Condições técnicas, medidas recomendadas, etc.'
                value={observacao}
                onChange={e => setObservacao(e.target.value)}
                rows={4}
              />
            </div>

            <button type='submit' className={styles.saveBtn}>
              <FiSave /> Salvar Vistoria
            </button>
            {sucesso && <div className={styles.sucesso}>Vistoria salva com sucesso!</div>}
          </form>
        </div>
      )}

      {abaAtiva === 'lista' && (
        <div className={styles.listaCard}>
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
                      <span
                        className={styles.riscoBadgeSm}
                        style={{ background: getRiscoColor(v.risco) }}
                      >{v.risco}</span>
                      {v.nome}
                    </div>
                    <button className={styles.deleteBtn} onClick={() => remover(v.id)}>
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                  <div className={styles.cardGrid}>
                    {v.endereco && <span><strong>Endereço:</strong> {v.endereco}</span>}
                    {v.solo && <span><strong>Solo:</strong> {v.solo}</span>}
                    {(v.tipoUso || v.tipo_uso) && <span><strong>Uso:</strong> {v.tipoUso || v.tipo_uso}</span>}
                    {v.telefone && <span><strong>Tel:</strong> {v.telefone}</span>}
                  </div>
                  {(v.patologias?.length > 0) && (
                    <div className={styles.patologiasLista}>
                      {(Array.isArray(v.patologias) ? v.patologias : []).map(p => (
                        <span key={p} className={styles.patTag}>{p}</span>
                      ))}
                    </div>
                  )}
                  {v.observacao && <div className={styles.obs}>{v.observacao}</div>}
                  {(v.lat || v.coordenada?.lat) && (
                    <div className={styles.coord}>
                      <FiMapPin size={10} />
                      {(v.lat || v.coordenada?.lat)?.toFixed(4)}, {(v.lng || v.coordenada?.lng)?.toFixed(4)}
                    </div>
                  )}
                  <div className={styles.data}>
                    {v.data ? new Date(v.data).toLocaleString('pt-BR') : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
