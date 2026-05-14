import express from 'express'
import cors from 'cors'
import { Pool } from 'pg'

const app = express()
const PORT = 3001

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

app.use(cors())
app.use(express.json())

// ── Migração automática — adiciona colunas novas sem apagar dados ──
pool.query(`
  ALTER TABLE vistorias
    ADD COLUMN IF NOT EXISTS cond_encosta TEXT,
    ADD COLUMN IF NOT EXISTS tipo_talude  TEXT,
    ADD COLUMN IF NOT EXISTS processos    TEXT[],
    ADD COLUMN IF NOT EXISTS moradores    TEXT
`).catch(() => {})

// ── OCORRÊNCIAS ──────────────────────────────────────────────
app.get('/api/ocorrencias', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, tipo, descricao, nivel, endereco, cidade,
        ST_X(geom) AS lng, ST_Y(geom) AS lat,
        data
      FROM ocorrencias ORDER BY data DESC
    `)
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/ocorrencias', async (req, res) => {
  const { tipo, descricao, nivel, endereco, cidade, lat, lng, data } = req.body
  try {
    const geom = (lat && lng) ? `ST_SetSRID(ST_MakePoint($6, $7), 4326)` : 'NULL'
    const params = [tipo, descricao || null, nivel || 'medio', endereco || null, cidade || null]
    if (lat && lng) { params.push(lng, lat) }
    if (data) params.push(data)
    const dataParam = data ? `$${params.length}` : 'NOW()'
    const { rows } = await pool.query(
      `INSERT INTO ocorrencias (tipo, descricao, nivel, endereco, cidade, geom, data)
       VALUES ($1, $2, $3, $4, $5, ${lat && lng ? geom : 'NULL'}, ${dataParam})
       RETURNING id`,
      params
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
    const { rows } = await pool.query(`
      SELECT id, nome, cpf, telefone, endereco, solo, tipo_uso, risco,
        patologias, observacao, cidade,
        cond_encosta, tipo_talude, processos, moradores,
        ST_X(geom) AS lng, ST_Y(geom) AS lat, data
      FROM vistorias ORDER BY data DESC
    `)
    res.json(rows.map(r => ({
      ...r,
      condEncosta: r.cond_encosta,
      tipoTalude:  r.tipo_talude,
    })))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/vistorias', async (req, res) => {
  const { nome, cpf, telefone, endereco, solo, tipo_uso, risco,
    patologias, observacao, cidade, lat, lng,
    condEncosta, tipoTalude, processos, moradores } = req.body

  // Garantir que as colunas existam (idempotente)
  try {
    await pool.query(`
      ALTER TABLE vistorias
        ADD COLUMN IF NOT EXISTS cond_encosta TEXT,
        ADD COLUMN IF NOT EXISTS tipo_talude  TEXT,
        ADD COLUMN IF NOT EXISTS processos    TEXT[],
        ADD COLUMN IF NOT EXISTS moradores    TEXT
    `)
  } catch (_) {}

  try {
    const geomExpr = (lat && lng) ? `ST_SetSRID(ST_MakePoint($14, $15), 4326)` : 'NULL'
    const params = [
      nome, cpf || null, telefone || null, endereco || null,
      solo || null, tipo_uso || null, risco || null,
      patologias || [], observacao || null, cidade || null,
      condEncosta || null, tipoTalude || null,
      processos || [], moradores || null,
    ]
    if (lat && lng) params.push(lng, lat)
    const { rows } = await pool.query(
      `INSERT INTO vistorias
        (nome, cpf, telefone, endereco, solo, tipo_uso, risco,
         patologias, observacao, cidade,
         cond_encosta, tipo_talude, processos, moradores, geom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
               ${lat && lng ? geomExpr : 'NULL'})
       RETURNING id`,
      params
    )
    res.json({ id: rows[0].id })
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
    const { rows } = await pool.query(`
      SELECT id, nome, tipo, endereco, proprietario, contato, situacao,
        moradores, obs, cidade,
        ST_X(geom) AS lng, ST_Y(geom) AS lat, criado_em
      FROM imoveis ORDER BY criado_em DESC
    `)
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/imoveis', async (req, res) => {
  const { nome, tipo, endereco, proprietario, contato, situacao, moradores, obs, cidade, lat, lng } = req.body
  try {
    const geomExpr = (lat && lng) ? `ST_SetSRID(ST_MakePoint($10, $11), 4326)` : 'NULL'
    const params = [nome || null, tipo || null, endereco, proprietario || null,
      contato || null, situacao || 'regular', moradores || null, obs || null, cidade || null]
    if (lat && lng) { params.push(lng, lat) }
    const { rows } = await pool.query(
      `INSERT INTO imoveis (nome, tipo, endereco, proprietario, contato, situacao, moradores, obs, cidade, geom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, ${lat && lng ? geomExpr : 'NULL'})
       RETURNING id`,
      params
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
    const { rows } = await pool.query(`
      SELECT id, nivel, descricao, cidade, criado_em,
        ST_AsGeoJSON(geom)::json AS geojson
      FROM areas_risco ORDER BY criado_em DESC
    `)
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/areas-risco', async (req, res) => {
  const { nivel, descricao, cidade, geojson } = req.body
  try {
    const { rows } = await pool.query(
      `INSERT INTO areas_risco (nivel, descricao, cidade, geom)
       VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326))
       RETURNING id`,
      [nivel, descricao || null, cidade || null, JSON.stringify(geojson)]
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
      pool.query('SELECT COUNT(*) FROM ocorrencias'),
      pool.query('SELECT COUNT(*) FROM vistorias'),
      pool.query('SELECT COUNT(*) FROM imoveis'),
      pool.query('SELECT COUNT(*) FROM areas_risco'),
    ])
    res.json({
      ocorrencias: parseInt(oc.rows[0].count),
      vistorias: parseInt(vi.rows[0].count),
      imoveis: parseInt(im.rows[0].count),
      areas_risco: parseInt(ar.rows[0].count),
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── GeoJSON (para visualizar no mapa) ─────────────────────────
app.get('/api/geojson/ocorrencias', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT json_build_object(
        'type','FeatureCollection',
        'features', COALESCE(json_agg(
          json_build_object(
            'type','Feature',
            'geometry', ST_AsGeoJSON(geom)::json,
            'properties', json_build_object('id',id,'tipo',tipo,'nivel',nivel,'descricao',descricao,'data',data)
          )
        ) FILTER (WHERE geom IS NOT NULL), '[]'::json)
      ) AS fc
      FROM ocorrencias
    `)
    res.json(rows[0].fc)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/geojson/areas-risco', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT json_build_object(
        'type','FeatureCollection',
        'features', COALESCE(json_agg(
          json_build_object(
            'type','Feature',
            'geometry', ST_AsGeoJSON(geom)::json,
            'properties', json_build_object('id',id,'nivel',nivel,'descricao',descricao)
          )
        ) FILTER (WHERE geom IS NOT NULL), '[]'::json)
      ) AS fc
      FROM areas_risco
    `)
    res.json(rows[0].fc)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Defesa Civil rodando na porta ${PORT}`)
})
