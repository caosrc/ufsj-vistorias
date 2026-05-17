import express from 'express'
import cors from 'cors'
import pg from 'pg'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const app = express()
app.use(cors())
app.use(express.json())

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
    })))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/vistorias', async (req, res) => {
  const {
    nome, cpf, telefone, endereco, solo, tipo_uso, risco,
    patologias, observacao, cidade, lat, lng,
    condEncosta, tipoTalude, processos, moradores,
    anguloEncosta, caractsEncosta
  } = req.body
  try {
    const { rows } = await pool.query(
      `INSERT INTO vistorias
        (nome, cpf, telefone, endereco, solo, tipo_uso, risco,
         patologias, observacao, cidade,
         cond_encosta, tipo_talude, processos, moradores,
         angulo_encosta, caract_encosta, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [nome, cpf ?? null, telefone ?? null, endereco ?? null,
       solo ?? null, tipo_uso ?? null, risco ?? null,
       json(patologias ?? []), observacao ?? null, cidade ?? null,
       condEncosta ?? null, tipoTalude ?? null,
       json(processos ?? []), moradores ?? null,
       anguloEncosta ?? null, json(caractsEncosta ?? []),
       lat ?? null, lng ?? null]
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

// ── PROXY ELEVAÇÃO ────────────────────────────────────────────
app.get('/api/elevation', async (req, res) => {
  const { latitude, longitude } = req.query
  if (!latitude || !longitude) return res.status(400).json({ error: 'latitude e longitude obrigatórios' })

  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (r.ok) {
      const data = await r.json()
      if (Array.isArray(data.elevation)) return res.json({ elevation: data.elevation })
    }
  } catch (_) {}

  try {
    const lats = latitude.split(',')
    const lngs = longitude.split(',')
    const locations = lats.map((lat, i) => `${lat},${lngs[i]}`).join('|')
    const url = `https://api.opentopodata.org/v1/srtm30m?locations=${locations}`
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (r.ok) {
      const data = await r.json()
      if (data.results?.length) {
        return res.json({ elevation: data.results.map(p => p.elevation ?? 0) })
      }
    }
  } catch (_) {}

  res.status(503).json({ error: 'Não foi possível obter dados de elevação' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`)
})
