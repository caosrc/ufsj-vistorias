# App Defesa Civil — Ouro Branco & Congonhas MG

## Visão Geral
Sistema WebGIS operacional da Defesa Civil com mapa interativo para monitoramento das cidades de **Ouro Branco - MG** e **Congonhas - MG**.

## Stack Técnica
- React 19 + Vite
- Leaflet / react-leaflet (mapa interativo)
- react-router-dom (rotas)
- react-icons (ícones)
- CSS Modules (estilização)
- localStorage (armazenamento local)

## Funcionalidades
- Mapa interativo com camadas: Ruas (OSM), Satélite (Esri), Topográfico (OpenTopoMap)
- Troca de cidade: Ouro Branco e Congonhas
- Desenho de áreas de risco com classificação R1–R4
- Cadastro de ocorrências (tipo, severidade, coordenadas)
- Vistoria residencial (patologias, grau de risco, solo)
- Cadastro de imóveis (proprietário, situação, moradores)
- Painel operacional (estatísticas, clima em tempo real via Open-Meteo)
- Dados climáticos: temperatura, umidade, precipitação, vento

## Executar
```bash
cd defesa-civil && npm run dev
```
Porta: 5000

## Estrutura
```
defesa-civil/src/
  components/  — Mapa, Sidebar, PainelClima
  pages/       — Home, Ocorrencias, Vistoria, Imoveis, Dashboard
  data/        — cidades.js
  styles/      — global.css
```

## Preferências do Usuário
- Foco nas cidades: Ouro Branco - MG e Congonhas - MG
- Idioma: Português (pt-BR)
- Interface escura (dark mode)
