import express from 'express'
import cors from 'cors'
import pg from 'pg'
import { createHmac, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProxyMiddleware } from 'http-proxy-middleware'

const { Pool } = pg
const serverDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDist = path.resolve(serverDir, '../defesa-civil/dist')
const poolerUrlValue = process.env.SUPABASE_SESSION_POOLER_URL
const databasePassword = process.env.SUPABASE_DB_PASSWORD
const supabaseUrlValue = process.env.VITE_SUPABASE_URL
const supabasePublicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const sessionSecret = process.env.SESSION_SECRET
if (!poolerUrlValue || !databasePassword) {
  throw new Error('Configure os segredos SUPABASE_SESSION_POOLER_URL e SUPABASE_DB_PASSWORD.')
}
if (!supabaseUrlValue || !supabasePublicKey || !sessionSecret) {
  throw new Error('Configure VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY e SESSION_SECRET.')
}

const poolerUrl = new URL(poolerUrlValue)
const supabaseUrl = new URL(supabaseUrlValue)
if (!poolerUrl.hostname.endsWith('.pooler.supabase.com')) {
  throw new Error('SUPABASE_SESSION_POOLER_URL precisa apontar para o Session Pooler do Supabase.')
}
if (!['https:', 'http:'].includes(supabaseUrl.protocol)) {
  throw new Error('VITE_SUPABASE_URL precisa ser uma URL HTTP ou HTTPS válida.')
}
const supabaseCa = process.env.SUPABASE_CA_CERT?.replace(/\\n/g, '\n')
const SESSION_COOKIE = 'sismar_session'
const SESSION_DURATION_SECONDS = 8 * 60 * 60

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
app.set('trust proxy', 1)
app.use(cors())
app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ extended: true, limit: '100mb' }))
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

