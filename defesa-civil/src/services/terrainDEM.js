// ── Terrain DEM — AWS Elevation Tiles (Terrarium, sem API key) ──────────────
// Tile URL : https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
// Encoding : altitude = (R × 256 + G + B/256) − 32768   (precisão ~10 cm)
//
// Resolução por zoom (equador):
//   z=12 → ~40m/px   z=13 → ~20m/px   z=14 → ~10m/px
//   z=15 → ~5m/px    z=16 → ~2.4m/px
//
// API backend (fallback): OpenTopoData Copernicus DEM GLO-30
//   → mesmo modelo usado pelo ESRI World TopoMap
// ─────────────────────────────────────────────────────────────────────────────

const tileCache = new Map()
const MAX_CACHE = 500

// ── Tile math ────────────────────────────────────────────────────────────────
function latLngToTileXY(lat, lng, z) {
  const n   = Math.pow(2, z)
  const x   = Math.floor((lng + 180) / 360 * n)
  const rad = lat * Math.PI / 180
  const y   = Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n)
  return { x: Math.max(0, x), y: Math.max(0, y) }
}

function tilePixelOffset(lat, lng, tileX, tileY, z) {
  const n   = Math.pow(2, z)
  const px  = ((lng + 180) / 360 * n - tileX) * 256
  const rad = lat * Math.PI / 180
  const py  = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n - tileY) * 256
  return {
    px:  Math.max(0, Math.min(255, Math.floor(px))),
    py:  Math.max(0, Math.min(255, Math.floor(py))),
    fpx: px - Math.floor(px),
    fpy: py - Math.floor(py),
  }
}

function decodeTerrarium(r, g, b) {
  return (r * 256 + g + b / 256) - 32768
}

async function loadTilePixels(z, x, y) {
  const key = `${z}/${x}/${y}`
  if (tileCache.has(key)) return tileCache.get(key)

  // Usa proxy do backend para garantir CORS correto.
  // S3 direto não envia Access-Control-Allow-Origin → getImageData() falha.
  const url = `/api/dem-tile/${z}/${x}/${y}`

  const data = await new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 256; canvas.height = 256
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        resolve(ctx.getImageData(0, 0, 256, 256).data)
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = reject
    img.src = url
  })

  if (tileCache.size >= MAX_CACHE) {
    const firstKey = tileCache.keys().next().value
    tileCache.delete(firstKey)
  }
  tileCache.set(key, data)
  return data
}

// ── Interpolação bilinear (rápida, dentro de 1 tile) ─────────────────────────
function bilinearElevation(data, fpx, fpy, px, py) {
  function px4(x, y) {
    const cx = Math.max(0, Math.min(255, x))
    const cy = Math.max(0, Math.min(255, y))
    const i  = (cy * 256 + cx) * 4
    return decodeTerrarium(data[i], data[i+1], data[i+2])
  }
  const e00 = px4(px,   py)
  const e10 = px4(px+1, py)
  const e01 = px4(px,   py+1)
  const e11 = px4(px+1, py+1)
  return e00*(1-fpx)*(1-fpy) + e10*fpx*(1-fpy) + e01*(1-fpx)*fpy + e11*fpx*fpy
}

// ── Interpolação bicúbica Catmull-Rom (4×4 — perfis mais suaves) ─────────────
// Produz curvas contínuas de 1ª e 2ª derivada → perfis de terreno sem "dentes"
function bicubicElevation(data, fpx, fpy, px, py) {
  function getElev(x, y) {
    const cx = Math.max(0, Math.min(255, x))
    const cy = Math.max(0, Math.min(255, y))
    const i  = (cy * 256 + cx) * 4
    return decodeTerrarium(data[i], data[i+1], data[i+2])
  }
  // Catmull-Rom spline: p = [p0, p1, p2, p3], t in [0,1]
  function catmull(p, t) {
    return 0.5 * (
      (2 * p[1]) +
      (p[2] - p[0]) * t +
      (2*p[0] - 5*p[1] + 4*p[2] - p[3]) * t * t +
      (3*p[1] - p[0] - 3*p[2] + p[3]) * t * t * t
    )
  }
  const rows = []
  for (let j = -1; j <= 2; j++) {
    rows.push(catmull([
      getElev(px - 1, py + j),
      getElev(px,     py + j),
      getElev(px + 1, py + j),
      getElev(px + 2, py + j),
    ], fpx))
  }
  return catmull(rows, fpy)
}

