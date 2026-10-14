---
name: MapLibre-GL v5/v6 API
description: Compatibility notes for MapLibre-GL v5/v6, Vite workers, and headless previews.
---

## `maplibregl.supported()` foi removido no v5

**Por quê:** A função `supported()` não existe mais como método estático no MapLibre-GL v5 (>=5.x). Chamá-la lança `TypeError: maplibregl.supported is not a function`.

**Como aplicar:** Usar verificação manual antes de instanciar o mapa:
```js
try {
  const testCanvas = document.createElement('canvas')
  const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl')
  if (!gl) return // WebGL não disponível
} catch (_) { return }
```

## Screenshot headless sem GPU

O browser headless usado pela ferramenta de screenshot do Replit pode não ter WebGL2. MapLibre-GL v6 exige WebGL2 e lança um erro quando indisponível; isso não demonstra uma falha no browser real do usuário. Mantenha uma mensagem de fallback e verifique o mapa em um browser com WebGL2.

## Worker com Vite no v6

Registre explicitamente o worker do MapLibre com o URL processado pelo Vite:

```js
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

maplibregl.setWorkerUrl(workerUrl)
```

**Why:** No v6, o worker é um módulo ESM e a URL inferida do bundle não é resolvida corretamente por bundlers como Vite; sem `setWorkerUrl`, o worker falha ao carregar.

**How to apply:** Configure o worker uma vez no módulo que inicializa o mapa.

## Terrain source

Usar `encoding: 'terrarium'` na raster-dem source do proxy `/api/dem-tile/{z}/{x}/{y}` (AWS Terrarium tiles). O `setTerrain()` recebe `{ source: 'terrain', exaggeration: 1.8 }` após o estilo carregar.

## Camada de céu no v6

Não adicione `type: 'sky'` no MapLibre-GL v6: o validador de estilo não aceita esse tipo de camada. Remova a camada opcional em vez de deixar o erro de validação interromper a configuração do mapa.
