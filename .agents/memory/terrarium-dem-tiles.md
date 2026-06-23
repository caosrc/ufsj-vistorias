---
name: Terrarium DEM tiles — CORS e zoom máximo
description: Limitações dos tiles Terrarium AWS S3 no Geovistorias — CORS bloqueado e zoom máximo z=15.
---

## Regra

1. **CORS bloqueado**: `s3.amazonaws.com/elevation-tiles-prod/` não envia `Access-Control-Allow-Origin`. `canvas.getImageData()` falha com SecurityError silencioso (tainted canvas). Sempre usar o proxy `/api/dem-tile/:z/:x/:y` do Express.

2. **Zoom máximo z=15**: Os tiles só existem até z=15 (~4.8 m/px no equador). Requisições com z=16 retornam 404 do S3. Todas as funções DEM devem usar `Math.min(15, ...)`.

**Why:** Sem o proxy, a bicubic interpolation retornava `null` para todos os pontos e o clique de altitude ficava eternamente em "consultando…" sem mostrar o resultado.

**How to apply:**
- `zoomForExtent()` — max retorno deve ser 15
- `getElevationDEM/Raw/BatchDEM*` — default `z = 15`, limites em `Math.min(15, ...)`
- `loadTilePixels()` — usa URL `/api/dem-tile/${z}/${x}/${y}` (relativa, passa pelo Express)
- `server/index.js` — rota `GET /api/dem-tile/:z/:x/:y` proxy para S3 com CORS explícito
