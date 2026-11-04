import express from 'express'
import cors from 'cors'
import pg from 'pg'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { createHash } from 'node:crypto'

const { Pool } = pg
const poolerUrlValue = process.env.SUPABASE_SESSION_POOLER_URL
const databasePassword = process.env.SUPABASE_DB_PASSWORD
if (!poolerUrlValue || !databasePassword) {
  throw new Error('Configure os segredos SUPABASE_SESSION_POOLER_URL e SUPABASE_DB_PASSWORD.')
}

const poolerUrl = new URL(poolerUrlValue)
if (!poolerUrl.hostname.endsWith('.pooler.supabase.com')) {
  throw new Error('SUPABASE_SESSION_POOLER_URL precisa apontar para o Session Pooler do Supabase.')
}
const supabaseCa = process.env.SUPABASE_CA_CERT?.replace(/\\n/g, '\n')

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Configure SUPABASE_URL e SUPABASE_ANON_KEY para autenticar as chamadas da API.')
}

const pool = new Pool({
  host: poolerUrl.hostname,
  port: Number(poolerUrl.port || 5432),
  user: decodeURIComponent(poolerUrl.username),
  password: databasePassword,
  database: decodeURIComponent(poolerUrl.pathname.slice(1)),
  ssl: supabaseCa
    ? { ca: supabaseCa, rejectUnauthorized: true }
    : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  max: 10,
})

const app = express()
app.use(cors())
app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ extended: true, limit: '100mb' }))

const verifiedSupabaseTokens = new Map()
const SUPABASE_TOKEN_CACHE_MS = 20_000

async function requireSupabaseUser(req, res, next) {
  const match = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)
  if (!match) return res.status(401).json({ error: 'Faça login para acessar estes dados.' })

  const token = match[1]
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const cached = verifiedSupabaseTokens.get(tokenHash)
  if (cached && cached.expiresAt > Date.now()) {
    req.supabaseUserId = cached.userId
    return next()
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(6000),
    })
    if (response.status === 401 || response.status === 403) {
      verifiedSupabaseTokens.delete(tokenHash)
      return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' })
    }
    if (!response.ok) {
      return res.status(503).json({ error: 'Não foi possível validar a sessão no Supabase.' })
    }

    const user = await response.json()
    if (!user?.id) return res.status(401).json({ error: 'Sessão Supabase inválida.' })

    if (verifiedSupabaseTokens.size >= 2000) {
      const oldestKey = verifiedSupabaseTokens.keys().next().value
      if (oldestKey) verifiedSupabaseTokens.delete(oldestKey)
    }
    verifiedSupabaseTokens.set(tokenHash, {
      userId: user.id,
      expiresAt: Date.now() + SUPABASE_TOKEN_CACHE_MS,
    })
    req.supabaseUserId = user.id
    return next()
  } catch {
    return res.status(503).json({ error: 'Autenticação Supabase temporariamente indisponível.' })
  }
}

app.use([
  '/api/ocorrencias',
  '/api/vistorias',
  '/api/imoveis',
  '/api/areas-risco',
  '/api/tempo-areas-risco',
  '/api/stats',
  '/api/geojson',
  '/api/monitoramento',
  '/api/precipitacoes',
], requireSupabaseUser)

// ── Auth ──────────────────────────────────────────────────────
function getUsuarios() {
  try {
    if (process.env.AUTH_USERS_JSON) {
      return JSON.parse(process.env.AUTH_USERS_JSON)
    }
  } catch (_) {}
  return []
}

app.post('/api/auth/login', (req, res) => {
  const { email, senha } = req.body
  if (!email || !senha) return res.status(400).json({ error: 'Credenciais inválidas' })
  const emailNorm = email.trim().toLowerCase()
  const usuarios = getUsuarios()
  const ok = usuarios.some(u => u.email === emailNorm && u.senha === senha)
  if (ok) return res.json({ ok: true })
  return res.status(401).json({ error: 'E-mail ou senha incorretos.' })
})

// ── Inicialização e migrações aditivas do Supabase ────────────
try {
  await pool.query('SELECT 1')
  await pool.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS area_m2 REAL`)
  await pool.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS area_vertices JSONB`)
  await pool.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS construcoes JSONB`)
  await pool.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS altura_imovel REAL`)
  await pool.query(`ALTER TABLE vistoria_monitoramento ADD COLUMN IF NOT EXISTS area_terreno JSONB`)
  await pool.query(`ALTER TABLE vistoria_monitoramento ADD COLUMN IF NOT EXISTS vertices_casa JSONB`)
  await pool.query(`ALTER TABLE vistoria_monitoramento ADD COLUMN IF NOT EXISTS altura_casa REAL`)
  await pool.query(`ALTER TABLE vistoria_monitoramento ADD COLUMN IF NOT EXISTS trincas_casa JSONB`)
  await pool.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS edificacao_planta JSONB`)
  await pool.query(`ALTER TABLE vistoria_monitoramento ADD COLUMN IF NOT EXISTS edificacao_planta JSONB`)
  await pool.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS edificacao_vertices JSONB`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS precipitacoes (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      filename TEXT,
      dados JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('Conectado ao Supabase e esquema da API verificado.')
} catch (error) {
  console.error('Falha ao conectar ou preparar o banco Supabase:', error.message)
  process.exit(1)
}