// ── Zoom adaptativo ──────────────────────────────────────────────────────────
// Terrarium S3 só disponibiliza até z=15 (~4.8 m/pixel no equador)
function zoomForExtent(extentM) {
  if (extentM < 800)   return 15   // ~4.8 m/pixel — microanálise / detalhe máximo
  if (extentM < 3500)  return 14   // ~9.6 m/pixel — bairro
  if (extentM < 9000)  return 13   // ~19 m/pixel  — cidade
  return 12                        // ~38 m/pixel  — regional
}

// ── Pixel bruto (vizinho mais próximo) — sem suavização ──────────────────────
// Preserva quedas abruptas de terreno: taludes, cortes, rampas reais
function nearestPixelElev(data, fpx, fpy, px, py) {
  const cx = Math.max(0, Math.min(255, fpx >= 0.5 ? px + 1 : px))
  const cy = Math.max(0, Math.min(255, fpy >= 0.5 ? py + 1 : py))
  const i  = (cy * 256 + cx) * 4
  return decodeTerrarium(data[i], data[i+1], data[i+2])
}

// ── API pública ──────────────────────────────────────────────────────────────

// Elevação de ponto único — bilinear, z=15 por padrão (Terrarium max)
export async function getElevationDEM(lat, lng, z = 15) {
  const { x, y }             = latLngToTileXY(lat, lng, z)
  const data                 = await loadTilePixels(z, x, y)
  const { px, py, fpx, fpy } = tilePixelOffset(lat, lng, x, y, z)
  return bilinearElevation(data, fpx, fpy, px, py)
}

// Elevação de ponto único — pixel bruto, z=15 (Terrarium max zoom)
// Valor exato do DEM sem interpolação: ideal para exibir cota ao clicar
export async function getElevationDEMRaw(lat, lng, z = 15) {
  const { x, y }             = latLngToTileXY(lat, lng, z)
  const data                 = await loadTilePixels(z, x, y)
  const { px, py, fpx, fpy } = tilePixelOffset(lat, lng, x, y, z)
  return nearestPixelElev(data, fpx, fpy, px, py)
}

// Batch — pixel bruto (vizinho mais próximo), zoom adaptativo +1 nível (max 15)
// Preserva quebras reais: taludes, cortes e rampas aparecem com geometria real
export async function getElevationsBatchDEMRaw(points, extentM = null) {
  if (!points || points.length === 0) return []

  const z = extentM ? Math.min(15, zoomForExtent(extentM) + 1) : 15

  const tileKeys = new Map()
  for (const [lng, lat] of points) {
    const { x, y } = latLngToTileXY(lat, lng, z)
    const key = `${z}/${x}/${y}`
    if (!tileKeys.has(key)) tileKeys.set(key, { x, y, z })
  }
  await Promise.all(
    [...tileKeys.entries()].map(([, { x, y, z }]) =>
      loadTilePixels(z, x, y).catch(() => null)
    )
  )

  return points.map(([lng, lat]) => {
    const { x, y }             = latLngToTileXY(lat, lng, z)
    const data                 = tileCache.get(`${z}/${x}/${y}`)
    if (!data) return null
    const { px, py, fpx, fpy } = tilePixelOffset(lat, lng, x, y, z)
    const h = nearestPixelElev(data, fpx, fpy, px, py)
    return (h > -500 && h < 9000) ? h : null
  })
}

// Elevações em batch — zoom adaptativo por extensão, bilinear (sem suavização)
export async function getElevationsBatchDEM(points, extentM = null) {
  if (!points || points.length === 0) return []

  const z = extentM ? zoomForExtent(extentM) : 14

  // Pré-carrega todos os tiles únicos em paralelo
  const tileKeys = new Map()
  for (const [lng, lat] of points) {
    const { x, y } = latLngToTileXY(lat, lng, z)
    const key = `${z}/${x}/${y}`
    if (!tileKeys.has(key)) tileKeys.set(key, { x, y, z })
  }
  await Promise.all(
    [...tileKeys.entries()].map(([, { x, y, z }]) =>
      loadTilePixels(z, x, y).catch(() => null)
    )
  )

  // Decodifica cada ponto com bilinear (sem Catmull-Rom — áreas planas ficam planas)
  return points.map(([lng, lat]) => {
    const { x, y }             = latLngToTileXY(lat, lng, z)
    const data                 = tileCache.get(`${z}/${x}/${y}`)
    if (!data) return null
    const { px, py, fpx, fpy } = tilePixelOffset(lat, lng, x, y, z)
    const h = bilinearElevation(data, fpx, fpy, px, py)
    return (h > -500 && h < 9000) ? h : null
  })
}

