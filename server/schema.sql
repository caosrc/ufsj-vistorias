-- Schema Cloudflare D1 (SQLite) — Geovistorias
-- Execute via: npx wrangler d1 execute geovistorias --remote --file=server/schema.sql

CREATE TABLE IF NOT EXISTS ocorrencias (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo      TEXT    NOT NULL,
  descricao TEXT,
  nivel     TEXT    DEFAULT 'medio',
  endereco  TEXT,
  cidade    TEXT,
  lat       REAL,
  lng       REAL,
  data      TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vistorias (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nome           TEXT NOT NULL,
  cpf            TEXT,
  telefone       TEXT,
  endereco       TEXT,
  solo           TEXT,
  tipo_uso       TEXT,
  risco          TEXT,
  patologias     TEXT,
  observacao     TEXT,
  cidade         TEXT,
  cond_encosta   TEXT,
  tipo_talude    TEXT,
  processos      TEXT,
  moradores      TEXT,
  angulo_encosta TEXT,
  caract_encosta TEXT,
  lat            REAL,
  lng            REAL,
  area_m2        REAL,
  area_vertices  TEXT,
  construcoes    TEXT,
  altura_imovel  REAL,
  edificacao_planta TEXT,
  data           TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS imoveis (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nome         TEXT,
  tipo         TEXT,
  endereco     TEXT NOT NULL,
  proprietario TEXT,
  contato      TEXT,
  situacao     TEXT DEFAULT 'regular',
  moradores    TEXT,
  obs          TEXT,
  cidade       TEXT,
  lat          REAL,
  lng          REAL,
  criado_em    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS areas_risco (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nivel     TEXT NOT NULL,
  descricao TEXT,
  cidade    TEXT,
  geojson   TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vistoria_monitoramento (
  id                TEXT    PRIMARY KEY,
  proprietario      TEXT    NOT NULL,
  cidade            TEXT,
  endereco          TEXT,
  celular           TEXT,
  latitude          REAL,
  longitude         REAL,
  nome              TEXT,
  fotos_anomalias   TEXT    DEFAULT '[]',
  relatorios_salvos TEXT    DEFAULT '[]',
  area_terreno      TEXT,
  vertices_casa     TEXT,
  altura_casa       REAL,
  trincas_casa      TEXT,
  edificacao_planta TEXT,
  created_at        TEXT    DEFAULT (datetime('now')),
  updated_at        TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS precipitacoes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  filename   TEXT,
  dados      TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── Migração para bancos D1 existentes ────────────────────────
-- Execute estes comandos UMA VEZ no banco de produção se a tabela já existe:
--   npx wrangler d1 execute geovistorias --remote --command="ALTER TABLE vistorias ADD COLUMN area_m2 REAL"
--   npx wrangler d1 execute geovistorias --remote --command="ALTER TABLE vistorias ADD COLUMN area_vertices TEXT"
--   npx wrangler d1 execute geovistorias --remote --command="ALTER TABLE vistorias ADD COLUMN construcoes TEXT"
--   npx wrangler d1 execute geovistorias --remote --command="ALTER TABLE vistorias ADD COLUMN altura_imovel REAL"
--   npx wrangler d1 execute geovistorias --remote --command="ALTER TABLE vistorias ADD COLUMN edificacao_planta TEXT"
--   npx wrangler d1 execute geovistorias --remote --command="ALTER TABLE vistoria_monitoramento ADD COLUMN area_terreno TEXT"
--   npx wrangler d1 execute geovistorias --remote --command="ALTER TABLE vistoria_monitoramento ADD COLUMN vertices_casa TEXT"
--   npx wrangler d1 execute geovistorias --remote --command="ALTER TABLE vistoria_monitoramento ADD COLUMN altura_casa REAL"
--   npx wrangler d1 execute geovistorias --remote --command="ALTER TABLE vistoria_monitoramento ADD COLUMN trincas_casa TEXT"
--   npx wrangler d1 execute geovistorias --remote --command="ALTER TABLE vistoria_monitoramento ADD COLUMN edificacao_planta TEXT"
--   npx wrangler d1 execute geovistorias --remote --command="ALTER TABLE vistoria_monitoramento ADD COLUMN latitude REAL"
--   npx wrangler d1 execute geovistorias --remote --command="ALTER TABLE vistoria_monitoramento ADD COLUMN longitude REAL"
