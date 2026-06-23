import { fromArrayBuffer } from 'geotiff'

// ── 1. Ler GeoTIFF ─────────────────────────────────────────────
export async function parseTif(arrayBuffer) {
  const tiff  = await fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()

  const bbox    = image.getBoundingBox()
  const width   = image.getWidth()
  const height  = image.getHeight()

  const rasters = await image.readRasters()
  const band    = rasters[0]

  const fileDir     = image.fileDirectory
  const noDataStr   = fileDir.GDAL_NODATA
  const noDataValue = noDataStr != null ? parseFloat(noDataStr.trim()) : null

  const isGeographic = (
    bbox[0] >= -180 && bbox[2] <= 180 &&
    bbox[1] >= -90  && bbox[3] <= 90
  )

  return { bbox, width, height, band, noDataValue, isGeographic }
}

// ── 2. Elevação por interpolação bilinear ──────────────────────
export function tifElevAt(meta, lat, lng) {
  const { bbox, width, height, band, noDataValue } = meta
  const [west, south, east, north] = bbox

  if (lng < west || lng > east || lat < south || lat > north) return null

  const u = (lng - west)  / (east  - west)  * (width  - 1)
  const v = (north - lat) / (north - south) * (height - 1)

  const c0 = Math.max(0, Math.min(width  - 2, Math.floor(u)))
  const r0 = Math.max(0, Math.min(height - 2, Math.floor(v)))
  const uf = u - c0
  const vf = v - r0

  function px(c, r) {
    const val = band[r * width + c]
    if (val == null) return null
    if (noDataValue !== null && Math.abs(val - noDataValue) < 1) return null
    if (val < -1000 || val > 9000) return null
    return val
  }

  const e00 = px(c0,   r0),   e10 = px(c0+1, r0)
  const e01 = px(c0,   r0+1), e11 = px(c0+1, r0+1)

  const valid = [e00, e10, e01, e11].filter(v => v !== null)
  if (valid.length === 0) return null
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length

  const v00 = e00 ?? avg, v10 = e10 ?? avg
  const v01 = e01 ?? avg, v11 = e11 ?? avg

  return v00*(1-uf)*(1-vf) + v10*uf*(1-vf) + v01*(1-uf)*vf + v11*uf*vf
}

// ── 3. Amostragem em grade ─────────────────────────────────────
export function sampleTifGrid(meta, mapBounds, cols, rows) {
  const [tifW, tifS, tifE, tifN] = meta.bbox

  const west  = Math.max(mapBounds.west,  tifW)
  const east  = Math.min(mapBounds.east,  tifE)
  const south = Math.max(mapBounds.south, tifS)
  const north = Math.min(mapBounds.north, tifN)

  if (west >= east || south >= north) return []

  const dLat = (north - south) / (rows - 1)
  const dLng = (east  - west)  / (cols - 1)

  const pts = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat  = south + r * dLat
      const lng  = west  + c * dLng
      const elev = tifElevAt(meta, lat, lng)
      pts.push({ lng, lat, elev })
    }
  }
  return pts
}

// ── 4. Mapa de Declividade (graus) ────────────────────────────
/**
 * Calcula ângulo de inclinação para cada pixel do raster.
 * Usa método de Zevenbergen & Thorne (diferenças finitas centrais).
 * Retorna Float32Array com ângulo em graus [0°–90°].
 */
export function calcularSlope(band, largura, altura, resolucaoMetros = 30) {
  const slope = new Float32Array(largura * altura)

  for (let y = 1; y < altura - 1; y++) {
    for (let x = 1; x < largura - 1; x++) {
      const i = y * largura + x

      const dzdx = (band[i + 1] - band[i - 1]) / (2 * resolucaoMetros)
      const dzdy = (band[i + largura] - band[i - largura]) / (2 * resolucaoMetros)

      slope[i] = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * (180 / Math.PI)
    }
  }

  return slope
}

// ── 5. Mapa de Aspecto (direção da máxima inclinação) ─────────
export function calcularAspect(band, largura, altura, resolucaoMetros = 30) {
  const aspect = new Float32Array(largura * altura)

  for (let y = 1; y < altura - 1; y++) {
    for (let x = 1; x < largura - 1; x++) {
      const i = y * largura + x

      const dzdx = (band[i + 1] - band[i - 1]) / (2 * resolucaoMetros)
      const dzdy = (band[i + largura] - band[i - largura]) / (2 * resolucaoMetros)

      let a = Math.atan2(dzdy, -dzdx) * (180 / Math.PI)
      if (a < 0) a += 360
      aspect[i] = a
    }
  }

  return aspect
}

// ── 6. Hillshade ──────────────────────────────────────────────
/**
 * Gera mapa de sombreamento analítico.
 * azimute: direção do sol em graus (padrão 315° = NO), altitude: elevação do sol (padrão 45°).
 * Retorna Uint8Array com valores 0–255.
 */
export function calcularHillshade(band, largura, altura, resolucaoMetros = 30, azimute = 315, altitudeSol = 45) {
  const hillshade = new Uint8Array(largura * altura)

  const zenithRad  = (90 - altitudeSol) * Math.PI / 180
  const azimuthRad = (360 - azimute + 90) * Math.PI / 180

  for (let y = 1; y < altura - 1; y++) {
    for (let x = 1; x < largura - 1; x++) {
      const i = y * largura + x

      const dzdx = (band[i + 1] - band[i - 1]) / (2 * resolucaoMetros)
      const dzdy = (band[i + largura] - band[i - largura]) / (2 * resolucaoMetros)

      const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy))

      let aspectRad = Math.atan2(dzdy, -dzdx)
      if (aspectRad < 0) aspectRad += 2 * Math.PI

      const hs = 255 * (
        Math.cos(zenithRad)  * Math.cos(slopeRad) +
        Math.sin(zenithRad)  * Math.sin(slopeRad) *
        Math.cos(azimuthRad - aspectRad)
      )

      hillshade[i] = Math.max(0, Math.min(255, Math.round(hs)))
    }
  }

  return hillshade
}

