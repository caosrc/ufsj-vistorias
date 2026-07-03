// Cloudflare Worker — Geovistorias API (zero dependências externas)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })

const jsonArr = (arr) => arr ? JSON.stringify(arr) : null
const parse = (str) => { try { return str ? JSON.parse(str) : [] } catch { return [] } }
const parseM = parse

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

// ── Helpers de mapeamento ────────────────────────────────────
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

// Limite conservador — D1 permite ~1MB por linha, mas guardamos margem para outros campos
const D1_LIMIT = 700_000

function stripOldImages(reports) {
  if (JSON.stringify(reports).length <= D1_LIMIT) return reports

  // Cópia profunda das fotosAnomalias para não mutar o original
  const copy = reports.map(r => ({
    ...r,
    fotosAnomalias: (r.fotosAnomalias || []).map(f => ({ ...f })),
  }))

  // Encontra o índice do relatório mais recente por data (não por posição no array)
  let newestIdx = 0
  let newestDate = 0
  copy.forEach((r, i) => {
    const d = new Date(r.createdAt || 0).getTime()
    if (d > newestDate) { newestDate = d; newestIdx = i }
  })

  // Ordena cópias por data mais antiga primeiro para strips
  const byAge = copy
    .map((r, idx) => ({ idx, date: new Date(r.createdAt || 0).getTime() }))
    .sort((a, b) => a.date - b.date)

  // 1ª passagem: remove fotos foto-a-foto dos mais antigos, pulando o mais recente
  outer1:
  for (const { idx } of byAge) {
    if (idx === newestIdx) continue
    const fotos = copy[idx].fotosAnomalias || []
    for (let fi = 0; fi < fotos.length; fi++) {
      if (fotos[fi].url?.startsWith('data:')) {
        fotos[fi].url = null
        if (JSON.stringify(copy).length <= D1_LIMIT) break outer1
      }
    }
  }

  // 2ª passagem (fallback): se ainda acima do limite, remove do mais recente também
  if (JSON.stringify(copy).length > D1_LIMIT) {
    const fotos = copy[newestIdx]?.fotosAnomalias || []
    outer2:
    for (let fi = 0; fi < fotos.length; fi++) {
      if (fotos[fi].url?.startsWith('data:')) {
        fotos[fi].url = null
        if (JSON.stringify(copy).length <= D1_LIMIT) break outer2
      }
    }
  }

  return copy
}