const json = (arr) => arr ? JSON.stringify(arr) : null
const parse = (value) => {
  if (value == null || value === '') return []
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return [] }
}

// ── OCORRÊNCIAS ──────────────────────────────────────────────
app.get('/api/ocorrencias', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM ocorrencias ORDER BY data DESC')
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/ocorrencias', async (req, res) => {
  const { tipo, descricao, nivel, endereco, cidade, lat, lng, data } = req.body
  try {
    const { rows } = await pool.query(
      `INSERT INTO ocorrencias (tipo, descricao, nivel, endereco, cidade, lat, lng, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [tipo, descricao ?? null, nivel ?? 'medio', endereco ?? null, cidade ?? null,
       lat ?? null, lng ?? null, data ?? new Date().toISOString()]
    )
    res.json({ id: rows[0].id })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/ocorrencias/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM ocorrencias WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── VISTORIAS ────────────────────────────────────────────────
app.get('/api/vistorias', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vistorias ORDER BY data DESC')
    res.json(rows.map(r => ({
      ...r,
      patologias:     parse(r.patologias),
      processos:      parse(r.processos),
      caract_encosta: parse(r.caract_encosta),
      condEncosta:    r.cond_encosta,
      tipoTalude:     r.tipo_talude,
      anguloEncosta:  r.angulo_encosta,
      caractsEncosta: parse(r.caract_encosta),
      construcoes:    parse(r.construcoes),
      alturaImovel:   r.altura_imovel,
    })))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/vistorias', async (req, res) => {
  const {
    nome, cpf, telefone, endereco, solo, tipo_uso, risco,
    patologias, observacao, cidade, lat, lng,
    condEncosta, tipoTalude, processos, moradores,
    anguloEncosta, caractsEncosta,
    area_m2, area_vertices, construcoes, alturaImovel, edificacao_planta
  } = req.body
  try {
    const { rows } = await pool.query(
      `INSERT INTO vistorias
        (nome, cpf, telefone, endereco, solo, tipo_uso, risco,
         patologias, observacao, cidade,
         cond_encosta, tipo_talude, processos, moradores,
         angulo_encosta, caract_encosta, lat, lng,
         area_m2, area_vertices, construcoes, altura_imovel, edificacao_planta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,
      [nome, cpf ?? null, telefone ?? null, endereco ?? null,
       solo ?? null, tipo_uso ?? null, risco ?? null,
       json(patologias ?? []), observacao ?? null, cidade ?? null,
       condEncosta ?? null, tipoTalude ?? null,
       json(processos ?? []), moradores ? parseInt(moradores) : null,
       anguloEncosta ? parseFloat(anguloEncosta) : null, json(caractsEncosta ?? []),
       lat ?? null, lng ?? null,
       area_m2 ?? null,
       area_vertices ? (typeof area_vertices === 'string' ? area_vertices : JSON.stringify(area_vertices)) : null,
       construcoes ? (typeof construcoes === 'string' ? construcoes : JSON.stringify(construcoes)) : null,
       alturaImovel ? parseFloat(alturaImovel) : null,
       edificacao_planta ? (typeof edificacao_planta === 'string' ? edificacao_planta : JSON.stringify(edificacao_planta)) : null]
    )
    res.json({ id: rows[0].id })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/vistorias/:id', async (req, res) => {
  const {
    nome, cpf, telefone, endereco, solo, tipo_uso, risco,
    patologias, observacao, cidade, lat, lng,
    condEncosta, tipoTalude, processos, moradores,
    anguloEncosta, caractsEncosta,
    area_m2, area_vertices, construcoes, alturaImovel, edificacao_planta
  } = req.body
  try {
    await pool.query(
      `UPDATE vistorias SET
        nome=$1, cpf=$2, telefone=$3, endereco=$4, solo=$5, tipo_uso=$6, risco=$7,
        patologias=$8, observacao=$9, cidade=$10,
        cond_encosta=$11, tipo_talude=$12, processos=$13, moradores=$14,
        angulo_encosta=$15, caract_encosta=$16, lat=$17, lng=$18,
        area_m2=$19, area_vertices=$20, construcoes=$21, altura_imovel=$22,
        edificacao_planta=$24
       WHERE id=$23`,
      [nome, cpf ?? null, telefone ?? null, endereco ?? null,
       solo ?? null, tipo_uso ?? null, risco ?? null,
       json(patologias ?? []), observacao ?? null, cidade ?? null,
       condEncosta ?? null, tipoTalude ?? null,
       json(processos ?? []), moradores ? parseInt(moradores) : null,
       anguloEncosta ? parseFloat(anguloEncosta) : null, json(caractsEncosta ?? []),
       lat ?? null, lng ?? null,
       area_m2 ?? null,
       area_vertices ? (typeof area_vertices === 'string' ? area_vertices : JSON.stringify(area_vertices)) : null,
       construcoes ? (typeof construcoes === 'string' ? construcoes : JSON.stringify(construcoes)) : null,
       alturaImovel ? parseFloat(alturaImovel) : null,
       req.params.id,
       edificacao_planta ? (typeof edificacao_planta === 'string' ? edificacao_planta : JSON.stringify(edificacao_planta)) : null]
    )
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/vistorias/:id/edificacao', async (req, res) => {
  const { edificacao_planta } = req.body
  try {
    await pool.query(
      'UPDATE vistorias SET edificacao_planta=$1 WHERE id=$2',
      [edificacao_planta ? (typeof edificacao_planta === 'string' ? edificacao_planta : JSON.stringify(edificacao_planta)) : null,
       req.params.id]
    )
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/vistorias/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM vistorias WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── IMÓVEIS ──────────────────────────────────────────────────
app.get('/api/imoveis', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM imoveis ORDER BY criado_em DESC')
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/imoveis', async (req, res) => {
  const { nome, tipo, endereco, proprietario, contato, situacao, moradores, obs, cidade, lat, lng } = req.body
  try {
    const { rows } = await pool.query(
      `INSERT INTO imoveis (nome, tipo, endereco, proprietario, contato, situacao, moradores, obs, cidade, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [nome ?? null, tipo ?? null, endereco, proprietario ?? null,
       contato ?? null, situacao ?? 'regular', moradores ?? null,
       obs ?? null, cidade ?? null, lat ?? null, lng ?? null]
    )
    res.json({ id: rows[0].id })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/imoveis/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM imoveis WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── ÁREAS DE RISCO ────────────────────────────────────────────
const TIPOS_AREAS_RISCO = new Set([
  'Encostas', 'Erosões', 'Drenagem', 'Alagamentos', 'Deslizamentos',
  'Problemas de vias', 'Obras', 'Interdições',
])

function validarPoligonoArea(geojson) {
  let geometry = geojson
  if (geometry?.type === 'Feature') geometry = geometry.geometry
  const ring = geometry?.type === 'Polygon' ? geometry.coordinates?.[0] : null
  if (!Array.isArray(ring) || ring.length < 4) return null
  const points = ring.map(point => [Number(point?.[0]), Number(point?.[1])])
  if (points.some(([lng, lat]) =>
    !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    !Number.isFinite(lat) || lat < -90 || lat > 90
  )) return null
  const first = points[0]
  const last = points[points.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first])
  return { type: 'Polygon', coordinates: [points] }
}

function centroidePoligono(geometry) {
  const ring = geometry.coordinates[0].slice(0, -1)
  const total = ring.reduce((sum, [lng, lat]) => ({
    latitude: sum.latitude + lat,
    longitude: sum.longitude + lng,
  }), { latitude: 0, longitude: 0 })
  return { latitude: total.latitude / ring.length, longitude: total.longitude / ring.length }
}

app.get('/api/areas-risco', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM areas_risco ORDER BY criado_em DESC')
    res.json(rows.map(r => ({ ...r, geojson: parse(r.geojson) })))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/areas-risco', async (req, res) => {
  const {
    nivel, tipo, descricao, cidade, latitude, longitude, data_inicio,
    limite_precipitacao_mm, referencia, observacao, geojson,
  } = req.body
  const geometry = validarPoligonoArea(geojson)
  if (!geometry) return res.status(400).json({ error: 'Desenhe um polígono válido com pelo menos três pontos.' })
  if (!['R1', 'R2', 'R3', 'R4'].includes(nivel)) return res.status(400).json({ error: 'Selecione um nível de risco válido.' })
  if (!TIPOS_AREAS_RISCO.has(tipo)) return res.status(400).json({ error: 'Selecione um tipo de área de risco válido.' })
  if (!['ouro_branco', 'congonhas'].includes(cidade)) return res.status(400).json({ error: 'Selecione Congonhas ou Ouro Branco.' })
  const limite = tipo === 'Interdições' ? 0 : Number(limite_precipitacao_mm)
  if (!Number.isFinite(limite) || limite < 0 || limite > 10000) {
    return res.status(400).json({ error: 'Informe um limite de chuva válido, em milímetros.' })
  }
  const centro = centroidePoligono(geometry)
  const lat = latitude == null ? centro.latitude : Number(latitude)
  const lng = longitude == null ? centro.longitude : Number(longitude)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'A localização da área de risco é inválida.' })
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO areas_risco
        (nivel, tipo, descricao, cidade, latitude, longitude, data_inicio,
         limite_precipitacao_mm, referencia, observacao, geojson)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        nivel, tipo, descricao?.trim() || null, cidade, lat, lng,
        data_inicio || new Date().toISOString().slice(0, 10), limite,
        referencia?.trim() || null, observacao?.trim() || null, JSON.stringify(geometry),
      ]
    )
    res.json({ id: rows[0].id })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/areas-risco/:id', async (req, res) => {
  const {
    nivel, tipo, descricao, cidade, latitude, longitude, data_inicio,
    limite_precipitacao_mm, referencia, observacao, geojson,
  } = req.body
  const geometry = validarPoligonoArea(geojson)
  if (!geometry) return res.status(400).json({ error: 'Desenhe um polígono válido com pelo menos três pontos.' })
  if (!['R1', 'R2', 'R3', 'R4'].includes(nivel)) return res.status(400).json({ error: 'Selecione um nível de risco válido.' })
  if (!TIPOS_AREAS_RISCO.has(tipo)) return res.status(400).json({ error: 'Selecione um tipo de área de risco válido.' })
  if (!['ouro_branco', 'congonhas'].includes(cidade)) return res.status(400).json({ error: 'Selecione Congonhas ou Ouro Branco.' })
  const limite = tipo === 'Interdições' ? 0 : Number(limite_precipitacao_mm)
  if (!Number.isFinite(limite) || limite < 0 || limite > 10000) {
    return res.status(400).json({ error: 'Informe um limite de chuva válido, em milímetros.' })
  }
  const centro = centroidePoligono(geometry)
  const lat = latitude == null ? centro.latitude : Number(latitude)
  const lng = longitude == null ? centro.longitude : Number(longitude)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'A localização da área de risco é inválida.' })
  }
  try {
    const { rows } = await pool.query(
      `UPDATE areas_risco
       SET nivel=$1, tipo=$2, descricao=$3, cidade=$4, latitude=$5, longitude=$6,
           data_inicio=$7, limite_precipitacao_mm=$8, referencia=$9, observacao=$10, geojson=$11
       WHERE id=$12 RETURNING id`,
      [
        nivel, tipo, descricao?.trim() || null, cidade, lat, lng,
        data_inicio || new Date().toISOString().slice(0, 10), limite,
        referencia?.trim() || null, observacao?.trim() || null, JSON.stringify(geometry),
        req.params.id,
      ]
    )
    if (!rows.length) return res.status(404).json({ error: 'Área de risco não encontrada.' })
    res.json({ id: rows[0].id })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/areas-risco/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM areas_risco WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

const areasRiscoPrevisaoCache = new Map()
const AREAS_RISCO_PREVISAO_TTL_MS = 10 * 60 * 1000

app.post('/api/tempo-areas-risco', async (req, res) => {
  const areas = Array.isArray(req.body?.areas) ? req.body.areas : []
  if (areas.length < 1 || areas.length > 50) {
    return res.status(400).json({ erro: 'Envie de 1 a 50 áreas para consultar a previsão.' })
  }
  const validAreas = areas.map(area => ({
    id: String(area?.id ?? '').trim(),
    latitude: Number(area?.latitude),
    longitude: Number(area?.longitude),
  }))
  if (validAreas.some(area =>
    !area.id ||
    !Number.isFinite(area.latitude) || area.latitude < -90 || area.latitude > 90 ||
    !Number.isFinite(area.longitude) || area.longitude < -180 || area.longitude > 180
  )) {
    return res.status(400).json({ erro: 'Uma ou mais áreas têm coordenadas inválidas.' })
  }

  const cacheKey = validAreas.map(area =>
    `${area.id}:${area.latitude.toFixed(3)}:${area.longitude.toFixed(3)}`
  ).join('|')
  const cached = areasRiscoPrevisaoCache.get(cacheKey)
  if (cached && Date.now() - cached.atualizadoEm < AREAS_RISCO_PREVISAO_TTL_MS) {
    return res.json({
      previsoes: cached.previsoes,
      atualizadoEm: new Date(cached.atualizadoEm).toISOString(),
      cache: true,
    })
  }

  try {
    const params = new URLSearchParams({
      latitude: validAreas.map(area => area.latitude.toFixed(4)).join(','),
      longitude: validAreas.map(area => area.longitude.toFixed(4)).join(','),
      timezone: 'America/Sao_Paulo',
      forecast_days: '2',
      precipitation_unit: 'mm',
      hourly: 'precipitation',
    })
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`Open-Meteo: ${response.status}`)
    const body = await response.json()
    const previsoes = validAreas.map((area, index) => {
      const pointForecast = Array.isArray(body) ? body[index] : body
      const hourly = pointForecast?.hourly?.precipitation
      const total = Array.isArray(hourly)
        ? hourly.slice(0, 24).reduce((sum, value) => (
          sum + (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0)
        ), 0)
        : null
      return { id: area.id, precipitacao_24h_mm: total }
    })
    const updatedAt = Date.now()
    areasRiscoPrevisaoCache.set(cacheKey, { previsoes, atualizadoEm: updatedAt })
    if (areasRiscoPrevisaoCache.size > 100) {
      const oldestKey = areasRiscoPrevisaoCache.keys().next().value
      if (oldestKey) areasRiscoPrevisaoCache.delete(oldestKey)
    }
    res.json({ previsoes, atualizadoEm: new Date(updatedAt).toISOString(), cache: false })
  } catch (error) {
    console.error('Erro na previsão para áreas de risco:', error?.message || error)
    if (cached) {
      return res.json({
        previsoes: cached.previsoes,
        atualizadoEm: new Date(cached.atualizadoEm).toISOString(),
        cache: true,
        erroAtualizacao: true,
      })
    }
    res.status(503).json({ erro: 'Previsão de precipitação para as áreas de risco indisponível.' })
  }
})

// ── ESTATÍSTICAS ──────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const [oc, vi, im, ar] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM ocorrencias'),
      pool.query('SELECT COUNT(*) as count FROM vistorias'),
      pool.query('SELECT COUNT(*) as count FROM imoveis'),
      pool.query('SELECT COUNT(*) as count FROM areas_risco'),
    ])
    res.json({
      ocorrencias: parseInt(oc.rows[0].count),
      vistorias:   parseInt(vi.rows[0].count),
      imoveis:     parseInt(im.rows[0].count),
      areas_risco: parseInt(ar.rows[0].count),
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── GeoJSON ────────────────────────────────────────────────────
app.get('/api/geojson/ocorrencias', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, tipo, nivel, descricao, data, lat, lng FROM ocorrencias WHERE lat IS NOT NULL'
    )
    res.json({
      type: 'FeatureCollection',
      features: rows.map(r => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: { id: r.id, tipo: r.tipo, nivel: r.nivel, descricao: r.descricao, data: r.data }
      }))
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/geojson/areas-risco', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nivel, tipo, cidade, latitude, longitude, data_inicio,
              limite_precipitacao_mm, referencia, observacao, descricao, geojson
       FROM areas_risco WHERE geojson IS NOT NULL`
    )
    res.json({
      type: 'FeatureCollection',
      features: rows.map(r => ({
        type: 'Feature',
        geometry: parse(r.geojson),
        properties: {
          id: r.id, nivel: r.nivel, tipo: r.tipo, cidade: r.cidade,
          latitude: r.latitude, longitude: r.longitude, data_inicio: r.data_inicio,
          limite_precipitacao_mm: r.limite_precipitacao_mm,
          referencia: r.referencia, observacao: r.observacao, descricao: r.descricao,
        }
      }))
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── PROXY TILES SATÉLITE ESRI World Imagery ─────────────────────────────────
// ESRI bloqueia CORS no canvas; proxy re-serve com CORS correto + cache 24h.
app.get('/api/sat-tile/:z/:y/:x', async (req, res) => {
  const { z, x, y } = req.params
  if (isNaN(z) || isNaN(x) || isNaN(y)) return res.status(400).send('bad params')
  try {
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
    const r = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Mozilla/5.0 Geovistorias/1.0' },
    })
    if (!r.ok) return res.status(r.status).send()
    const buf = Buffer.from(await r.arrayBuffer())
    res.set('Content-Type', 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=86400, immutable')
    res.set('Access-Control-Allow-Origin', '*')
    res.send(buf)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// ── PROXY TILES OSM / Topo / CartoDB ───────────────────────────────────────
// O Replit bloqueia fetch direto do browser para servidores externos de tiles.
// O servidor Node.js faz a requisição server-side e repassa com CORS correto.

const TILE_SOURCES = {
  osm:     ({ z, x, y }) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  topo:    ({ z, x, y }) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`,
  esri:    ({ z, x, y }) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`,
  carto_l: ({ z, x, y }) => `https://a.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`,
  carto_d: ({ z, x, y }) => `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`,
}

app.get('/api/map-tile/:src/:z/:x/:y', async (req, res) => {
  const { src, z, x, y } = req.params
  const builder = TILE_SOURCES[src]
  if (!builder) return res.status(400).send('fonte inválida')
  if (isNaN(z) || isNaN(x) || isNaN(y)) return res.status(400).send('bad params')
  try {
    const url = builder({ z, x, y })
    const r = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Mozilla/5.0 Geovistorias/1.0', 'Referer': 'https://www.openstreetmap.org/' },
    })
    if (!r.ok) return res.status(r.status).send()
    const buf = Buffer.from(await r.arrayBuffer())
    const ct = r.headers.get('content-type') || 'image/png'
    res.set('Content-Type', ct)
    res.set('Cache-Control', 'public, max-age=86400, immutable')
    res.set('Access-Control-Allow-Origin', '*')
    res.send(buf)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// ── PROXY TILES DEM Terrarium (AWS S3) ─────────────────────────────────────
// Necessário para evitar "tainted canvas" no browser:
// a S3 não envia Access-Control-Allow-Origin, logo getImageData() falha.
// Este endpoint re-serve o tile PNG com CORS correto + cache 24h.
app.get('/api/dem-tile/:z/:x/:y', async (req, res) => {
  const { z, x, y } = req.params
  if (isNaN(z) || isNaN(x) || isNaN(y)) return res.status(400).send('bad params')
  try {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) return res.status(r.status).send()
    const buf = Buffer.from(await r.arrayBuffer())
    res.set('Content-Type', 'image/png')
    res.set('Cache-Control', 'public, max-age=86400, immutable')
    res.set('Access-Control-Allow-Origin', '*')
    res.send(buf)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// ── PROXY DOWNLOAD DEM (OpenTopography) ────────────────────────────────────
// Evita CORS: browser → nosso servidor → OpenTopography → binário GeoTIFF
app.get('/api/dem-download', async (req, res) => {
  const { south, north, west, east, apiKey } = req.query
  if (!south || !north || !west || !east) return res.status(400).json({ error: 'Parâmetros south/north/west/east obrigatórios' })
  if (!apiKey) return res.status(400).json({ error: 'apiKey obrigatório' })
  try {
    const url = `https://portal.opentopography.org/API/globaldem?demtype=COP30` +
      `&south=${south}&north=${north}&west=${west}&east=${east}` +
      `&outputFormat=GTiff&API_Key=${apiKey}`
    const r = await fetch(url, { signal: AbortSignal.timeout(120000) })
    if (!r.ok) {
      const txt = await r.text().catch(() => '')
      return res.status(r.status).json({ error: `OpenTopography: HTTP ${r.status} — ${txt.slice(0, 200)}` })
    }
    const buf = Buffer.from(await r.arrayBuffer())
    res.set('Content-Type', 'image/tiff')
    res.set('Cache-Control', 'no-store')
    res.set('Access-Control-Allow-Origin', '*')
    res.send(buf)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// ── PROXY ELEVAÇÃO ─────────────────────────────────────────────────────────
// Ordem de qualidade:
//   1. OpenTopoData Copernicus GLO-30 (30 m) — mesmo modelo do ESRI World TopoMap
//   2. Open-Meteo (90 m) — fallback rápido
app.get('/api/elevation', async (req, res) => {
  const { latitude, longitude } = req.query
  if (!latitude || !longitude) return res.status(400).json({ error: 'latitude e longitude obrigatórios' })

  // 1ª tentativa: Copernicus DEM GLO-30 via OpenTopoData
  try {
    const lats = latitude.split(',')
    const lngs = longitude.split(',')
    const locations = lats.map((lat, i) => `${lat},${lngs[i]}`).join('|')
    const url = `https://api.opentopodata.org/v1/copernicus30?locations=${locations}`
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (r.ok) {
      const data = await r.json()
      if (data.results?.length) {
        return res.json({ elevation: data.results.map(p => p.elevation ?? 0), source: 'copernicus30' })
      }
    }
  } catch (_) {}

  // 2ª tentativa: Open-Meteo 90 m
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (r.ok) {
      const data = await r.json()
      if (Array.isArray(data.elevation)) return res.json({ elevation: data.elevation, source: 'open-meteo' })
    }
  } catch (_) {}

  res.status(503).json({ error: 'Não foi possível obter dados de elevação' })
})

// ── PROXY PREVISÃO 7 DIAS ─────────────────────────────────────
app.get('/api/previsao', async (req, res) => {
  const { lat, lng } = req.query
  if (!lat || !lng) return res.status(400).json({ error: 'lat e lng obrigatórios' })
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_sum,precipitation_probability_max,weather_code,temperature_2m_max,temperature_2m_min&timezone=America%2FSao_Paulo&forecast_days=7`
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!r.ok) return res.status(502).json({ error: 'Falha na API de previsão' })
    const data = await r.json()
    res.json(data)
  } catch (e) {
    res.status(503).json({ error: 'Serviço de previsão indisponível' })
  }
})

// ── PROXY CLIMA ───────────────────────────────────────────────
app.get('/api/clima', async (req, res) => {
  const { lat, lng } = req.query
  if (!lat || !lng) return res.status(400).json({ error: 'lat e lng obrigatórios' })
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,apparent_temperature&forecast_days=1&timezone=America%2FSao_Paulo`
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) return res.status(502).json({ error: 'Falha na API de clima' })
    const data = await r.json()
    res.json(data.current)
  } catch (e) {
    res.status(503).json({ error: 'Serviço de clima indisponível' })
  }
})

// ── PROXY PLUVIOMÉTRICO GRID ───────────────────────────────────
app.get('/api/pluvio-grid', async (req, res) => {
  const { lats, lngs } = req.query
  if (!lats || !lngs) return res.status(400).json({ error: 'lats e lngs obrigatórios' })
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&daily=precipitation_sum&timezone=America%2FSao_Paulo&past_days=7&forecast_days=0`
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) return res.status(502).json({ error: 'Falha na API pluviométrica' })
    const data = await r.json()
    res.json(data)
  } catch (e) {
    res.status(503).json({ error: 'Serviço pluviométrico indisponível' })
  }
})

// ── Helpers ───────────────────────────────────────────────────
const parseJ = (v, fb) => {
  if (!v) return fb
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return fb }
}

// Move URLs do relatório → fotoStore; retorna relatório sem URLs
const stripUrls = (report, fotoStore) => {
  const fotos = (report.fotosAnomalias || []).map(foto => {
    if (foto.url) fotoStore[foto.id] = foto.url
    const { url, ...rest } = foto
    return rest
  })
  return { ...report, fotosAnomalias: fotos }
}

// Enriquece fotos do relatório com URLs do fotoStore (fallback: URL inline legado)
const addUrls = (report, fotoStore) => ({
  ...report,
  fotosAnomalias: (report.fotosAnomalias || []).map(foto => ({
    ...foto,
    url: fotoStore[foto.id] || foto.url || ''
  }))
})

// ── Helper de serialização ────────────────────────────────────
const toMon = r => {
  const fotoStore = parseJ(r.foto_store, {})
  const relsSalvos = parseJ(r.relatorios_salvos, []).map(rel => addUrls(rel, fotoStore))
  return {
    id: r.id, createdAt: r.created_at, proprietario: r.proprietario,
    cidade: r.cidade, endereco: r.endereco, celular: r.celular,
    latitude: r.latitude, longitude: r.longitude, nome: r.nome,
    fotosAnomalias: parseJ(r.fotos_anomalias, []),
    relatoriosSalvos: relsSalvos,
    areaTerrenho: parseJ(r.area_terreno, []),
    verticesCasa:  parseJ(r.vertices_casa, []),
    alturaCasa:    r.altura_casa || null,
    trincasCasa:   parseJ(r.trincas_casa, []),
    edificacaoPlanta: parseJ(r.edificacao_planta, null),
  }
}

// ── MONITORAMENTO ─────────────────────────────────────────────
app.get('/api/monitoramento', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM vistoria_monitoramento ORDER BY created_at DESC'
    )
    res.json(rows.map(toMon))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/monitoramento/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM vistoria_monitoramento WHERE id = $1', [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' })
    res.json(toMon(rows[0]))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/monitoramento', async (req, res) => {
  const { proprietario, cidade, endereco, celular, latitude, longitude, nome,
          areaTerrenho, verticesCasa, alturaCasa, trincasCasa, edificacaoPlanta } = req.body
  if (!proprietario) return res.status(400).json({ error: 'proprietario obrigatório' })
  try {
    const newId = `imovel_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const { rows } = await pool.query(
      `INSERT INTO vistoria_monitoramento
         (id, proprietario, cidade, endereco, celular, latitude, longitude, nome,
          area_terreno, vertices_casa, altura_casa, trincas_casa, edificacao_planta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [newId, proprietario, cidade||null, endereco||null, celular||null,
       latitude||null, longitude||null, nome||proprietario,
       areaTerrenho    ? JSON.stringify(areaTerrenho)    : null,
       verticesCasa    ? JSON.stringify(verticesCasa)    : null,
       alturaCasa      ? parseFloat(alturaCasa)          : null,
       trincasCasa     ? JSON.stringify(trincasCasa)     : null,
       edificacaoPlanta ? JSON.stringify(edificacaoPlanta) : null]
    )
    res.status(201).json(toMon(rows[0]))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/monitoramento/:id', async (req, res) => {
  const { proprietario, cidade, endereco, celular, latitude, longitude, nome,
          areaTerrenho, verticesCasa, alturaCasa, trincasCasa, edificacaoPlanta } = req.body
  try {
    const { rows } = await pool.query(
      `UPDATE vistoria_monitoramento SET
         proprietario=$1, cidade=$2, endereco=$3, celular=$4,
         latitude=$5, longitude=$6, nome=$7,
         area_terreno=$8, vertices_casa=$9, altura_casa=$10, trincas_casa=$11,
         edificacao_planta=$13
       WHERE id=$12 RETURNING *`,
      [proprietario, cidade||null, endereco||null, celular||null,
       latitude||null, longitude||null, nome||proprietario,
       areaTerrenho    ? JSON.stringify(areaTerrenho)    : null,
       verticesCasa    ? JSON.stringify(verticesCasa)    : null,
       alturaCasa      ? parseFloat(alturaCasa)          : null,
       trincasCasa     ? JSON.stringify(trincasCasa)     : null,
       req.params.id,
       edificacaoPlanta ? JSON.stringify(edificacaoPlanta) : null]
    )
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' })
    res.json(toMon(rows[0]))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/monitoramento/:id/relatorio/:relId', async (req, res) => {
  const { createdAt, medicoes } = req.body
  try {
    const { rows } = await pool.query(
      'SELECT relatorios_salvos, foto_store FROM vistoria_monitoramento WHERE id=$1', [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' })
    let rels = parseJ(rows[0].relatorios_salvos, [])
    const fotoStore = parseJ(rows[0].foto_store, {})
    const idx = rels.findIndex(r => r.id === req.params.relId)
    if (idx === -1) return res.status(404).json({ error: 'Relatório não encontrado' })
    if (createdAt) rels[idx].createdAt = createdAt
    if (medicoes && rels[idx].fotosAnomalias) {
      rels[idx].fotosAnomalias = rels[idx].fotosAnomalias.map(foto => ({
        ...foto,
        linhas: (foto.linhas || []).map(line => {
          const key = `${foto.id}_${line.id}`
          return medicoes[key] !== undefined
            ? { ...line, comprimentos: medicoes[key] }
            : line
        })
      }))
    }
    await pool.query(
      'UPDATE vistoria_monitoramento SET relatorios_salvos=$1 WHERE id=$2',
      [JSON.stringify(rels), req.params.id]
    )
    res.json({ ok: true, relatorio: addUrls(rels[idx], fotoStore) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/monitoramento/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM vistoria_monitoramento WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/monitoramento/:id/fotos', async (req, res) => {
  const { id: photoId, base64, codigoTrinca, pontos, linhas, observacao } = req.body
  try {
    const { rows } = await pool.query(
      'SELECT fotos_anomalias FROM vistoria_monitoramento WHERE id = $1',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Imóvel não encontrado' })
    const photos = parseJ(rows[0].fotos_anomalias, [])
    const id = photoId || `foto-${Date.now()}`
    const existingIndex = photos.findIndex(item => String(item.id) === String(id))
    const existing = existingIndex >= 0 ? photos[existingIndex] : null
    const hasMeasurements = (Array.isArray(pontos) && pontos.length > 0) ||
      (Array.isArray(linhas) && linhas.length > 0)
    if (!base64 && !existing?.url && !hasMeasurements) {
      return res.status(400).json({ error: 'Informe uma imagem ou dados de medição.' })
    }
    const photo = {
      ...existing,
      id,
      url: base64 || existing?.url || '',
      codigoTrinca: codigoTrinca || '',
      pontos: Array.isArray(pontos) ? pontos : [],
      linhas: Array.isArray(linhas) ? linhas : [],
      observacao: observacao || '',
    }
    if (existingIndex >= 0) photos[existingIndex] = photo
    else photos.push(photo)
    await pool.query(
      'UPDATE vistoria_monitoramento SET fotos_anomalias = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(photos), req.params.id]
    )
    res.json({ success: true, id: photo.id, url: photo.url, photo })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/monitoramento/:id/relatorios', async (req, res) => {
  try {
    const newReport = req.body
    const { rows } = await pool.query('SELECT relatorios_salvos, foto_store FROM vistoria_monitoramento WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Imóvel não encontrado' })
    const current = parseJ(rows[0].relatorios_salvos, [])
    const fotoStore = parseJ(rows[0].foto_store, {})
    const reportSem = stripUrls(newReport, fotoStore)
    const updated = [...current, reportSem]
    await pool.query(
      'UPDATE vistoria_monitoramento SET relatorios_salvos = $1, foto_store = $2 WHERE id = $3',
      [JSON.stringify(updated), JSON.stringify(fotoStore), req.params.id]
    )
    res.status(201).json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/monitoramento/:id/relatorios/:relId', async (req, res) => {
  try {
    const updatedReport = req.body
    const { rows } = await pool.query('SELECT relatorios_salvos, foto_store FROM vistoria_monitoramento WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Imóvel não encontrado' })
    const current = parseJ(rows[0].relatorios_salvos, [])
    const fotoStore = parseJ(rows[0].foto_store, {})
    const reportSem = stripUrls(updatedReport, fotoStore)
    const updated = current.map(r => r.id === req.params.relId ? reportSem : r)
    await pool.query(
      'UPDATE vistoria_monitoramento SET relatorios_salvos = $1, foto_store = $2 WHERE id = $3',
      [JSON.stringify(updated), JSON.stringify(fotoStore), req.params.id]
    )
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/monitoramento/:id/relatorios/:relId', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT relatorios_salvos, foto_store FROM vistoria_monitoramento WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Imóvel não encontrado' })
    const current = parseJ(rows[0].relatorios_salvos, [])
    const fotoStore = parseJ(rows[0].foto_store, {})
    const removing = current.find(r => r.id === req.params.relId)
    if (removing) {
      (removing.fotosAnomalias || []).forEach(f => { delete fotoStore[f.id] })
    }
    const updated = current.filter(r => r.id !== req.params.relId)
    await pool.query(
      'UPDATE vistoria_monitoramento SET relatorios_salvos = $1, foto_store = $2 WHERE id = $3',
      [JSON.stringify(updated), JSON.stringify(fotoStore), req.params.id]
    )
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── PRECIPITAÇÕES (CSV de chuva) ──────────────────────────────
app.get('/api/precipitacoes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, filename, dados, updated_at FROM precipitacoes ORDER BY updated_at DESC LIMIT 1'
    )
    if (!rows.length) return res.json(null)
    const row = rows[0]
    let dados = row.dados
    try { dados = typeof dados === 'string' ? JSON.parse(dados) : dados } catch (_) {}
    res.json({ id: row.id, filename: row.filename, dados, updated_at: row.updated_at })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/precipitacoes', async (req, res) => {
  const { filename, dados } = req.body
  if (!dados) return res.status(400).json({ error: 'dados obrigatório' })
  try {
    // Substitui qualquer registro existente (apenas 1 dataset global)
    await pool.query('DELETE FROM precipitacoes')
    const { rows } = await pool.query(
      `INSERT INTO precipitacoes (filename, dados, updated_at)
       VALUES ($1, $2, NOW()) RETURNING id`,
      [filename ?? null, typeof dados === 'string' ? dados : JSON.stringify(dados)]
    )
    res.json({ id: rows[0].id })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/precipitacoes', async (req, res) => {
  try {
    await pool.query('DELETE FROM precipitacoes')
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Diagnóstico rápido ────────────────────────────────────────
app.get('/api/ping', (req, res) => res.json({ ok: true, ts: Date.now() }))

// ── Proxy para Vite dev server (tudo que não é /api) ──────────
const viteProxy = createProxyMiddleware({
  target: 'http://localhost:5173',
  changeOrigin: true,
  ws: true,
  on: {
    error: (_err, _req, res) => {
      const message = 'Vite dev server indisponível. Aguarde...'
      if (typeof res?.status === 'function') {
        res.status(502).send(message)
      } else if (typeof res?.writeHead === 'function' && typeof res?.end === 'function') {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(message)
      } else {
        res?.destroy?.()
      }
    }
  }
})

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  viteProxy(req, res, next)
})

const PORT = process.env.PORT || 5000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`)
})
