import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './Login.module.css'

export default function Login() {
  const { login } = useAuth()
  const navigate   = useNavigate()

  const [nome,       setNome]       = useState('')
  const [senha,      setSenha]      = useState('')
  const [erro,       setErro]       = useState('')
  const [carregando, setCarregando] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setErro('')
    setCarregando(true)

    try {
      const ok = await login(nome, senha)
      if (ok) {
        navigate('/', { replace: true })
      } else {
        setErro('Nome ou senha incorretos. Verifique e tente novamente.')
      }
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className={styles.tela}>
      <div className={styles.card}>

        <div className={styles.logoWrap}>
          <img src='/icons/sismar-192.png' alt='SISMAR' className={styles.logo} />
          <h1 className={styles.titulo}>SISMAR</h1>
          <p className={styles.subtitulo}>DEFESA CIVIL · OURO BRANCO &amp; CONGONHAS</p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.campo}>
            <label className={styles.label}>Nome</label>
            <select
              className={styles.input}
              value={nome}
              onChange={e => { setNome(e.target.value); setErro('') }}
              required
              autoFocus
              autoComplete='username'
            >
              <option value='' disabled>Selecione seu nome</option>
              <option value='Sócrates'>Sócrates</option>
              <option value='Leandro'>Leandro</option>
              <option value='João Victor'>João Victor</option>
            </select>
          </div>

          <div className={styles.campo}>
            <label className={styles.label}>Senha</label>
            <input
              type='password'
              className={styles.input}
              placeholder='••••••••'
              value={senha}
              onChange={e => { setSenha(e.target.value); setErro('') }}
              required
              autoComplete='current-password'
            />
          </div>

          {erro && <div className={styles.erro}>{erro}</div>}

          <button type='submit' className={styles.btn} disabled={carregando}>
            {carregando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div className={styles.rodape}>
          Sistema WebGIS de Monitoramento Geotécnico
          <br />
          <span className={styles.acesso}>Acesso compartilhado da equipe de Defesa Civil.</span>
        </div>
      </div>
    </div>
  )
}
