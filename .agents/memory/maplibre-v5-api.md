---
name: MapLibre-GL v5 API
description: Breaking changes and quirks in MapLibre-GL v5 used in this project.
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

O browser headless usado pela ferramenta de screenshot do Replit não tem GPU. O WebGL falha silenciosamente com `BindToCurrentSequence failed`. Isso é esperado — o mapa funciona no browser real do usuário. O componente trata este caso retornando early da `useEffect`.

## Terrain source

Usar `encoding: 'terrarium'` na raster-dem source do proxy `/api/dem-tile/{z}/{x}/{y}` (AWS Terrarium tiles). O `setTerrain()` recebe `{ source: 'terrain', exaggeration: 1.8 }` após o estilo carregar.

## Sky layer

Usar `addLayer({ id: 'sky', type: 'sky', paint: { 'sky-type': 'atmosphere', ... } })` dentro do `map.on('load', ...)` — não `setSky()`.