// Batch com interpolação bicúbica Catmull-Rom — perfis de terreno mais suaves
export async function getElevationsBatchDEMBicubic(points, extentM = null) {
  if (!points || points.length === 0) return []
  const z = extentM ? Math.min(15, zoomForExtent(extentM) + 1) : 15
  const tileKeys = new Map()
  for (const [lng, lat] of points) {
    const { x, y } = latLngToTileXY(lat, lng, z)
    const key = `${z}/${x}/${y}`
    if (!tileKeys.has(key)) tileKeys.set(key, { x, y, z })
  }
  await Promise.all(
    [...tileKeys.entries()].map(([, { x, y, z }]) =>
      loadTilePixels(z, x, y).catch(() => null)
    )
  )
  return points.map(([lng, lat]) => {
    const { x, y }             = latLngToTileXY(lat, lng, z)
    const data                 = tileCache.get(`${z}/${x}/${y}`)
    if (!data) return null
    const { px, py, fpx, fpy } = tilePixelOffset(lat, lng, x, y, z)
    const h = bicubicElevation(data, fpx, fpy, px, py)
    return (h > -500 && h < 9000) ? h : null
  })
}

// ── Copernicus GLO-30 via /api/elevation (backend proxy → OpenTopoData) ──────
// Limite free tier: 100 pontos/request, 1 req/s → delay entre batches
export async function getElevationsBatchCopernicus(points) {
  const BATCH = 100
  const results = new Array(points.length).fill(null)
  for (let i = 0; i < points.length; i += BATCH) {
    const chunk = points.slice(i, i + BATCH)
    const lats  = chunk.map(p => p[1].toFixed(7)).join(',')
    const lngs  = chunk.map(p => p[0].toFixed(7)).join(',')
    const res   = await fetch(`/api/elevation?latitude=${lats}&longitude=${lngs}`)
    if (!res.ok) throw new Error(`elevation API ${res.status}`)
    const data  = await res.json()
    ;(data.elevation || []).forEach((e, j) => { results[i + j] = e })
    if (i + BATCH < points.length) await new Promise(r => setTimeout(r, 1150))
  }
  return results
}

// ── Suavização Savitzky-Golay (janela=9, polinômio grau 3) ───────────────────
// Remove ruído de quantização dos tiles DEM sem achatar picos/vales reais.
// Coeficientes exatos para janela=9, ordem=3: [-21,14,39,54,59,54,39,14,-21] / 231
export function savitzkyGolay(elevs, windowHalf = 4) {
  const n = elevs.length
  if (n < 5) return [...elevs]
  const result = new Array(n)
  if (windowHalf === 4) {
    const C = [-21, 14, 39, 54, 59, 54, 39, 14, -21]
    const S = 231
    for (let i = 0; i < n; i++) {
      let sum = 0
      for (let k = 0; k < 9; k++) {
        sum += elevs[Math.max(0, Math.min(n - 1, i - 4 + k))] * C[k]
      }
      result[i] = sum / S
    }
  } else {
    for (let i = 0; i < n; i++) {
      let sum = 0, wsum = 0
      for (let j = -windowHalf; j <= windowHalf; j++) {
        const idx = Math.max(0, Math.min(n - 1, i + j))
        const w = Math.exp(-2 * (j / windowHalf) ** 2)
        sum += elevs[idx] * w; wsum += w
      }
      result[i] = sum / wsum
    }
  }
  return result
}

// Batch com fallback para API backend (Copernicus30 via OpenTopoData)
export async function getElevationsBatchWithFallback(points, fallbackFn, extentM = null) {
  try {
    const demResults = await getElevationsBatchDEM(points, extentM)
    const valid = demResults.filter(v => v !== null).length
    if (valid / demResults.length >= 0.8) {
      // Preenche nulos com interpolação linear dos vizinhos
      for (let i = 0; i < demResults.length; i++) {
        if (demResults[i] !== null) continue
        let lo = i - 1, hi = i + 1
        while (lo >= 0 && demResults[lo] === null) lo--
        while (hi < demResults.length && demResults[hi] === null) hi++
        const vlo = lo >= 0 ? demResults[lo] : null
        const vhi = hi < demResults.length ? demResults[hi] : null
        if (vlo !== null && vhi !== null) {
          const t = (i - lo) / (hi - lo)
          demResults[i] = vlo + (vhi - vlo) * t
        } else {
          demResults[i] = vlo ?? vhi ?? 0
        }
      }
      return { elevations: demResults, source: 'Terrarium bilinear' }
    }
  } catch (_) {}

  // Fallback: Copernicus GLO-30 via backend (mesmo modelo do ESRI TopoMap)
  try {
    const elevations = await fallbackFn(points)
    return { elevations, source: 'Copernicus GLO-30 30m' }
  } catch (err) {
    throw err
  }
}
