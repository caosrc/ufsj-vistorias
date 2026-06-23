import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'PATCH', 'PUT'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// ── Autenticação ──────────────────────────────────────────────
app.post('/api/auth/login', async (c) => {
  const { email, senha } = await c.req.json().catch(() => ({}))
  if (!email || !senha) return c.json({ error: 'Credenciais inválidas' }, 400)

  let usuarios = []
  try {
    const raw = c.env?.AUTH_USERS_JSON
    if (raw) usuarios = JSON.parse(raw)
  } catch (_) {}

  const emailNorm = email.trim().toLowerCase()
  const ok = usuarios.some(u => u.email === emailNorm && u.senha === senha)
  if (ok) return c.json({ ok: true })
  return c.json({ error: 'E-mail ou senha incorretos.' }, 401)
})

// ── Migração automática de colunas novas no D1 ───────────────
let _migrated = false

async function runMigrations(db) {
  const migrations = [
    `ALTER TABLE vistorias ADD COLUMN area_m2 REAL`,
    `ALTER TABLE vistorias ADD COLUMN area_vertices TEXT`,
    `ALTER TABLE vistorias ADD COLUMN construcoes TEXT`,
    `ALTER TABLE vistorias ADD COLUMN altura_imovel REAL`,
    `ALTER TABLE vistorias ADD COLUMN edificacao_planta TEXT`,
    `CREATE TABLE IF NOT EXISTS vistoria_monitoramento (
      id                TEXT PRIMARY KEY,
      proprietario      TEXT NOT NULL,
      cidade            TEXT,
      endereco          TEXT,
      celular           TEXT,
      latitude          REAL,
      longitude         REAL,
      nome              TEXT,
      fotos_anomalias   TEXT DEFAULT '[]',
      relatorios_salvos TEXT DEFAULT '[]',
      area_terreno      TEXT,
      vertices_casa     TEXT,
      altura_casa       REAL,
      trincas_casa      TEXT,
      edificacao_planta TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    )`,
    `ALTER TABLE vistoria_monitoramento ADD COLUMN area_terreno TEXT`,
    `ALTER TABLE vistoria_monitoramento ADD COLUMN vertices_casa TEXT`,
    `ALTER TABLE vistoria_monitoramento ADD COLUMN altura_casa REAL`,
    `ALTER TABLE vistoria_monitoramento ADD COLUMN trincas_casa TEXT`,
    `ALTER TABLE vistoria_monitoramento ADD COLUMN edificacao_planta TEXT`,
    `ALTER TABLE vistoria_monitoramento ADD COLUMN latitude REAL`,
    `ALTER TABLE vistoria_monitoramento ADD COLUMN longitude REAL`,
    `CREATE TABLE IF NOT EXISTS precipitacoes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      filename   TEXT,
      dados      TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
  ]
  for (const sql of migrations) {
    try { await db.prepare(sql).run() } catch (_) {}
  }
}

app.use('*', async (c, next) => {
  if (c.env?.DB && !_migrated) {
    _migrated = true
    await runMigrations(c.env.DB)
  }
  return next()
})

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
      construcoes:    parse(r.construcoes),
      alturaImovel:   r.altura_imovel,
      area_vertices:  r.area_vertices || null,
      edificacaoPlanta: r.edificacao_planta
        ? (typeof r.edificacao_planta === 'string' ? JSON.parse(r.edificacao_planta) : r.edificacao_planta)
        : null,
    })))
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.post('/api/vistorias', async (c) => {
  const {
    nome, cpf, telefone, endereco, solo, tipo_uso, risco,
    patologias, observacao, cidade, lat, lng,
    condEncosta, tipoTalude, processos, moradores,
    anguloEncosta, caractsEncosta,
    area_m2, area_vertices, construcoes, alturaImovel, edificacao_planta
  } = await c.req.json()
  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO vistorias
        (nome, cpf, telefone, endereco, solo, tipo_uso, risco,
         patologias, observacao, cidade,
         cond_encosta, tipo_talude, processos, moradores,
         angulo_encosta, caract_encosta, lat, lng,
         area_m2, area_vertices, construcoes, altura_imovel, edificacao_planta)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      nome, cpf ?? null, telefone ?? null, endereco ?? null,
      solo ?? null, tipo_uso ?? null, risco ?? null,
      json(patologias ?? []), observacao ?? null, cidade ?? null,
      condEncosta ?? null, tipoTalude ?? null,
      json(processos ?? []), moradores ?? null,
      anguloEncosta ?? null, json(caractsEncosta ?? []),
      lat ?? null, lng ?? null,
      area_m2 ?? null,
      area_vertices ? (typeof area_vertices === 'string' ? area_vertices : JSON.stringify(area_vertices)) : null,
      construcoes ? (typeof construcoes === 'string' ? construcoes : JSON.stringify(construcoes)) : null,
      alturaImovel ? parseFloat(alturaImovel) : null,
      edificacao_planta ? (typeof edificacao_planta === 'string' ? edificacao_planta : JSON.stringify(edificacao_planta)) : null
    ).run()
    return c.json({ id: meta.last_row_id })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.put('/api/vistorias/:id', async (c) => {
  const {
    nome, cpf, telefone, endereco, solo, tipo_uso, risco,
    patologias, observacao, cidade, lat, lng,
    condEncosta, tipoTalude, processos, moradores,
    anguloEncosta, caractsEncosta,
    area_m2, area_vertices, construcoes, alturaImovel, edificacao_planta
  } = await c.req.json()
  try {
    await c.env.DB.prepare(
      `UPDATE vistorias SET
        nome=?, cpf=?, telefone=?, endereco=?, solo=?, tipo_uso=?, risco=?,
        patologias=?, observacao=?, cidade=?,
        cond_encosta=?, tipo_talude=?, processos=?, moradores=?,
        angulo_encosta=?, caract_encosta=?, lat=?, lng=?,
        area_m2=?, area_vertices=?, construcoes=?, altura_imovel=?, edificacao_planta=?
       WHERE id=?`
    ).bind(
      nome, cpf ?? null, telefone ?? null, endereco ?? null,
      solo ?? null, tipo_uso ?? null, risco ?? null,
      json(patologias ?? []), observacao ?? null, cidade ?? null,
      condEncosta ?? null, tipoTalude ?? null,
      json(processos ?? []), moradores ?? null,
      anguloEncosta ?? null, json(caractsEncosta ?? []),
      lat ?? null, lng ?? null,
      area_m2 ?? null,
      area_vertices ? (typeof area_vertices === 'string' ? area_vertices : JSON.stringify(area_vertices)) : null,
      construcoes ? (typeof construcoes === 'string' ? construcoes : JSON.stringify(construcoes)) : null,
      alturaImovel ? parseFloat(alturaImovel) : null,
      edificacao_planta ? (typeof edificacao_planta === 'string' ? edificacao_planta : JSON.stringify(edificacao_planta)) : null,
      c.req.param('id')
    ).run()
    return c.json({ ok: true })
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

// ── MONITORAMENTO ─────────────────────────────────────────────
const parseM = (str) => { try { return str ? JSON.parse(str) : [] } catch { return [] } }

function mapImovel(r) {
  return {
    id: r.id,
    createdAt: r.created_at,
    proprietario: r.proprietario,
    cidade: r.cidade,
    endereco: r.endereco,
    celular: r.celular,
    latitude: r.latitude,
    longitude: r.longitude,
    nome: r.nome,
    fotosAnomalias: parseM(r.fotos_anomalias),
    relatoriosSalvos: parseM(r.relatorios_salvos),
    areaTerrenho: r.area_terreno ? (typeof r.area_terreno === 'string' ? JSON.parse(r.area_terreno) : r.area_terreno) : [],
    verticesCasa: r.vertices_casa ? (typeof r.vertices_casa === 'string' ? JSON.parse(r.vertices_casa) : r.vertices_casa) : null,
    alturaCasa: r.altura_casa || null,
    trincasCasa: r.trincas_casa ? (typeof r.trincas_casa === 'string' ? JSON.parse(r.trincas_casa) : r.trincas_casa) : [],
    edificacaoPlanta: r.edificacao_planta
      ? (typeof r.edificacao_planta === 'string' ? JSON.parse(r.edificacao_planta) : r.edificacao_planta)
      : null,
  }
}

app.get('/api/monitoramento', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM vistoria_monitoramento ORDER BY created_at DESC'
    ).all()
    return c.json(results.map(mapImovel))
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.get('/api/monitoramento/:id', async (c) => {
  try {
    const r = await c.env.DB.prepare(
      'SELECT * FROM vistoria_monitoramento WHERE id = ?'
    ).bind(c.req.param('id')).first()
    if (!r) return c.json({ error: 'Não encontrado' }, 404)
    return c.json(mapImovel(r))
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.post('/api/monitoramento', async (c) => {
  const { proprietario, cidade, endereco, celular, latitude, longitude, nome,
          areaTerrenho, verticesCasa, alturaCasa, trincasCasa, edificacaoPlanta } = await c.req.json()
  if (!proprietario) return c.json({ error: 'proprietario obrigatório' }, 400)
  try {
    const newId = `imovel_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    await c.env.DB.prepare(
      `INSERT INTO vistoria_monitoramento
         (id, proprietario, cidade, endereco, celular, latitude, longitude, nome,
          area_terreno, vertices_casa, altura_casa, trincas_casa, edificacao_planta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      newId, proprietario, cidade ?? null, endereco ?? null, celular ?? null,
      latitude ?? null, longitude ?? null,
      nome ?? proprietario,
      areaTerrenho ? JSON.stringify(areaTerrenho) : null,
      verticesCasa ? JSON.stringify(verticesCasa) : null,
      alturaCasa ? parseFloat(alturaCasa) : null,
      trincasCasa ? JSON.stringify(trincasCasa) : null,
      edificacaoPlanta ? JSON.stringify(edificacaoPlanta) : null
    ).run()
    const r = await c.env.DB.prepare(
      'SELECT * FROM vistoria_monitoramento WHERE id = ?'
    ).bind(newId).first()
    return c.json(mapImovel(r), 201)
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.put('/api/monitoramento/:id', async (c) => {
  const { proprietario, cidade, endereco, celular, latitude, longitude, nome,
          areaTerrenho, verticesCasa, alturaCasa, trincasCasa, edificacaoPlanta } = await c.req.json()
  try {
    await c.env.DB.prepare(
      `UPDATE vistoria_monitoramento SET
       proprietario=?, cidade=?, endereco=?, celular=?,
       latitude=?, longitude=?, nome=?,
       area_terreno=?, vertices_casa=?, altura_casa=?, trincas_casa=?,
       edificacao_planta=?, updated_at=datetime('now')
       WHERE id=?`
    ).bind(
      proprietario, cidade ?? null, endereco ?? null, celular ?? null,
      latitude ?? null, longitude ?? null,
      nome ?? proprietario,
      areaTerrenho ? JSON.stringify(areaTerrenho) : null,
      verticesCasa ? JSON.stringify(verticesCasa) : null,
      alturaCasa ? parseFloat(alturaCasa) : null,
      trincasCasa ? JSON.stringify(trincasCasa) : null,
      edificacaoPlanta ? JSON.stringify(edificacaoPlanta) : null,
      c.req.param('id')
    ).run()
    const r = await c.env.DB.prepare(
      'SELECT * FROM vistoria_monitoramento WHERE id = ?'
    ).bind(c.req.param('id')).first()
    if (!r) return c.json({ error: 'Não encontrado' }, 404)
    return c.json(mapImovel(r))
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.delete('/api/monitoramento/:id', async (c) => {
  try {
    await c.env.DB.prepare('DELETE FROM vistoria_monitoramento WHERE id = ?').bind(c.req.param('id')).run()
    return c.json({ ok: true })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.post('/api/monitoramento/:id/fotos', async (c) => {
  const { base64 } = await c.req.json()
  if (!base64) return c.json({ error: 'base64 obrigatório' }, 400)
  return c.json({ success: true, url: base64 })
})

// ── PATCH: editar data e medições de um relatório específico ──
app.patch('/api/monitoramento/:id/relatorio/:relId', async (c) => {
  const { createdAt, medicoes } = await c.req.json()
  try {
    const r = await c.env.DB.prepare(
      'SELECT relatorios_salvos FROM vistoria_monitoramento WHERE id = ?'
    ).bind(c.req.param('id')).first()
    if (!r) return c.json({ error: 'Não encontrado' }, 404)

    let rels = parseM(r.relatorios_salvos)
    const idx = rels.findIndex(rel => rel.id === c.req.param('relId'))
    if (idx === -1) return c.json({ error: 'Relatório não encontrado' }, 404)

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

    await c.env.DB.prepare(
      `UPDATE vistoria_monitoramento SET relatorios_salvos=?, updated_at=datetime('now') WHERE id=?`
    ).bind(JSON.stringify(rels), c.req.param('id')).run()

    return c.json({ ok: true, relatorio: rels[idx] })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

// D1 tem limite de ~1MB por linha. Esta função remove as imagens base64
// de relatórios antigos para liberar espaço, mantendo todos os metadados
// (pontos, linhas, medições) intactos.
const D1_LIMIT = 800_000 // 800KB — margem de segurança

function stripOldImages(reports) {
  const json = JSON.stringify(reports)
  if (json.length <= D1_LIMIT) return reports
  // Remove as imagens do mais antigo ao mais novo até caber
  const copy = reports.map(r => ({ ...r, fotosAnomalias: (r.fotosAnomalias || []).map(f => ({ ...f })) }))
  for (let i = 0; i < copy.length - 1 && JSON.stringify(copy).length > D1_LIMIT; i++) {
    copy[i].fotosAnomalias = (copy[i].fotosAnomalias || []).map(f => ({
      ...f,
      url: f.url?.startsWith('data:') ? null : f.url,
    }))
  }
  return copy
}

app.post('/api/monitoramento/:id/relatorios', async (c) => {
  try {
    const newReport = await c.req.json()
    const r = await c.env.DB.prepare(
      'SELECT relatorios_salvos FROM vistoria_monitoramento WHERE id = ?'
    ).bind(c.req.param('id')).first()
    if (!r) return c.json({ error: 'Imóvel não encontrado' }, 404)
    const current = parseM(r.relatorios_salvos)
    const updated = stripOldImages([...current, newReport])
    await c.env.DB.prepare(
      `UPDATE vistoria_monitoramento SET relatorios_salvos=?, updated_at=datetime('now') WHERE id=?`
    ).bind(JSON.stringify(updated), c.req.param('id')).run()
    return c.json({ ok: true }, 201)
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.put('/api/monitoramento/:id/relatorios/:relId', async (c) => {
  try {
    const updatedReport = await c.req.json()
    const r = await c.env.DB.prepare(
      'SELECT relatorios_salvos FROM vistoria_monitoramento WHERE id = ?'
    ).bind(c.req.param('id')).first()
    if (!r) return c.json({ error: 'Imóvel não encontrado' }, 404)
    const current = parseM(r.relatorios_salvos)
    const updated = stripOldImages(current.map(rep => rep.id === c.req.param('relId') ? updatedReport : rep))
    await c.env.DB.prepare(
      `UPDATE vistoria_monitoramento SET relatorios_salvos=?, updated_at=datetime('now') WHERE id=?`
    ).bind(JSON.stringify(updated), c.req.param('id')).run()
    return c.json({ ok: true })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.delete('/api/monitoramento/:id/relatorios/:relId', async (c) => {
  try {
    const r = await c.env.DB.prepare(
      'SELECT relatorios_salvos FROM vistoria_monitoramento WHERE id = ?'
    ).bind(c.req.param('id')).first()
    if (!r) return c.json({ error: 'Imóvel não encontrado' }, 404)
    const current = parseM(r.relatorios_salvos)
    const updated = current.filter(rep => rep.id !== c.req.param('relId'))
    await c.env.DB.prepare(
      `UPDATE vistoria_monitoramento SET relatorios_salvos=?, updated_at=datetime('now') WHERE id=?`
    ).bind(JSON.stringify(updated), c.req.param('id')).run()
    return c.json({ ok: true })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

// ── PATCH: edificacao_planta da vistoria ──────────────────────
app.patch('/api/vistorias/:id/edificacao', async (c) => {
  const { edificacao_planta } = await c.req.json()
  try {
    await c.env.DB.prepare(
      'UPDATE vistorias SET edificacao_planta=? WHERE id=?'
    ).bind(
      edificacao_planta ? (typeof edificacao_planta === 'string' ? edificacao_planta : JSON.stringify(edificacao_planta)) : null,
      c.req.param('id')
    ).run()
    return c.json({ ok: true })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

// ── PROXY TILES SATÉLITE ESRI World Imagery ───────────────────
app.get('/api/sat-tile/:z/:y/:x', async (c) => {
  const z = c.req.param('z')
  const y = c.req.param('y')
  const x = c.req.param('x')
  if (isNaN(z) || isNaN(x) || isNaN(y)) return new Response('bad params', { status: 400 })
  try {
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
    const r = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Mozilla/5.0 Geovistorias/1.0' },
    })
    if (!r.ok) return new Response(null, { status: r.status })
    const buf = await r.arrayBuffer()
    return new Response(buf, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, immutable',
        'Access-Control-Allow-Origin': '*',
      }
    })
  } catch (e) { return c.json({ error: e.message }, 502) }
})

// ── PROXY TILES DEM Terrarium (AWS S3) ────────────────────────
app.get('/api/dem-tile/:z/:x/:y', async (c) => {
  const z = c.req.param('z')
  const x = c.req.param('x')
  const y = c.req.param('y')
  if (isNaN(z) || isNaN(x) || isNaN(y)) return new Response('bad params', { status: 400 })
  try {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) return new Response(null, { status: r.status })
    const buf = await r.arrayBuffer()
    return new Response(buf, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, immutable',
        'Access-Control-Allow-Origin': '*',
      }
    })
  } catch (e) { return c.json({ error: e.message }, 502) }
})

// ── PROXY DOWNLOAD DEM (OpenTopography) ────────────────────────
app.get('/api/dem-download', async (c) => {
  const { south, north, west, east, apiKey } = c.req.query()
  if (!south || !north || !west || !east) return c.json({ error: 'Parâmetros south/north/west/east obrigatórios' }, 400)
  if (!apiKey) return c.json({ error: 'apiKey obrigatório' }, 400)
  try {
    const url = `https://portal.opentopography.org/API/globaldem?demtype=COP30` +
      `&south=${south}&north=${north}&west=${west}&east=${east}` +
      `&outputFormat=GTiff&API_Key=${apiKey}`
    const r = await fetch(url, { signal: AbortSignal.timeout(120000) })
    if (!r.ok) {
      const txt = await r.text().catch(() => '')
      return c.json({ error: `OpenTopography: HTTP ${r.status} — ${txt.slice(0, 200)}` }, r.status)
    }
    const buf = await r.arrayBuffer()
    return new Response(buf, {
      headers: {
        'Content-Type': 'image/tiff',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      }
    })
  } catch (e) { return c.json({ error: e.message }, 502) }
})

