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

## Preferências do Usuário
- Foco nas cidades: Ouro Branco - MG e Congonhas - MG
- Idioma: Português (pt-BR)
- Interface escura (dark mode)