// ── 7. Suavização Adaptativa ──────────────────────────────────
/**
 * Preserva taludes (diff > 3m) sem suavizar, suaviza levemente platôs.
 * Essencial para manter bermas, cortes e escavações visíveis.
 */
export function suavizacaoAdaptativa(band, largura, altura) {
  const resultado = new Float32Array(band.length)

  for (let y = 1; y < altura - 1; y++) {
    for (let x = 1; x < largura - 1; x++) {
      const i = y * largura + x
      const centro = band[i]

      const vizinhos = [
        band[i - 1], band[i + 1],
        band[i - largura], band[i + largura],
      ]

      const media = vizinhos.reduce((a, b) => a + b, 0) / 4
      const diff  = Math.abs(centro - media)

      if (diff < 1) {
        resultado[i] = (centro + media) / 2
      } else if (diff < 3) {
        resultado[i] = centro * 0.75 + media * 0.25
      } else {
        resultado[i] = centro
      }
    }
  }

  // Bordas sem suavização
  for (let x = 0; x < largura; x++) {
    resultado[x] = band[x]
    resultado[(altura - 1) * largura + x] = band[(altura - 1) * largura + x]
  }
  for (let y = 0; y < altura; y++) {
    resultado[y * largura] = band[y * largura]
    resultado[y * largura + largura - 1] = band[y * largura + largura - 1]
  }

  return resultado
}

// ── 8. Geração de Curvas de Nível com marchingsquares ─────────
/**
 * Gera curvas de nível da grade de elevações.
 * intervalo: equidistância em metros (1m = muito preciso, 5m = padrão).
 * Retorna array de { elevacao, linhas: [[[col,row],...]] }.
 */
export async function gerarCurvasNivel(matriz2d, elevMin, elevMax, intervalo = 5) {
  let isoLines
  try {
    const mod = await import('marchingsquares')
    isoLines = mod.isoLines || mod.default?.isoLines
  } catch (e) {
    console.warn('marchingsquares não disponível:', e)
    return []
  }

  if (!isoLines) return []

  const curvas = []

  for (let cota = Math.ceil(elevMin / intervalo) * intervalo; cota <= elevMax; cota += intervalo) {
    try {
      const linhas = isoLines(matriz2d, cota)
      if (linhas && linhas.length > 0) {
        curvas.push({ elevacao: cota, linhas })
      }
    } catch (_) {}
  }

  return curvas
}

// ── 9. Converter grade plana → matriz 2D para marchingsquares ─
export function bandParaMatriz2D(band, largura, altura) {
  const matriz = []
  for (let y = 0; y < altura; y++) {
    const row = []
    for (let x = 0; x < largura; x++) {
      row.push(band[y * largura + x] || 0)
    }
    matriz.push(row)
  }
  return matriz
}

// ── 10. Identificar possíveis taludes ─────────────────────────
/**
 * Retorna lista de pixels com slope > limiteGraus.
 * Padrão 30° = talude geotécnico de atenção (NBR 11682).
 */
export function identificarTaludes(slope, largura, altura, limiteGraus = 30) {
  const taludes = []
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      if (slope[y * largura + x] > limiteGraus) {
        taludes.push({ x, y, slope: slope[y * largura + x] })
      }
    }
  }
  return taludes
}

// ── 11. Estatísticas de altitude em polígono ──────────────────
export function estatisticasPoligono(pts) {
  const elevs = pts.map(p => p.elev).filter(e => e != null && !isNaN(e))
  if (elevs.length === 0) return null

  elevs.sort((a, b) => a - b)
  const n    = elevs.length
  const soma = elevs.reduce((a, b) => a + b, 0)
  const avg  = soma / n
  const variancia = elevs.reduce((a, b) => a + (b - avg) ** 2, 0) / n

  return {
    min:    elevs[0],
    max:    elevs[n - 1],
    media:  avg,
    mediana: n % 2 === 0 ? (elevs[n/2 - 1] + elevs[n/2]) / 2 : elevs[Math.floor(n/2)],
    desvio: Math.sqrt(variancia),
    amplitude: elevs[n - 1] - elevs[0],
    n,
  }
}

// ── 12. Consultar altitude via OpenTopoData (click no mapa) ───
export async function consultarAltitudeOpenTopo(lat, lon) {
  try {
    const res = await fetch(
      `https://api.opentopodata.org/v1/srtm30m?locations=${lat.toFixed(6)},${lon.toFixed(6)}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    return data.results?.[0]?.elevation ?? null
  } catch (e) {
    console.warn('OpenTopoData falhou:', e.message)
    return null
  }
}

// ── 13. Baixar DEM via OpenTopography ─────────────────────────
/**
 * Baixa DEM Copernicus GLO-30 para uma bounding box.
 * Requer API Key gratuita de https://portal.opentopography.org/requestApiKey
 */
export async function baixarDEMOpenTopography(south, north, west, east, apiKey) {
  const base = import.meta.env.VITE_API_URL || ''
  const params = new URLSearchParams({ south, north, west, east, apiKey })
  const url = `${base}/api/dem-download?${params}`

  const res = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const j = await res.json(); msg = j.error || msg } catch (_) {}
    throw new Error(msg)
  }

  return await res.arrayBuffer()
}