// ── PRECIPITAÇÕES ──────────────────────────────────────────────
app.get('/api/precipitacoes', async (c) => {
  try {
    const r = await c.env.DB.prepare(
      'SELECT id, filename, dados, updated_at FROM precipitacoes ORDER BY updated_at DESC LIMIT 1'
    ).first()
    if (!r) return c.json(null)
    let dados = r.dados
    try { dados = typeof dados === 'string' ? JSON.parse(dados) : dados } catch (_) {}
    return c.json({ id: r.id, filename: r.filename, dados, updated_at: r.updated_at })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.post('/api/precipitacoes', async (c) => {
  const { filename, dados } = await c.req.json()
  if (!dados) return c.json({ error: 'dados obrigatório' }, 400)
  try {
    await c.env.DB.prepare('DELETE FROM precipitacoes').run()
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO precipitacoes (filename, dados, updated_at) VALUES (?, ?, datetime('now'))`
    ).bind(filename ?? null, typeof dados === 'string' ? dados : JSON.stringify(dados)).run()
    return c.json({ id: meta.last_row_id })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

app.delete('/api/precipitacoes', async (c) => {
  try {
    await c.env.DB.prepare('DELETE FROM precipitacoes').run()
    return c.json({ ok: true })
  } catch (e) { return c.json({ error: e.message }, 500) }
})

// ── Diagnóstico rápido ────────────────────────────────────────
app.get('/api/ping', (c) => c.json({ ok: true, ts: Date.now() }))

// ── PROXY CLIMA ───────────────────────────────────────────────
app.get('/api/clima', async (c) => {
  const lat = c.req.query('lat')
  const lng = c.req.query('lng')
  if (!lat || !lng) return c.json({ error: 'lat e lng obrigatórios' }, 400)
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,apparent_temperature&forecast_days=1&timezone=America%2FSao_Paulo`
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) return c.json({ error: 'Falha na API de clima' }, 502)
    const data = await r.json()
    return c.json(data.current)
  } catch (e) {
    return c.json({ error: 'Serviço de clima indisponível' }, 503)
  }
})

// ── PROXY PREVISÃO 7 DIAS ─────────────────────────────────────
app.get('/api/previsao', async (c) => {
  const lat = c.req.query('lat')
  const lng = c.req.query('lng')
  if (!lat || !lng) return c.json({ error: 'lat e lng obrigatórios' }, 400)
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_sum,precipitation_probability_max,weather_code,temperature_2m_max,temperature_2m_min&timezone=America%2FSao_Paulo&forecast_days=7`
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!r.ok) return c.json({ error: 'Falha na API de previsão' }, 502)
    const data = await r.json()
    return c.json(data)
  } catch (e) {
    return c.json({ error: 'Serviço de previsão indisponível' }, 503)
  }
})

// ── PROXY ELEVAÇÃO ─────────────────────────────────────────────────────────
// Ordem de qualidade:
//   1. OpenTopoData Copernicus GLO-30 (30 m) — mesmo modelo do ESRI World TopoMap
//   2. Open-Meteo (90 m) — fallback rápido
app.get('/api/elevation', async (c) => {
  const latitude  = c.req.query('latitude')
  const longitude = c.req.query('longitude')
  if (!latitude || !longitude) return c.json({ error: 'latitude e longitude obrigatórios' }, 400)

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
        return c.json({ elevation: data.results.map(p => p.elevation ?? 0), source: 'copernicus30' })
      }
    }
  } catch (_) {}

  // 2ª tentativa: Open-Meteo 90 m
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (r.ok) {
      const data = await r.json()
      if (Array.isArray(data.elevation)) return c.json({ elevation: data.elevation, source: 'open-meteo' })
    }
  } catch (_) {}

  return c.json({ error: 'Não foi possível obter dados de elevação' }, 503)
})

// ── Rota não encontrada na API ─────────────────────────────────
// Com run_worker_first:["/api/*"] no wrangler.jsonc, o worker só recebe
// requisições /api/*. O Cloudflare Assets cuida de todo o restante (SPA).
app.all('*', (c) => c.json({ error: 'Rota não encontrada' }, 404))

export default app
