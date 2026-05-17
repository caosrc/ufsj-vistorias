import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'PATCH', 'PUT'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// ── helpers ───────────────────────────────────────────────────
const json = (arr) => arr ? JSON.stringify(arr) : null
const parse = (str) => { try { return str ? JSON.parse(str) : [] } catch { return [] } }

// ── OCORRÊNCIAS ──────────────────────────────────────────────
app.get('/api/ocorrencias', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM ocorrencias ORDER BY data DESC'
    ).all()
    return c.json(results)
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.post('/api/ocorrencias', async (c) => {
  const { tipo, descricao, nivel, endereco, cidade, lat, lng, data } = await c.req.json()
  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO ocorrencias (tipo, descricao, nivel, endereco, cidade, lat, lng, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(tipo, descricao ?? null, nivel ?? 'medio', endereco ?? null, cidade ?? null,
           lat ?? null, lng ?? null, data ?? new Date().toISOString()).run()
    return c.json({ id: meta.last_row_id })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.delete('/api/ocorrencias/:id', async (c) => {
  try {
    await c.env.DB.prepare('DELETE FROM ocorrencias WHERE id = ?').bind(c.req.param('id')).run()
    return c.json({ ok: true })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

// ── VISTORIAS ────────────────────────────────────────────────
app.get('/api/vistorias', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM vistorias ORDER BY data DESC'
    ).all()
    return c.json(results.map(r => ({
      ...r,
      patologias:     parse(r.patologias),
      processos:      parse(r.processos),
      caract_encosta: parse(r.caract_encosta),
      condEncosta:    r.cond_encosta,
      tipoTalude:     r.tipo_talude,
      anguloEncosta:  r.angulo_encosta,
      caractsEncosta: parse(r.caract_encosta),
    })))
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.post('/api/vistorias', async (c) => {
  const {
    nome, cpf, telefone, endereco, solo, tipo_uso, risco,
    patologias, observacao, cidade, lat, lng,
    condEncosta, tipoTalude, processos, moradores,
    anguloEncosta, caractsEncosta
  } = await c.req.json()
  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO vistorias
        (nome, cpf, telefone, endereco, solo, tipo_uso, risco,
         patologias, observacao, cidade,
         cond_encosta, tipo_talude, processos, moradores,
         angulo_encosta, caract_encosta, lat, lng)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      nome, cpf ?? null, telefone ?? null, endereco ?? null,
      solo ?? null, tipo_uso ?? null, risco ?? null,
      json(patologias ?? []), observacao ?? null, cidade ?? null,
      condEncosta ?? null, tipoTalude ?? null,
      json(processos ?? []), moradores ?? null,
      anguloEncosta ?? null, json(caractsEncosta ?? []),
      lat ?? null, lng ?? null
    ).run()
    return c.json({ id: meta.last_row_id })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.delete('/api/vistorias/:id', async (c) => {
  try {
    await c.env.DB.prepare('DELETE FROM vistorias WHERE id = ?').bind(c.req.param('id')).run()
    return c.json({ ok: true })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

// ── IMÓVEIS ──────────────────────────────────────────────────
app.get('/api/imoveis', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM imoveis ORDER BY criado_em DESC'
    ).all()
    return c.json(results)
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.post('/api/imoveis', async (c) => {
  const { nome, tipo, endereco, proprietario, contato, situacao, moradores, obs, cidade, lat, lng } = await c.req.json()
  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO imoveis (nome, tipo, endereco, proprietario, contato, situacao, moradores, obs, cidade, lat, lng)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      nome ?? null, tipo ?? null, endereco, proprietario ?? null,
      contato ?? null, situacao ?? 'regular', moradores ?? null,
      obs ?? null, cidade ?? null, lat ?? null, lng ?? null
    ).run()
    return c.json({ id: meta.last_row_id })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.delete('/api/imoveis/:id', async (c) => {
  try {
    await c.env.DB.prepare('DELETE FROM imoveis WHERE id = ?').bind(c.req.param('id')).run()
    return c.json({ ok: true })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

// ── ÁREAS DE RISCO ────────────────────────────────────────────
app.get('/api/areas-risco', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM areas_risco ORDER BY criado_em DESC'
    ).all()
    return c.json(results.map(r => ({ ...r, geojson: parse(r.geojson) })))
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.post('/api/areas-risco', async (c) => {
  const { nivel, descricao, cidade, geojson } = await c.req.json()
  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO areas_risco (nivel, descricao, cidade, geojson) VALUES (?,?,?,?)`
    ).bind(nivel, descricao ?? null, cidade ?? null, JSON.stringify(geojson)).run()
    return c.json({ id: meta.last_row_id })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.delete('/api/areas-risco/:id', async (c) => {
  try {
    await c.env.DB.prepare('DELETE FROM areas_risco WHERE id = ?').bind(c.req.param('id')).run()
    return c.json({ ok: true })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

// ── ESTATÍSTICAS ──────────────────────────────────────────────
app.get('/api/stats', async (c) => {
  try {
    const [oc, vi, im, ar] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM ocorrencias').first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM vistorias').first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM imoveis').first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM areas_risco').first(),
    ])
    return c.json({
      ocorrencias: oc.count,
      vistorias: vi.count,
      imoveis: im.count,
      areas_risco: ar.count,
    })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

// ── GeoJSON ────────────────────────────────────────────────────
app.get('/api/geojson/ocorrencias', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, tipo, nivel, descricao, data, lat, lng FROM ocorrencias WHERE lat IS NOT NULL'
    ).all()
    return c.json({
      type: 'FeatureCollection',
      features: results.map(r => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: { id: r.id, tipo: r.tipo, nivel: r.nivel, descricao: r.descricao, data: r.data }
      }))
    })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.get('/api/geojson/areas-risco', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, nivel, descricao, geojson FROM areas_risco WHERE geojson IS NOT NULL'
    ).all()
    return c.json({
      type: 'FeatureCollection',
      features: results.map(r => ({
        type: 'Feature',
        geometry: parse(r.geojson),
        properties: { id: r.id, nivel: r.nivel, descricao: r.descricao }
      }))
    })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

// ── PROXY ELEVAÇÃO ────────────────────────────────────────────
app.get('/api/elevation', async (c) => {
  const latitude = c.req.query('latitude')
  const longitude = c.req.query('longitude')
  if (!latitude || !longitude) return c.json({ error: 'latitude e longitude obrigatórios' }, 400)

  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (r.ok) {
      const data = await r.json()
      if (Array.isArray(data.elevation)) return c.json({ elevation: data.elevation })
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
        return c.json({ elevation: data.results.map(p => p.elevation ?? 0) })
      }
    }
  } catch (_) {}

  return c.json({ error: 'Não foi possível obter dados de elevação' }, 503)
})

export default app
