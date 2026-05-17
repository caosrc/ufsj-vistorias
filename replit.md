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
- API de elevação: OpenTopoData SRTM 30m (fallback: Open-Meteo 90m)

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

## Deploy — Cloudflare Pages (Frontend) + Backend Separado

### Frontend no Cloudflare Pages
1. Faça push do repositório para o GitHub
2. No Cloudflare Pages → "Connect to Git" → selecione o repositório
3. Configure o build:
   - **Framework preset**: Vite
   - **Build command**: `cd defesa-civil && npm install && npm run build`
   - **Build output directory**: `defesa-civil/dist`
4. Variável de ambiente no Cloudflare Pages:
   - `VITE_API_URL` = URL do backend em produção (ex: `https://api.geovistorias.com`)

### Backend (Express + PostgreSQL)
O backend precisa de um servidor Node.js com PostgreSQL/PostGIS. Opções recomendadas:
- **Railway** (railway.app) — suporta Node.js + PostgreSQL nativo
- **Render** (render.com) — plano gratuito com PostgreSQL
- **Fly.io** — ideal para apps com banco de dados

Variáveis de ambiente do backend:
- `DATABASE_URL` — connection string do PostgreSQL
- `PORT` — porta do servidor (padrão: 3001)
- `VITE_FRONTEND_URL` — URL do frontend Cloudflare (para CORS, ex: `https://geovistorias.pages.dev`)

### Arquivos de configuração já incluídos
- `defesa-civil/public/_redirects` — SPA routing no Cloudflare Pages
- `defesa-civil/public/_headers` — cache e headers de segurança
- `defesa-civil/.env.example` — modelo de variáveis de ambiente

## Preferências do Usuário
- Foco nas cidades: Ouro Branco - MG e Congonhas - MG
- Idioma: Português (pt-BR)
- Interface clara (light mode — fundo branco)
- Layout responsivo: sidebar no desktop, barra de navegação inferior no mobile (≤768px)