// ── Roteador principal ────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const method = request.method
    const path = url.pathname

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // Migração lazy
    if (env?.DB && !_migrated) {
      _migrated = true
      await runMigrations(env.DB)
    }

    // ── Auth ──────────────────────────────────────────────────
    if (method === 'POST' && path === '/api/auth/login') {
      const { email, senha } = await request.json().catch(() => ({}))
      if (!email || !senha) return json({ error: 'Credenciais inválidas' }, 400)
      let usuarios = []
      try { if (env?.AUTH_USERS_JSON) usuarios = JSON.parse(env.AUTH_USERS_JSON) } catch (_) {}
      const ok = usuarios.some(u => u.email === email.trim().toLowerCase() && u.senha === senha)
      return ok ? json({ ok: true }) : json({ error: 'E-mail ou senha incorretos.' }, 401)
    }

    // ── Ping ──────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/ping') {
      return json({ ok: true, ts: Date.now() })
    }

    // ── Stats ─────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/stats') {
      try {
        const [oc, vi, im, ar] = await Promise.all([
          env.DB.prepare('SELECT COUNT(*) as count FROM ocorrencias').first(),
          env.DB.prepare('SELECT COUNT(*) as count FROM vistorias').first(),
          env.DB.prepare('SELECT COUNT(*) as count FROM imoveis').first(),
          env.DB.prepare('SELECT COUNT(*) as count FROM areas_risco').first(),
        ])
        return json({ ocorrencias: oc.count, vistorias: vi.count, imoveis: im.count, areas_risco: ar.count })
      } catch (e) { return json({ error: e.message }, 500) }
    }

    // ── Ocorrências ───────────────────────────────────────────
    if (path === '/api/ocorrencias') {
      if (method === 'GET') {
        try {
          const { results } = await env.DB.prepare('SELECT * FROM ocorrencias ORDER BY data DESC').all()
          return json(results)
        } catch (e) { return json({ error: e.message }, 500) }
      }
      if (method === 'POST') {
        const { tipo, descricao, nivel, endereco, cidade, lat, lng, data } = await request.json()
        try {
          const { meta } = await env.DB.prepare(
            `INSERT INTO ocorrencias (tipo, descricao, nivel, endereco, cidade, lat, lng, data)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(tipo, descricao ?? null, nivel ?? 'medio', endereco ?? null, cidade ?? null,
                 lat ?? null, lng ?? null, data ?? new Date().toISOString()).run()
          return json({ id: meta.last_row_id })
        } catch (e) { return json({ error: e.message }, 500) }
      }
    }

    const mOcorrencia = path.match(/^\/api\/ocorrencias\/(\d+)$/)
    if (mOcorrencia) {
      const id = mOcorrencia[1]
      if (method === 'DELETE') {
        try {
          await env.DB.prepare('DELETE FROM ocorrencias WHERE id = ?').bind(id).run()
          return json({ ok: true })
        } catch (e) { return json({ error: e.message }, 500) }
      }
    }

    // ── GeoJSON ───────────────────────────────────────────────
    if (method === 'GET' && path === '/api/geojson/ocorrencias') {
      try {
        const { results } = await env.DB.prepare(
          'SELECT id, tipo, nivel, descricao, data, lat, lng FROM ocorrencias WHERE lat IS NOT NULL'
        ).all()
        return json({
          type: 'FeatureCollection',
          features: results.map(r => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
            properties: { id: r.id, tipo: r.tipo, nivel: r.nivel, descricao: r.descricao, data: r.data }
          }))
        })
      } catch (e) { return json({ error: e.message }, 500) }
    }

    if (method === 'GET' && path === '/api/geojson/areas-risco') {
      try {
        const { results } = await env.DB.prepare(
          'SELECT id, nivel, descricao, geojson FROM areas_risco WHERE geojson IS NOT NULL'
        ).all()
        return json({
          type: 'FeatureCollection',
          features: results.map(r => ({
            type: 'Feature',
            geometry: parse(r.geojson),
            properties: { id: r.id, nivel: r.nivel, descricao: r.descricao }
          }))
        })
      } catch (e) { return json({ error: e.message }, 500) }
    }

    // ── Vistorias ─────────────────────────────────────────────
    if (path === '/api/vistorias') {
      if (method === 'GET') {
        try {
          const { results } = await env.DB.prepare('SELECT * FROM vistorias ORDER BY data DESC').all()
          return json(results.map(r => ({
            ...r,
            patologias: parse(r.patologias),
            processos: parse(r.processos),
            caract_encosta: parse(r.caract_encosta),
            condEncosta: r.cond_encosta,
            tipoTalude: r.tipo_talude,
            anguloEncosta: r.angulo_encosta,
            caractsEncosta: parse(r.caract_encosta),
            construcoes: parse(r.construcoes),
            alturaImovel: r.altura_imovel,
            area_vertices: r.area_vertices || null,
            edificacaoPlanta: r.edificacao_planta
              ? (typeof r.edificacao_planta === 'string' ? JSON.parse(r.edificacao_planta) : r.edificacao_planta)
              : null,
          })))
        } catch (e) { return json({ error: e.message }, 500) }
      }
      if (method === 'POST') {
        const {
          nome, cpf, telefone, endereco, solo, tipo_uso, risco,
          patologias, observacao, cidade, lat, lng,
          condEncosta, tipoTalude, processos, moradores,
          anguloEncosta, caractsEncosta,
          area_m2, area_vertices, construcoes, alturaImovel, edificacao_planta
        } = await request.json()
        try {
          const { meta } = await env.DB.prepare(
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
            jsonArr(patologias ?? []), observacao ?? null, cidade ?? null,
            condEncosta ?? null, tipoTalude ?? null,
            jsonArr(processos ?? []), moradores ?? null,
            anguloEncosta ?? null, jsonArr(caractsEncosta ?? []),
            lat ?? null, lng ?? null,
            area_m2 ?? null,
            area_vertices ? (typeof area_vertices === 'string' ? area_vertices : JSON.stringify(area_vertices)) : null,
            construcoes ? (typeof construcoes === 'string' ? construcoes : JSON.stringify(construcoes)) : null,
            alturaImovel ? parseFloat(alturaImovel) : null,
            edificacao_planta ? (typeof edificacao_planta === 'string' ? edificacao_planta : JSON.stringify(edificacao_planta)) : null
          ).run()
          return json({ id: meta.last_row_id })
        } catch (e) { return json({ error: e.message }, 500) }
      }
    }

    const mVistoria = path.match(/^\/api\/vistorias\/(\d+)$/)
    if (mVistoria) {
      const id = mVistoria[1]
      if (method === 'PUT') {
        const {
          nome, cpf, telefone, endereco, solo, tipo_uso, risco,
          patologias, observacao, cidade, lat, lng,
          condEncosta, tipoTalude, processos, moradores,
          anguloEncosta, caractsEncosta,
          area_m2, area_vertices, construcoes, alturaImovel, edificacao_planta
        } = await request.json()
        try {
          await env.DB.prepare(
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
            jsonArr(patologias ?? []), observacao ?? null, cidade ?? null,
            condEncosta ?? null, tipoTalude ?? null,
            jsonArr(processos ?? []), moradores ?? null,
            anguloEncosta ?? null, jsonArr(caractsEncosta ?? []),
            lat ?? null, lng ?? null,
            area_m2 ?? null,
            area_vertices ? (typeof area_vertices === 'string' ? area_vertices : JSON.stringify(area_vertices)) : null,
            construcoes ? (typeof construcoes === 'string' ? construcoes : JSON.stringify(construcoes)) : null,
            alturaImovel ? parseFloat(alturaImovel) : null,
            edificacao_planta ? (typeof edificacao_planta === 'string' ? edificacao_planta : JSON.stringify(edificacao_planta)) : null,
            id
          ).run()
          return json({ ok: true })
        } catch (e) { return json({ error: e.message }, 500) }
      }
      if (method === 'DELETE') {
        try {
          await env.DB.prepare('DELETE FROM vistorias WHERE id = ?').bind(id).run()
          return json({ ok: true })
        } catch (e) { return json({ error: e.message }, 500) }
      }
    }

    const mVistoriaEdif = path.match(/^\/api\/vistorias\/(\d+)\/edificacao$/)
    if (mVistoriaEdif && method === 'PATCH') {
      const { edificacao_planta } = await request.json()
      try {
        await env.DB.prepare('UPDATE vistorias SET edificacao_planta=? WHERE id=?').bind(
          edificacao_planta ? (typeof edificacao_planta === 'string' ? edificacao_planta : JSON.stringify(edificacao_planta)) : null,
          mVistoriaEdif[1]
        ).run()
        return json({ ok: true })
      } catch (e) { return json({ error: e.message }, 500) }
    }

    // ── Imóveis ───────────────────────────────────────────────
    if (path === '/api/imoveis') {
      if (method === 'GET') {
        try {
          const { results } = await env.DB.prepare('SELECT * FROM imoveis ORDER BY criado_em DESC').all()
          return json(results)
        } catch (e) { return json({ error: e.message }, 500) }
      }
      if (method === 'POST') {
        const { nome, tipo, endereco, proprietario, contato, situacao, moradores, obs, cidade, lat, lng } = await request.json()
        try {
          const { meta } = await env.DB.prepare(
            `INSERT INTO imoveis (nome, tipo, endereco, proprietario, contato, situacao, moradores, obs, cidade, lat, lng)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`
          ).bind(
            nome ?? null, tipo ?? null, endereco, proprietario ?? null,
            contato ?? null, situacao ?? 'regular', moradores ?? null,
            obs ?? null, cidade ?? null, lat ?? null, lng ?? null
          ).run()
          return json({ id: meta.last_row_id })
        } catch (e) { return json({ error: e.message }, 500) }
      }
    }

    const mImovel = path.match(/^\/api\/imoveis\/(\d+)$/)
    if (mImovel && method === 'DELETE') {
      try {
        await env.DB.prepare('DELETE FROM imoveis WHERE id = ?').bind(mImovel[1]).run()
        return json({ ok: true })
      } catch (e) { return json({ error: e.message }, 500) }
    }

    // ── Áreas de Risco ────────────────────────────────────────
    if (path === '/api/areas-risco') {
      if (method === 'GET') {
        try {
          const { results } = await env.DB.prepare('SELECT * FROM areas_risco ORDER BY criado_em DESC').all()
          return json(results.map(r => ({ ...r, geojson: parse(r.geojson) })))
        } catch (e) { return json({ error: e.message }, 500) }
      }
      if (method === 'POST') {
        const { nivel, descricao, cidade, geojson } = await request.json()
        try {
          const { meta } = await env.DB.prepare(
            `INSERT INTO areas_risco (nivel, descricao, cidade, geojson) VALUES (?,?,?,?)`
          ).bind(nivel, descricao ?? null, cidade ?? null, JSON.stringify(geojson)).run()
          return json({ id: meta.last_row_id })
        } catch (e) { return json({ error: e.message }, 500) }
      }
    }

    const mArea = path.match(/^\/api\/areas-risco\/(\d+)$/)
    if (mArea && method === 'DELETE') {
      try {
        await env.DB.prepare('DELETE FROM areas_risco WHERE id = ?').bind(mArea[1]).run()
        return json({ ok: true })
      } catch (e) { return json({ error: e.message }, 500) }
    }

    // ── Monitoramento ─────────────────────────────────────────
    if (path === '/api/monitoramento') {
      if (method === 'GET') {
        try {
          const { results } = await env.DB.prepare('SELECT * FROM vistoria_monitoramento ORDER BY created_at DESC').all()
          return json(results.map(mapImovel))
        } catch (e) { return json({ error: e.message }, 500) }
      }
      if (method === 'POST') {
        const { proprietario, cidade, endereco, celular, latitude, longitude, nome,
                areaTerrenho, verticesCasa, alturaCasa, trincasCasa, edificacaoPlanta } = await request.json()
        if (!proprietario) return json({ error: 'proprietario obrigatório' }, 400)
        try {
          const newId = `imovel_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
          await env.DB.prepare(
            `INSERT INTO vistoria_monitoramento
               (id, proprietario, cidade, endereco, celular, latitude, longitude, nome,
                area_terreno, vertices_casa, altura_casa, trincas_casa, edificacao_planta)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            newId, proprietario, cidade ?? null, endereco ?? null, celular ?? null,
            latitude ?? null, longitude ?? null, nome ?? proprietario,
            areaTerrenho ? JSON.stringify(areaTerrenho) : null,
            verticesCasa ? JSON.stringify(verticesCasa) : null,
            alturaCasa ? parseFloat(alturaCasa) : null,
            trincasCasa ? JSON.stringify(trincasCasa) : null,
            edificacaoPlanta ? JSON.stringify(edificacaoPlanta) : null
          ).run()
          const r = await env.DB.prepare('SELECT * FROM vistoria_monitoramento WHERE id = ?').bind(newId).first()
          return json(mapImovel(r), 201)
        } catch (e) { return json({ error: e.message }, 500) }
      }
    }

    const mMonId = path.match(/^\/api\/monitoramento\/([^/]+)$/)
    if (mMonId) {
      const id = mMonId[1]
      if (method === 'GET') {
        try {
          const r = await env.DB.prepare('SELECT * FROM vistoria_monitoramento WHERE id = ?').bind(id).first()
          if (!r) return json({ error: 'Não encontrado' }, 404)
          return json(mapImovel(r))
        } catch (e) { return json({ error: e.message }, 500) }
      }
      if (method === 'PUT') {
        const { proprietario, cidade, endereco, celular, latitude, longitude, nome,
                areaTerrenho, verticesCasa, alturaCasa, trincasCasa, edificacaoPlanta } = await request.json()
        try {
          await env.DB.prepare(
            `UPDATE vistoria_monitoramento SET
             proprietario=?, cidade=?, endereco=?, celular=?,
             latitude=?, longitude=?, nome=?,
             area_terreno=?, vertices_casa=?, altura_casa=?, trincas_casa=?,
             edificacao_planta=?, updated_at=datetime('now')
             WHERE id=?`
          ).bind(
            proprietario, cidade ?? null, endereco ?? null, celular ?? null,
            latitude ?? null, longitude ?? null, nome ?? proprietario,
            areaTerrenho ? JSON.stringify(areaTerrenho) : null,
            verticesCasa ? JSON.stringify(verticesCasa) : null,
            alturaCasa ? parseFloat(alturaCasa) : null,
            trincasCasa ? JSON.stringify(trincasCasa) : null,
            edificacaoPlanta ? JSON.stringify(edificacaoPlanta) : null,
            id
          ).run()
          const r = await env.DB.prepare('SELECT * FROM vistoria_monitoramento WHERE id = ?').bind(id).first()
          if (!r) return json({ error: 'Não encontrado' }, 404)
          return json(mapImovel(r))
        } catch (e) { return json({ error: e.message }, 500) }
      }
      if (method === 'DELETE') {
        try {
          await env.DB.prepare('DELETE FROM vistoria_monitoramento WHERE id = ?').bind(id).run()
          return json({ ok: true })
        } catch (e) { return json({ error: e.message }, 500) }
      }
    }

    const mMonFotos = path.match(/^\/api\/monitoramento\/([^/]+)\/fotos$/)
    if (mMonFotos && method === 'POST') {
      const { base64 } = await request.json()
      if (!base64) return json({ error: 'base64 obrigatório' }, 400)
      return json({ success: true, url: base64 })
    }

    const mMonRelatorio = path.match(/^\/api\/monitoramento\/([^/]+)\/relatorio\/([^/]+)$/)
    if (mMonRelatorio && method === 'PATCH') {
      const id = mMonRelatorio[1]
      const relId = mMonRelatorio[2]
      const { createdAt, medicoes } = await request.json()
      try {
        const r = await env.DB.prepare('SELECT relatorios_salvos FROM vistoria_monitoramento WHERE id = ?').bind(id).first()
        if (!r) return json({ error: 'Não encontrado' }, 404)
        let rels = parseM(r.relatorios_salvos)
        const idx = rels.findIndex(rel => rel.id === relId)
        if (idx === -1) return json({ error: 'Relatório não encontrado' }, 404)
        if (createdAt) rels[idx].createdAt = createdAt
        if (medicoes && rels[idx].fotosAnomalias) {
          rels[idx].fotosAnomalias = rels[idx].fotosAnomalias.map(foto => ({
            ...foto,
            linhas: (foto.linhas || []).map(line => {
              const key = `${foto.id}_${line.id}`
              return medicoes[key] !== undefined ? { ...line, comprimentos: medicoes[key] } : line
            })
          }))
        }
        const relsToSave = stripOldImages(rels)
        await env.DB.prepare(
          `UPDATE vistoria_monitoramento SET relatorios_salvos=?, updated_at=datetime('now') WHERE id=?`
        ).bind(JSON.stringify(relsToSave), id).run()
        return json({ ok: true, relatorio: relsToSave[idx] })
      } catch (e) { return json({ error: e.message }, 500) }
    }

    const mMonRelatorios = path.match(/^\/api\/monitoramento\/([^/]+)\/relatorios$/)
    if (mMonRelatorios) {
      const id = mMonRelatorios[1]
      if (method === 'POST') {
        try {
          const newReport = await request.json()
          const r = await env.DB.prepare('SELECT relatorios_salvos FROM vistoria_monitoramento WHERE id = ?').bind(id).first()
          if (!r) return json({ error: 'Imóvel não encontrado' }, 404)
          const current = parseM(r.relatorios_salvos)
          const updated = stripOldImages([...current, newReport])
          await env.DB.prepare(
            `UPDATE vistoria_monitoramento SET relatorios_salvos=?, updated_at=datetime('now') WHERE id=?`
          ).bind(JSON.stringify(updated), id).run()
          return json({ ok: true }, 201)
        } catch (e) { return json({ error: e.message }, 500) }
      }
    }

    const mMonRelatorioId = path.match(/^\/api\/monitoramento\/([^/]+)\/relatorios\/([^/]+)$/)
    if (mMonRelatorioId) {
      const id = mMonRelatorioId[1]
      const relId = mMonRelatorioId[2]
      if (method === 'PUT') {
        try {
          const updatedReport = await request.json()
          const r = await env.DB.prepare('SELECT relatorios_salvos FROM vistoria_monitoramento WHERE id = ?').bind(id).first()
          if (!r) return json({ error: 'Imóvel não encontrado' }, 404)
          const current = parseM(r.relatorios_salvos)
          const updated = stripOldImages(current.map(rep => rep.id === relId ? updatedReport : rep))
          await env.DB.prepare(
            `UPDATE vistoria_monitoramento SET relatorios_salvos=?, updated_at=datetime('now') WHERE id=?`
          ).bind(JSON.stringify(updated), id).run()
          return json({ ok: true })
        } catch (e) { return json({ error: e.message }, 500) }
      }
      if (method === 'DELETE') {
        try {
          const r = await env.DB.prepare('SELECT relatorios_salvos FROM vistoria_monitoramento WHERE id = ?').bind(id).first()
          if (!r) return json({ error: 'Imóvel não encontrado' }, 404)
          const current = parseM(r.relatorios_salvos)
          const updated = current.filter(rep => rep.id !== relId)
          await env.DB.prepare(
            `UPDATE vistoria_monitoramento SET relatorios_salvos=?, updated_at=datetime('now') WHERE id=?`
          ).bind(JSON.stringify(updated), id).run()
          return json({ ok: true })
        } catch (e) { return json({ error: e.message }, 500) }
      }
    }

    // ── Precipitações ─────────────────────────────────────────
    if (path === '/api/precipitacoes') {
      if (method === 'GET') {
        try {
          const r = await env.DB.prepare(
            'SELECT id, filename, dados, updated_at FROM precipitacoes ORDER BY updated_at DESC LIMIT 1'
          ).first()
          if (!r) return json(null)
          let dados = r.dados
          try { dados = typeof dados === 'string' ? JSON.parse(dados) : dados } catch (_) {}
          return json({ id: r.id, filename: r.filename, dados, updated_at: r.updated_at })
        } catch (e) { return json({ error: e.message }, 500) }
      }
      if (method === 'POST') {
        const { filename, dados } = await request.json()
        if (!dados) return json({ error: 'dados obrigatório' }, 400)
        try {
          await env.DB.prepare('DELETE FROM precipitacoes').run()
          const { meta } = await env.DB.prepare(
            `INSERT INTO precipitacoes (filename, dados, updated_at) VALUES (?, ?, datetime('now'))`
          ).bind(filename ?? null, typeof dados === 'string' ? dados : JSON.stringify(dados)).run()
          return json({ id: meta.last_row_id })
        } catch (e) { return json({ error: e.message }, 500) }
      }
      if (method === 'DELETE') {
        try {
          await env.DB.prepare('DELETE FROM precipitacoes').run()
          return json({ ok: true })
        } catch (e) { return json({ error: e.message }, 500) }
      }
    }

    // ── Proxy Tiles Satélite ESRI ─────────────────────────────
    const mSatTile = path.match(/^\/api\/sat-tile\/(\d+)\/(\d+)\/(\d+)$/)
    if (mSatTile && method === 'GET') {
      const [, z, y, x] = mSatTile
      try {
        const r = await fetch(
          `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
          { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 Geovistorias/1.0' } }
        )
        if (!r.ok) return new Response(null, { status: r.status })
        const buf = await r.arrayBuffer()
        return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400, immutable', 'Access-Control-Allow-Origin': '*' } })
      } catch (e) { return json({ error: e.message }, 502) }
    }

    // ── Proxy Tiles OSM / Topo / CartoDB ─────────────────────
    const TILE_SOURCES = {
      osm:     ({ z, x, y }) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
      topo:    ({ z, x, y }) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`,
      esri:    ({ z, x, y }) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`,
      carto_l: ({ z, x, y }) => `https://a.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`,
      carto_d: ({ z, x, y }) => `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`,
    }
    const mMapTile = path.match(/^\/api\/map-tile\/([^/]+)\/(\d+)\/(\d+)\/(\d+)$/)
    if (mMapTile && method === 'GET') {
      const [, src, z, x, y] = mMapTile
      const builder = TILE_SOURCES[src]
      if (!builder) return new Response('fonte inválida', { status: 400 })
      try {
        const r = await fetch(builder({ z, x, y }), {
          signal: AbortSignal.timeout(12000),
          headers: { 'User-Agent': 'Mozilla/5.0 Geovistorias/1.0', 'Referer': 'https://www.openstreetmap.org/' }
        })
        if (!r.ok) return new Response(null, { status: r.status })
        const buf = await r.arrayBuffer()
        const ct = r.headers.get('content-type') || 'image/png'
        return new Response(buf, { headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400, immutable', 'Access-Control-Allow-Origin': '*' } })
      } catch (e) { return json({ error: e.message }, 502) }
    }

    // ── Proxy Tiles DEM Terrarium ─────────────────────────────
    const mDemTile = path.match(/^\/api\/dem-tile\/(\d+)\/(\d+)\/(\d+)$/)
    if (mDemTile && method === 'GET') {
      const [, z, x, y] = mDemTile
      try {
        const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, { signal: AbortSignal.timeout(10000) })
        if (!r.ok) return new Response(null, { status: r.status })
        const buf = await r.arrayBuffer()
        return new Response(buf, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, immutable', 'Access-Control-Allow-Origin': '*' } })
      } catch (e) { return json({ error: e.message }, 502) }
    }

    // ── Proxy Download DEM (OpenTopography) ──────────────────
    if (method === 'GET' && path === '/api/dem-download') {
      const south = url.searchParams.get('south')
      const north = url.searchParams.get('north')
      const west = url.searchParams.get('west')
      const east = url.searchParams.get('east')
      const apiKey = url.searchParams.get('apiKey')
      if (!south || !north || !west || !east) return json({ error: 'Parâmetros south/north/west/east obrigatórios' }, 400)
      if (!apiKey) return json({ error: 'apiKey obrigatório' }, 400)
      try {
        const demUrl = `https://portal.opentopography.org/API/globaldem?demtype=COP30&south=${south}&north=${north}&west=${west}&east=${east}&outputFormat=GTiff&API_Key=${apiKey}`
        const r = await fetch(demUrl, { signal: AbortSignal.timeout(120000) })
        if (!r.ok) {
          const txt = await r.text().catch(() => '')
          return json({ error: `OpenTopography: HTTP ${r.status} — ${txt.slice(0, 200)}` }, r.status)
        }
        const buf = await r.arrayBuffer()
        return new Response(buf, { headers: { 'Content-Type': 'image/tiff', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } })
      } catch (e) { return json({ error: e.message }, 502) }
    }

    // ── Proxy Elevação ────────────────────────────────────────
    if (method === 'GET' && path === '/api/elevation') {
      const latitude = url.searchParams.get('latitude')
      const longitude = url.searchParams.get('longitude')
      if (!latitude || !longitude) return json({ error: 'latitude e longitude obrigatórios' }, 400)
      try {
        const lats = latitude.split(',')
        const lngs = longitude.split(',')
        const locations = lats.map((lat, i) => `${lat},${lngs[i]}`).join('|')
        const r = await fetch(`https://api.opentopodata.org/v1/copernicus30?locations=${locations}`, { signal: AbortSignal.timeout(12000) })
        if (r.ok) {
          const data = await r.json()
          if (data.results?.length) return json({ elevation: data.results.map(p => p.elevation ?? 0), source: 'copernicus30' })
        }
      } catch (_) {}
      try {
        const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`, { signal: AbortSignal.timeout(10000) })
        if (r.ok) {
          const data = await r.json()
          if (Array.isArray(data.elevation)) return json({ elevation: data.elevation, source: 'open-meteo' })
        }
      } catch (_) {}
      return json({ error: 'Não foi possível obter dados de elevação' }, 503)
    }

    // ── Proxy Clima ───────────────────────────────────────────
    if (method === 'GET' && path === '/api/clima') {
      const lat = url.searchParams.get('lat')
      const lng = url.searchParams.get('lng')
      if (!lat || !lng) return json({ error: 'lat e lng obrigatórios' }, 400)
      try {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,apparent_temperature&forecast_days=1&timezone=America%2FSao_Paulo`, { signal: AbortSignal.timeout(10000) })
        if (!r.ok) return json({ error: 'Falha na API de clima' }, 502)
        const data = await r.json()
        return json(data.current)
      } catch (e) { return json({ error: 'Serviço de clima indisponível' }, 503) }
    }

    // ── Proxy Previsão 7 dias ─────────────────────────────────
    if (method === 'GET' && path === '/api/previsao') {
      const lat = url.searchParams.get('lat')
      const lng = url.searchParams.get('lng')
      if (!lat || !lng) return json({ error: 'lat e lng obrigatórios' }, 400)
      try {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_sum,precipitation_probability_max,weather_code,temperature_2m_max,temperature_2m_min&timezone=America%2FSao_Paulo&forecast_days=7`, { signal: AbortSignal.timeout(12000) })
        if (!r.ok) return json({ error: 'Falha na API de previsão' }, 502)
        const data = await r.json()
        return json(data)
      } catch (e) { return json({ error: 'Serviço de previsão indisponível' }, 503) }
    }

    // ── Proxy Pluviométrico Grid ──────────────────────────────
    if (method === 'GET' && path === '/api/pluvio-grid') {
      const lats = url.searchParams.get('lats')
      const lngs = url.searchParams.get('lngs')
      if (!lats || !lngs) return json({ error: 'lats e lngs obrigatórios' }, 400)
      try {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&daily=precipitation_sum&timezone=America%2FSao_Paulo&past_days=7&forecast_days=0`, { signal: AbortSignal.timeout(15000) })
        if (!r.ok) return json({ error: 'Falha na API pluviométrica' }, 502)
        const data = await r.json()
        return json(data)
      } catch (e) { return json({ error: 'Serviço pluviométrico indisponível' }, 503) }
    }

    // ── Rota não encontrada ───────────────────────────────────
    return json({ error: 'Rota não encontrada' }, 404)
  }
}
