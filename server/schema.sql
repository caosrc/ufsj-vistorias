-- Schema Cloudflare D1 (SQLite) — Geovistorias
-- Execute via: npx wrangler d1 execute geovistorias --file=schema.sql

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
