import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './Login.module.css'

export default function Login() {
  const { login } = useAuth()
  const navigate   = useNavigate()

  const [email,      setEmail]      = useState('')
  const [senha,      setSenha]      = useState('')
  const [erro,       setErro]       = useState('')
  const [carregando, setCarregando] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setErro('')
    setCarregando(true)

    const ok = await login(email, senha)
    if (ok) {
      navigate('/', { replace: true })
    } else {
      setErro('E-mail ou senha incorretos. Verifique e tente novamente.')
    }
    setCarregando(false)
  }

  return (
    <div className={styles.tela}>
      <div className={styles.card}>

        <div className={styles.logoWrap}>
          <img src='/icone.png' alt='Geovistorias' className={styles.logo} />
          <h1 className={styles.titulo}>Geovistorias</h1>
          <p className={styles.subtitulo}>DEFESA CIVIL · OURO BRANCO &amp; CONGONHAS</p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.campo}>
            <label className={styles.label}>E-mail</label>
            <input
              type='email'
              className={styles.input}
              placeholder='seu@email.com'
              value={email}
              onChange={e => { setEmail(e.target.value); setErro('') }}
              required
              autoComplete='email'
              autoFocus
            />
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
        </div>
      </div>
    </div>
  )
}
