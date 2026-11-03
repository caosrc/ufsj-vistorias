-- Schema PostgreSQL usado pela API Express no Replit.
-- Não executar em Cloudflare D1; para D1, use schema.sql.

CREATE TABLE IF NOT EXISTS ocorrencias (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  descricao TEXT,
  nivel TEXT DEFAULT 'medio',
  endereco TEXT,
  cidade TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  data TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vistorias (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  cpf TEXT,
  telefone TEXT,
  endereco TEXT,
  solo TEXT,
  tipo_uso TEXT,
  risco TEXT,
  patologias TEXT,
  observacao TEXT,
  cidade TEXT,
  cond_encosta TEXT,
  tipo_talude TEXT,
  processos TEXT,
  moradores TEXT,
  angulo_encosta TEXT,
  caract_encosta TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  area_m2 DOUBLE PRECISION,
  area_vertices TEXT,
  construcoes TEXT,
  altura_imovel DOUBLE PRECISION,
  edificacao_planta TEXT,
  edificacao_vertices TEXT,
  data TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS imoveis (
  id SERIAL PRIMARY KEY,
  nome TEXT,
  tipo TEXT,
  endereco TEXT NOT NULL,
  proprietario TEXT,
  contato TEXT,
  situacao TEXT DEFAULT 'regular',
  moradores TEXT,
  obs TEXT,
  cidade TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS areas_risco (
  id SERIAL PRIMARY KEY,
  nivel TEXT NOT NULL DEFAULT 'R2',
  tipo TEXT NOT NULL DEFAULT 'Encostas',
  descricao TEXT,
  cidade TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  data_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  limite_precipitacao_mm NUMERIC(8, 2) NOT NULL DEFAULT 35 CHECK (limite_precipitacao_mm >= 0),
  referencia TEXT,
  observacao TEXT,
  geojson TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE areas_risco ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'Encostas';
ALTER TABLE areas_risco ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE areas_risco ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE areas_risco ADD COLUMN IF NOT EXISTS data_inicio DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE areas_risco ADD COLUMN IF NOT EXISTS limite_precipitacao_mm NUMERIC(8, 2) NOT NULL DEFAULT 35;
ALTER TABLE areas_risco ADD COLUMN IF NOT EXISTS referencia TEXT;
ALTER TABLE areas_risco ADD COLUMN IF NOT EXISTS observacao TEXT;
CREATE INDEX IF NOT EXISTS areas_risco_cidade_idx ON areas_risco (cidade);

CREATE TABLE IF NOT EXISTS vistoria_monitoramento (
  id TEXT PRIMARY KEY,
  proprietario TEXT NOT NULL,
  cidade TEXT,
  endereco TEXT,
  celular TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  nome TEXT,
  fotos_anomalias TEXT DEFAULT '[]',
  relatorios_salvos TEXT DEFAULT '[]',
  foto_store TEXT DEFAULT '{}',
  area_terreno TEXT,
  vertices_casa TEXT,
  altura_casa DOUBLE PRECISION,
  trincas_casa TEXT,
  edificacao_planta TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS precipitacoes (
  id SERIAL PRIMARY KEY,
  filename TEXT,
  dados TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
