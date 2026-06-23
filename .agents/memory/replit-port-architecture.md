---
name: Arquitetura de portas Replit — Geovistorias
description: O proxy Vite→Express causa erro 405 para requisições POST do navegador no ambiente Replit. A solução correta é inverter: Express na porta 5000 (externa), Vite na 5173 (interna), com Express fazendo proxy para Vite.
---

# Problema
Quando Vite (porta 5000) faz proxy de `/api/*` para Express (porta 3001), requisições POST do navegador recebem HTTP 405.
curl do servidor funciona (200 OK), mas o navegador falha — o problema está no caminho Replit HTTPS proxy → Vite → Express.

# Solução aplicada
- Express: porta 5000 (outputType "webview", exposta externamente)
- Vite: porta 5173 (outputType "console", interna)
- Express usa `http-proxy-middleware` para encaminhar tudo que não é `/api/*` para Vite na 5173

**Why:** No Replit, o proxy HTTPS da plataforma vai para a porta 5000. Colocar o Express diretamente na 5000 elimina intermediários e garante que POST funcione corretamente.

**How to apply:** Sempre que o projeto tiver backend Express + Vite frontend, coloque Express na 5000 e Vite em outra porta suportada (5173 funciona). Use `http-proxy-middleware` no Express para rotear o frontend em dev.
