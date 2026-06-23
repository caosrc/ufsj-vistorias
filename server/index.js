import express from 'express'
import cors from 'cors'
import pg from 'pg'
import { createProxyMiddleware } from 'http-proxy-middleware'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const app = express()
app.use(cors())
app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ extended: true, limit: '100mb' }))

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

// ── Migração automática de colunas novas ─────────────────────
;(async () => {
  try {
    await pool.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS area_m2 REAL`)
    await pool.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS area_vertices TEXT`)
    await pool.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS construcoes TEXT`)
    await pool.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS altura_imovel REAL`)
    await pool.query(`ALTER TABLE vistoria_monitoramento ADD COLUMN IF NOT EXISTS area_terreno TEXT`)
    await pool.query(`ALTER TABLE vistoria_monitoramento ADD COLUMN IF NOT EXISTS vertices_casa TEXT`)
    await pool.query(`ALTER TABLE vistoria_monitoramento ADD COLUMN IF NOT EXISTS altura_casa REAL`)
    await pool.query(`ALTER TABLE vistoria_monitoramento ADD COLUMN IF NOT EXISTS trincas_casa TEXT`)
    await pool.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS edificacao_planta TEXT`)
    await pool.query(`ALTER TABLE vistoria_monitoramento ADD COLUMN IF NOT EXISTS edificacao_planta TEXT`)
    await pool.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS edificacao_vertices TEXT`)
    // Tabela de precipitações (CSV importado pelo Monitoramento)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS precipitacoes (
        id          SERIAL PRIMARY KEY,
        filename    TEXT,
        dados       TEXT NOT NULL,
        updated_at  TIMESTAMP DEFAULT NOW()
      )
    `)
  } catch (_) {}
})()

const json = (arr) => arr ? JSON.stringify(arr) : null
const parse = (str) => { try { return str ? JSON.parse(str) : [] } catch { return [] } }

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
app.get('/api/areas-risco', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM areas_risco ORDER BY criado_em DESC')
    res.json(rows.map(r => ({ ...r, geojson: parse(r.geojson) })))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/areas-risco', async (req, res) => {
  const { nivel, descricao, cidade, geojson } = req.body
  try {
    const { rows } = await pool.query(
      `INSERT INTO areas_risco (nivel, descricao, cidade, geojson) VALUES ($1,$2,$3,$4) RETURNING id`,
      [nivel, descricao ?? null, cidade ?? null, JSON.stringify(geojson)]
    )
    res.json({ id: rows[0].id })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/areas-risco/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM areas_risco WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
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
      'SELECT id, nivel, descricao, geojson FROM areas_risco WHERE geojson IS NOT NULL'
    )
    res.json({
      type: 'FeatureCollection',
      features: rows.map(r => ({
        type: 'Feature',
        geometry: parse(r.geojson),
        properties: { id: r.id, nivel: r.nivel, descricao: r.descricao }
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

// ── Helper de serialização ────────────────────────────────────
const toMon = r => ({
  id: r.id, createdAt: r.created_at, proprietario: r.proprietario,
  cidade: r.cidade, endereco: r.endereco, celular: r.celular,
  latitude: r.latitude, longitude: r.longitude, nome: r.nome,
  fotosAnomalias: r.fotos_anomalias ? (typeof r.fotos_anomalias === 'string' ? JSON.parse(r.fotos_anomalias) : r.fotos_anomalias) : [],
  relatoriosSalvos: r.relatorios_salvos ? (typeof r.relatorios_salvos === 'string' ? JSON.parse(r.relatorios_salvos) : r.relatorios_salvos) : [],
  areaTerrenho: r.area_terreno ? (typeof r.area_terreno === 'string' ? JSON.parse(r.area_terreno) : r.area_terreno) : [],
  verticesCasa:  r.vertices_casa ? (typeof r.vertices_casa === 'string' ? JSON.parse(r.vertices_casa) : r.vertices_casa) : [],
  alturaCasa:    r.altura_casa || null,
  trincasCasa:   r.trincas_casa ? (typeof r.trincas_casa === 'string' ? JSON.parse(r.trincas_casa) : r.trincas_casa) : [],
  edificacaoPlanta: r.edificacao_planta ? (typeof r.edificacao_planta === 'string' ? JSON.parse(r.edificacao_planta) : r.edificacao_planta) : null,
})

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
      'SELECT relatorios_salvos FROM vistoria_monitoramento WHERE id=$1', [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' })
    let rels = rows[0].relatorios_salvos
      ? (typeof rows[0].relatorios_salvos === 'string' ? JSON.parse(rows[0].relatorios_salvos) : rows[0].relatorios_salvos)
      : []
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
    res.json({ ok: true, relatorio: rels[idx] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/monitoramento/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM vistoria_monitoramento WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/monitoramento/:id/fotos', async (req, res) => {
  const { base64, codigoTrinca } = req.body
  if (!base64) return res.status(400).json({ error: 'base64 obrigatório' })
  res.json({ success: true, url: base64 })
})

app.post('/api/monitoramento/:id/relatorios', async (req, res) => {
  try {
    const newReport = req.body
    const { rows } = await pool.query('SELECT relatorios_salvos FROM vistoria_monitoramento WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Imóvel não encontrado' })
    const raw = rows[0].relatorios_salvos
    const current = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : []
    const updated = [...current, newReport]
    await pool.query('UPDATE vistoria_monitoramento SET relatorios_salvos = $1 WHERE id = $2', [JSON.stringify(updated), req.params.id])
    res.status(201).json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/monitoramento/:id/relatorios/:relId', async (req, res) => {
  try {
    const updatedReport = req.body
    const { rows } = await pool.query('SELECT relatorios_salvos FROM vistoria_monitoramento WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Imóvel não encontrado' })
    const raw = rows[0].relatorios_salvos
    const current = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : []
    const updated = current.map(r => r.id === req.params.relId ? updatedReport : r)
    await pool.query('UPDATE vistoria_monitoramento SET relatorios_salvos = $1 WHERE id = $2', [JSON.stringify(updated), req.params.id])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/monitoramento/:id/relatorios/:relId', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT relatorios_salvos FROM vistoria_monitoramento WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Imóvel não encontrado' })
    const raw = rows[0].relatorios_salvos
    const current = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : []
    const updated = current.filter(r => r.id !== req.params.relId)
    await pool.query('UPDATE vistoria_monitoramento SET relatorios_salvos = $1 WHERE id = $2', [JSON.stringify(updated), req.params.id])
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
      res.status(502).send('Vite dev server indisponível. Aguarde...')
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