// ── Inicialização e migrações aditivas do Supabase ────────────
try {
  await pool.query('SELECT 1')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.app_users (
      user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'resident'
        CHECK (role IN ('resident', 'staff', 'admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.cadastros_moradores (
      user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      nome_completo TEXT NOT NULL,
      telefone_whatsapp TEXT NOT NULL,
      email TEXT NOT NULL,
      quantidade_moradores INTEGER NOT NULL CHECK (quantidade_moradores BETWEEN 1 AND 100),
      endereco_completo TEXT NOT NULL,
      tipo_imovel TEXT NOT NULL CHECK (tipo_imovel IN ('casa', 'apartamento', 'barraco', 'sitio', 'outro')),
      ocupacao TEXT NOT NULL CHECK (ocupacao IN ('proprio', 'alugado', 'cedido', 'outro')),
      tempo_residencia TEXT NOT NULL,
      quantidade_criancas INTEGER CHECK (quantidade_criancas BETWEEN 0 AND 100),
      quantidade_idosos INTEGER CHECK (quantidade_idosos BETWEEN 0 AND 100),
      quantidade_mobilidade_reduzida INTEGER CHECK (quantidade_mobilidade_reduzida BETWEEN 0 AND 100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.sismar_usuario_interno()
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.app_users
        WHERE user_id = auth.uid() AND role IN ('staff', 'admin')
      )
    $$
  `)
  await pool.query('REVOKE ALL ON FUNCTION public.sismar_usuario_interno() FROM PUBLIC')
  await pool.query('GRANT EXECUTE ON FUNCTION public.sismar_usuario_interno() TO authenticated')
  await pool.query('ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY')
  await pool.query('REVOKE ALL ON public.app_users FROM anon, authenticated')
  await pool.query('ALTER TABLE public.cadastros_moradores ENABLE ROW LEVEL SECURITY')
  await pool.query('GRANT SELECT, INSERT, UPDATE ON public.cadastros_moradores TO authenticated')
  await pool.query('DROP POLICY IF EXISTS resident_profile_owner ON public.cadastros_moradores')
  await pool.query('CREATE POLICY resident_profile_owner ON public.cadastros_moradores FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())')
  await pool.query('DROP POLICY IF EXISTS resident_profile_internal_read ON public.cadastros_moradores')
  await pool.query('CREATE POLICY resident_profile_internal_read ON public.cadastros_moradores FOR SELECT TO authenticated USING (public.sismar_usuario_interno())')
  const internalTables = [
    'ocorrencias', 'vistorias', 'imoveis', 'areas_risco',
    'vistoria_monitoramento', 'monitoramento_relatorios', 'monitoramento_fotos',
    'arquivos_app', 'precipitacoes', 'escala_estado', 'materiais',
    'checklists_ferramental', 'emprestimos', 'equipamentos_campo',
    'checklists_viatura', 'planejamentos', 'monitoramento_cnl_cotas',
    'radar_bilhetes', 'push_subscriptions', 'sos_ativos_db',
    'curral_registros', 'procon_relatorios',
  ]
  for (const table of internalTables) {
    await pool.query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
    await pool.query(`DROP POLICY IF EXISTS shared_authenticated_all ON public.${table}`)
    await pool.query(`DROP POLICY IF EXISTS internal_staff_all ON public.${table}`)
    await pool.query(`CREATE POLICY internal_staff_all ON public.${table} FOR ALL TO authenticated USING (public.sismar_usuario_interno()) WITH CHECK (public.sismar_usuario_interno())`)
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO authenticated`)
  }
  await pool.query('ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY')
  await pool.query('DROP POLICY IF EXISTS profile_read_shared ON public.profiles')
  await pool.query('DROP POLICY IF EXISTS profile_read_self_or_staff ON public.profiles')
  await pool.query('CREATE POLICY profile_read_self_or_staff ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.sismar_usuario_interno())')
  // storage.objects is managed by Supabase and may not be owned by the app's
  // Session Pooler role. Its policies are configured by schema.sql in SQL Editor.
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

function signSession(userId) {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
  })).toString('base64url')
  const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function readSession(req) {
  const cookieHeader = req.headers.cookie || ''
  const cookie = cookieHeader.split(';').map((value) => value.trim())
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`))
  if (!cookie) return null

  const value = decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1))
  const [payload, signature] = value.split('.')
  if (!payload || !signature) return null
  const expected = createHmac('sha256', sessionSecret).update(payload).digest()
  let actual
  try { actual = Buffer.from(signature, 'base64url') } catch { return null }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return session.exp > Math.floor(Date.now() / 1000) ? session : null
  } catch {
    return null
  }
}

function setSessionCookie(req, res, userId) {
  res.cookie(SESSION_COOKIE, signSession(userId), {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_DURATION_SECONDS * 1000,
  })
}

async function requireSession(req, res, next) {
  const session = readSession(req)
  if (!session?.sub) return res.status(401).json({ error: 'Entre na sua conta para continuar.' })
  try {
    const { rows } = await pool.query(
      'SELECT user_id, email, role FROM public.app_users WHERE user_id = $1',
      [session.sub],
    )
    if (!rows[0]) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' })
    req.appUser = {
      id: rows[0].user_id,
      email: rows[0].email,
      role: rows[0].role,
    }
    next()
  } catch (error) {
    console.error('Falha ao consultar usuário autenticado:', error.message)
    res.status(500).json({ error: 'Não foi possível validar sua conta.' })
  }
}

function requireInternal(req, res, next) {
  if (!['staff', 'admin'].includes(req.appUser?.role)) {
    return res.status(403).json({ error: 'Esta área é exclusiva dos setores autorizados.' })
  }
  next()
}

function requireAdmin(req, res, next) {
  if (req.appUser?.role !== 'admin') {
    return res.status(403).json({ error: 'Somente administradores podem convidar servidores.' })
  }
  next()
}

function requireResident(req, res, next) {
  if (req.appUser?.role !== 'resident') {
    return res.status(403).json({ error: 'Esta função é exclusiva do cadastro residencial.' })
  }
  next()
}

app.post('/api/auth/session', async (req, res) => {
  const accessToken = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) return res.status(401).json({ error: 'Sessão do Supabase não enviada.' })
  try {
    const response = await fetch(new URL('/auth/v1/user', supabaseUrl), {
      headers: {
        apikey: supabasePublicKey,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return res.status(401).json({ error: 'Não foi possível confirmar sua sessão do Supabase.' })
    const authUser = await response.json()
    const email = String(authUser.email || '').trim().toLowerCase()
    if (!authUser.id || !email) return res.status(401).json({ error: 'A conta não possui um e-mail válido.' })
    if (!authUser.email_confirmed_at && !authUser.confirmed_at) {
      return res.status(403).json({ error: 'Confirme seu e-mail antes de acessar o cadastro.' })
    }

    const primeiroAdmin = String(process.env.SUPABASE_INITIAL_ADMIN_EMAIL || '').trim().toLowerCase()
    const bootstrapRole = primeiroAdmin && email === primeiroAdmin ? 'admin' : 'resident'
    const { rows } = await pool.query(
      `INSERT INTO public.app_users (user_id, email, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         email = EXCLUDED.email,
         role = CASE WHEN EXCLUDED.role = 'admin' THEN 'admin' ELSE public.app_users.role END,
         updated_at = NOW()
       RETURNING user_id, email, role`,
      [authUser.id, email, bootstrapRole],
    )
    setSessionCookie(req, res, rows[0].user_id)
    res.json({ user: { id: rows[0].user_id, email: rows[0].email, role: rows[0].role } })
  } catch (error) {
    console.error('Falha ao abrir sessão:', error.message)
    res.status(502).json({ error: 'Não foi possível validar sua conta com o Supabase.' })
  }
})

app.get('/api/auth/session', requireSession, (req, res) => {
  res.json({ user: req.appUser })
})

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'strict',
    path: '/',
  })
  res.json({ ok: true })
})

app.get('/api/resident/profile', requireSession, requireResident, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM public.cadastros_moradores WHERE user_id = $1',
      [req.appUser.id],
    )
    res.json({ profile: rows[0] || null })
  } catch (error) {
    console.error('Falha ao carregar cadastro residencial:', error.message)
    res.status(500).json({ error: 'Não foi possível carregar seu cadastro.' })
  }
})

app.put('/api/resident/profile', requireSession, requireResident, async (req, res) => {
  const body = req.body || {}
  const text = (value, field, max) => {
    if (typeof value !== 'string') throw new Error(`Preencha ${field}.`)
    const normalized = value.trim()
    if (!normalized || normalized.length > max) throw new Error(`Confira o campo ${field}.`)
    return normalized
  }
  const count = (value, field, required = false) => {
    if ((value === '' || value == null) && !required) return null
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < (required ? 1 : 0) || parsed > 100) {
      throw new Error(`Informe uma quantidade válida para ${field}.`)
    }
    return parsed
  }

  try {
    const nome = text(body.nome_completo, 'nome completo', 160)
    const telefone = text(body.telefone_whatsapp, 'telefone/WhatsApp', 40)
    const moradores = count(body.quantidade_moradores, 'moradores', true)
    const endereco = text(body.endereco_completo, 'endereço completo', 500)
    const tempo = text(body.tempo_residencia, 'tempo de residência', 120)
    const tiposImovel = new Set(['casa', 'apartamento', 'barraco', 'sitio', 'outro'])
    const tiposOcupacao = new Set(['proprio', 'alugado', 'cedido', 'outro'])
    if (!tiposImovel.has(body.tipo_imovel)) throw new Error('Selecione um tipo de imóvel válido.')
    if (!tiposOcupacao.has(body.ocupacao)) throw new Error('Selecione um tipo de ocupação válido.')
    const values = [
      req.appUser.id,
      nome,
      telefone,
      req.appUser.email,
      moradores,
      endereco,
      body.tipo_imovel,
      body.ocupacao,
      tempo,
      count(body.quantidade_criancas, 'crianças'),
      count(body.quantidade_idosos, 'idosos'),
      count(body.quantidade_mobilidade_reduzida, 'pessoas com mobilidade reduzida'),
    ]
    const { rows } = await pool.query(
      `INSERT INTO public.cadastros_moradores (
         user_id, nome_completo, telefone_whatsapp, email, quantidade_moradores,
         endereco_completo, tipo_imovel, ocupacao, tempo_residencia,
         quantidade_criancas, quantidade_idosos, quantidade_mobilidade_reduzida
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (user_id) DO UPDATE SET
         nome_completo = EXCLUDED.nome_completo,
         telefone_whatsapp = EXCLUDED.telefone_whatsapp,
         email = EXCLUDED.email,
         quantidade_moradores = EXCLUDED.quantidade_moradores,
         endereco_completo = EXCLUDED.endereco_completo,
         tipo_imovel = EXCLUDED.tipo_imovel,
         ocupacao = EXCLUDED.ocupacao,
         tempo_residencia = EXCLUDED.tempo_residencia,
         quantidade_criancas = EXCLUDED.quantidade_criancas,
         quantidade_idosos = EXCLUDED.quantidade_idosos,
         quantidade_mobilidade_reduzida = EXCLUDED.quantidade_mobilidade_reduzida,
         updated_at = NOW()
       RETURNING *`,
      values,
    )
    res.json({ profile: rows[0] })
  } catch (error) {
    const isValidationError = error instanceof Error && !error.code
    if (isValidationError) return res.status(400).json({ error: error.message })
    console.error('Falha ao salvar cadastro residencial:', error.message)
    res.status(500).json({ error: 'Não foi possível salvar seu cadastro.' })
  }
})

app.post('/api/admin/invites', requireSession, requireAdmin, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const redirectTo = String(req.body?.redirectTo || '')
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(503).json({ error: 'Convites indisponíveis: configure a chave administrativa do Supabase.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' })

  try {
    const origin = req.get('origin')
    const redirect = new URL(redirectTo)
    if (!origin || redirect.origin !== origin || !redirect.pathname.startsWith('/setores/')) {
      return res.status(400).json({ error: 'O endereço de confirmação do convite não é válido.' })
    }
    const inviteUrl = new URL('/auth/v1/invite', supabaseUrl)
    inviteUrl.searchParams.set('redirect_to', redirect.href)
    const invitation = await fetch(inviteUrl, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(12000),
    })
    const result = await invitation.json().catch(() => ({}))
    if (!invitation.ok) {
      return res.status(invitation.status === 422 ? 409 : 502).json({
        error: result.msg || result.message || 'O Supabase não conseguiu enviar o convite.',
      })
    }
    if (!result.id) return res.status(502).json({ error: 'O Supabase não retornou o identificador da conta convidada.' })
    await pool.query(
      `INSERT INTO public.app_users (user_id, email, role)
       VALUES ($1, $2, 'staff')
       ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, role = 'staff', updated_at = NOW()`,
      [result.id, email],
    )
    res.status(201).json({ ok: true, email })
  } catch (error) {
    console.error('Falha ao enviar convite de servidor:', error.message)
    res.status(400).json({ error: 'Não foi possível enviar o convite. Confira o e-mail e as configurações de autenticação.' })
  }
})

app.use('/api', async (req, res, next) => {
  if (req.path === '/ping') return next()
  await requireSession(req, res, (error) => {
    if (error) return next(error)
    requireInternal(req, res, next)
  })
})

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

// ── Arquivos estáticos em produção e proxy para Vite no desenvolvimento ──
const productionBuild = process.env.NODE_ENV === 'production'
if (productionBuild) {
  app.use(express.static(frontendDist, { index: false, maxAge: '1d' }))
}

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
  if (productionBuild) {
    return res.sendFile(path.join(frontendDist, 'index.html'), (error) => {
      if (error) next(error)
    })
  }
  return viteProxy(req, res, next)
})

const PORT = process.env.PORT || 5000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`)
})
