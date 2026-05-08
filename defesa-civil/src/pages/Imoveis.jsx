import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { FiArrowLeft, FiHome, FiSave, FiTrash2, FiMapPin, FiSearch } from 'react-icons/fi'
import styles from './Imoveis.module.css'

const TIPOS_IMOVEL = ['Casa', 'Apartamento', 'Comercial', 'Galpão', 'Terreno', 'Área rural', 'Institucional', 'Outro']
const SITUACOES = [
  { value: 'regular', label: 'Regular', color: '#22c55e' },
  { value: 'irregular', label: 'Irregular', color: '#f97316' },
  { value: 'em_risco', label: 'Em Risco', color: '#ef4444' },
  { value: 'evacuado', label: 'Evacuado', color: '#7c3aed' },
  { value: 'interditado', label: 'Interditado', color: '#1e293b' }
]

export default function Imoveis() {
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('')
  const [endereco, setEndereco] = useState('')
  const [proprietario, setProprietario] = useState('')
  const [contato, setContato] = useState('')
  const [situacao, setSituacao] = useState('regular')
  const [moradores, setMoradores] = useState('')
  const [obs, setObs] = useState('')
  const [imoveis, setImoveis] = useState([])
  const [filtro, setFiltro] = useState('')
  const [coordAtual, setCoordAtual] = useState(null)
  const [sucesso, setSucesso] = useState(false)
  const [abaAtiva, setAbaAtiva] = useState('form')

  useEffect(() => {
    carregar()
    const coord = localStorage.getItem('ultimaCoordenada')
    if (coord) setCoordAtual(JSON.parse(coord))
  }, [])

  function carregar() {
    setImoveis(JSON.parse(localStorage.getItem('imoveis') || '[]'))
  }

  function salvar(e) {
    e.preventDefault()
    if (!endereco) return alert('Informe o endereço do imóvel.')
    const lista = JSON.parse(localStorage.getItem('imoveis') || '[]')
    lista.push({
      id: Date.now(),
      nome, tipo, endereco, proprietario,
      contato, situacao,
      moradores: moradores ? parseInt(moradores) : null,
      obs,
      coordenada: coordAtual,
      data: new Date().toISOString()
    })
    localStorage.setItem('imoveis', JSON.stringify(lista))
    setNome(''); setTipo(''); setEndereco(''); setProprietario('')
    setContato(''); setSituacao('regular'); setMoradores(''); setObs('')
    setSucesso(true)
    setTimeout(() => setSucesso(false), 3000)
    carregar()
    setAbaAtiva('lista')
  }

  function remover(id) {
    if (!confirm('Remover este imóvel?')) return
    const lista = JSON.parse(localStorage.getItem('imoveis') || '[]').filter(i => i.id !== id)
    localStorage.setItem('imoveis', JSON.stringify(lista))
    carregar()
  }

  const imoveisFiltrados = imoveis
    .filter(im =>
      !filtro ||
      im.endereco?.toLowerCase().includes(filtro.toLowerCase()) ||
      im.proprietario?.toLowerCase().includes(filtro.toLowerCase()) ||
      im.tipo?.toLowerCase().includes(filtro.toLowerCase())
    )
    .reverse()

  function getSituacaoColor(s) {
    return SITUACOES.find(x => x.value === s)?.color || '#64748b'
  }

  function getSituacaoLabel(s) {
    return SITUACOES.find(x => x.value === s)?.label || s
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link to='/' className={styles.back}><FiArrowLeft /> Voltar ao Mapa</Link>
        <h1><FiHome /> Cadastro de Imóveis</h1>
      </div>

      <div className={styles.abas}>
        <button className={`${styles.aba} ${abaAtiva === 'form' ? styles.abaAtiva : ''}`} onClick={() => setAbaAtiva('form')}>
          Novo Imóvel
        </button>
        <button className={`${styles.aba} ${abaAtiva === 'lista' ? styles.abaAtiva : ''}`} onClick={() => setAbaAtiva('lista')}>
          Imóveis Cadastrados ({imoveis.length})
        </button>
      </div>

      {abaAtiva === 'form' && (
        <div className={styles.formCard}>
          {coordAtual ? (
            <div className={styles.coordInfo}>
              <FiMapPin size={14} />
              Localização salva: {coordAtual.lat?.toFixed(5)}, {coordAtual.lng?.toFixed(5)}
            </div>
          ) : (
            <div className={styles.coordWarning}>
              <FiMapPin size={14} />
              Clique no mapa para definir a localização do imóvel.
            </div>
          )}

          <form onSubmit={salvar} className={styles.form}>
            <div className={styles.section}>
              <h3>Identificação</h3>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Tipo de Imóvel</label>
                  <select value={tipo} onChange={e => setTipo(e.target.value)}>
                    <option value=''>Selecione...</option>
                    {TIPOS_IMOVEL.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Nome / Identificação</label>
                  <input placeholder='Ex: Residência família Silva' value={nome} onChange={e => setNome(e.target.value)} />
                </div>
              </div>
              <div className={styles.field} style={{ marginTop: 10 }}>
                <label>Endereço *</label>
                <input placeholder='Rua, número, bairro' value={endereco} onChange={e => setEndereco(e.target.value)} required />
              </div>
            </div>

            <div className={styles.section}>
              <h3>Proprietário</h3>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Nome do Proprietário</label>
                  <input placeholder='Nome completo' value={proprietario} onChange={e => setProprietario(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>Contato</label>
                  <input placeholder='(00) 00000-0000' value={contato} onChange={e => setContato(e.target.value)} />
                </div>
              </div>
              <div className={styles.field} style={{ marginTop: 10 }}>
                <label>Número de Moradores</label>
                <input type='number' min='0' placeholder='0' value={moradores} onChange={e => setMoradores(e.target.value)} />
              </div>
            </div>

            <div className={styles.section}>
              <h3>Situação do Imóvel</h3>
              <div className={styles.situacaoGrid}>
                {SITUACOES.map(s => (
                  <button
                    type='button'
                    key={s.value}
                    className={`${styles.situacaoBtn} ${situacao === s.value ? styles.situacaoBtnAtivo : ''}`}
                    style={situacao === s.value ? { borderColor: s.color, background: s.color + '22', color: s.color } : {}}
                    onClick={() => setSituacao(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.section}>
              <label>Observações</label>
              <textarea
                placeholder='Informações adicionais sobre o imóvel...'
                value={obs}
                onChange={e => setObs(e.target.value)}
                rows={3}
              />
            </div>

            <button type='submit' className={styles.saveBtn}>
              <FiSave /> Cadastrar Imóvel
            </button>

            {sucesso && <div className={styles.sucesso}>Imóvel cadastrado com sucesso!</div>}
          </form>
        </div>
      )}

      {abaAtiva === 'lista' && (
        <div className={styles.listaCard}>
          <div className={styles.searchBar}>
            <FiSearch size={15} color='#64748b' />
            <input
              placeholder='Pesquisar por endereço, proprietário ou tipo...'
              value={filtro}
              onChange={e => setFiltro(e.target.value)}
            />
          </div>
          {imoveisFiltrados.length === 0 ? (
            <div className={styles.vazio}>Nenhum imóvel cadastrado.</div>
          ) : (
            <div className={styles.lista}>
              {imoveisFiltrados.map(im => (
                <div key={im.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <div className={styles.cardTitle}>
                      <span
                        className={styles.situacaoTag}
                        style={{ background: getSituacaoColor(im.situacao) }}
                      >
                        {getSituacaoLabel(im.situacao)}
                      </span>
                      <span className={styles.cardEnd}>{im.endereco}</span>
                    </div>
                    <button className={styles.deleteBtn} onClick={() => remover(im.id)}>
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                  <div className={styles.cardGrid}>
                    {im.tipo && <span><strong>Tipo:</strong> {im.tipo}</span>}
                    {im.proprietario && <span><strong>Proprietário:</strong> {im.proprietario}</span>}
                    {im.contato && <span><strong>Contato:</strong> {im.contato}</span>}
                    {im.moradores != null && <span><strong>Moradores:</strong> {im.moradores}</span>}
                  </div>
                  {im.obs && <div className={styles.cardObs}>{im.obs}</div>}
                  {im.coordenada && (
                    <div className={styles.cardCoord}>
                      <FiMapPin size={10} /> {im.coordenada.lat?.toFixed(4)}, {im.coordenada.lng?.toFixed(4)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
