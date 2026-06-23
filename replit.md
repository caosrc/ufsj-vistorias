# Geovistorias — Ouro Branco & Congonhas MG

## Visão Geral
Sistema WebGIS operacional para monitoramento geotécnico das cidades de **Ouro Branco - MG** e **Congonhas - MG**.

## Stack Técnica
- React 19 + Vite (porta 5000)
- Leaflet (mapa interativo)
- Three.js (visualização 3D de terreno)
- Chart.js (gráficos)
- @turf/turf (análise geoespacial)
- Express + PostgreSQL/PostGIS (backend porta 3001)
- xlsx (exportação Excel)
- jszip (exportação KMZ)
- CSS Modules (dark mode)

## Funcionalidades
- Mapa interativo: Ruas (OSM), Satélite (Esri), Topográfico (OpenTopoMap)
- Troca de cidade: Ouro Branco e Congonhas
- Desenho de áreas de risco R1–R4
- **Declividade**: ferramentas Medir, Auto e Corredor A+B com perfil longitudinal e **visualização 3D rotacionável** (Three.js)
- **Vistoria Residencial** (modelo NBR 11682 / IPT-Defesa Civil):
  - Condição da Encosta (visual), Tipo de Talude com SVG (5 tipos)
  - Processos identificados (6 tipos com ícones)
  - Tipo de solo, patologias clicáveis (12 itens)
  - Grau de Risco R1–R4 com ilustrações SVG de casas
  - **Dashboard** com estatísticas
  - **Exportação Excel e KMZ**
- Cadastro de Imóveis
- Painel Operacional (clima via Open-Meteo)
- API de elevação: Terrarium/AWS tiles z16 bicúbico (primário) → OpenTopoData **Copernicus GLO-30** 30m (fallback) → Open-Meteo 90m

## Executar
```bash
cd defesa-civil && npm run dev   # frontend — porta 5000
cd server && node index.js       # backend  — porta 3001
```

## Estrutura Principal
```
defesa-civil/src/
  components/  — Sidebar, Mapa, PainelClima, TerrainProfile3D
  pages/       — Home, Vistoria, Imoveis, Dashboard, Declividade
  services/    — api.js
server/
  index.js     — Express + PostGIS
```

## Deploy — Cloudflare Pages + Cloudflare Workers + D1

> Veja o guia completo em **`DEPLOY_CLOUDFLARE.md`**

### Resumo rápido

#### 1. Criar banco D1 e aplicar schema
```bash
npx wrangler d1 create geovistorias
# Cole o database_id em server/wrangler.toml
npx wrangler d1 execute geovistorias --remote --file=server/schema.sql
```

#### 2. Deploy do Worker (API)
```bash
cd server && npx wrangler deploy
```

#### 3. Deploy do Frontend (Cloudflare Pages via GitHub)
- Conecte o repositório no Cloudflare Pages
- Build command: `cd defesa-civil && npm install && npm run build`
- Build output: `defesa-civil/dist`
- Variável: `VITE_API_URL` = URL do Worker

#### GitHub Actions (deploy automático)
Segredos necessários no repositório GitHub:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `VITE_API_URL`

### Arquivos de configuração
- `server/wrangler.toml` — configuração do Worker + D1
- `server/schema.sql` — schema do banco D1
- `.github/workflows/deploy-worker.yml` — CI/CD do Worker
- `.github/workflows/deploy-pages.yml` — CI/CD do frontend
- `defesa-civil/public/_redirects` — SPA routing
- `defesa-civil/.env.example` — modelo de variáveis

## Preferências do Usuário
- Foco nas cidades: Ouro Branco - MG e Congonhas - MG
- Idioma: Português (pt-BR)
- Interface clara (light mode — fundo branco)
- Layout responsivo: sidebar no desktop, barra de navegação inferior no mobile (≤768px)
