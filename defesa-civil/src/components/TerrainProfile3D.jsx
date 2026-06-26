import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// ── Conversão geográfica → tile Web Mercator ─────────────────
function lngToTileX(lng, zoom) {
  return Math.floor((lng + 180) / 360 * Math.pow(2, zoom))
}
function latToTileY(lat, zoom) {
  const r = Math.PI / 180
  return Math.floor((1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * Math.pow(2, zoom))
}
function tileToLng(x, zoom) { return x / Math.pow(2, zoom) * 360 - 180 }
function tileToLat(y, zoom) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, zoom)
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

// ── Nível de zoom ideal para o bbox dado ─────────────────────
function chooseSatZoom(bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox
  const latSpan = maxLat - minLat
  const lngSpan = maxLng - minLng
  const span = Math.max(latSpan, lngSpan)
  if (span > 0.5)  return 13
  if (span > 0.1)  return 15
  if (span > 0.03) return 16
  return 17
}

// ── Baixa e costura tiles ESRI num canvas, retorna textura + canvas bruto ──
async function buildSatelliteTexture(bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox
  const zoom = chooseSatZoom(bbox)

  const txMin = lngToTileX(minLng, zoom)
  const txMax = lngToTileX(maxLng, zoom)
  const tyMin = latToTileY(maxLat, zoom)
  const tyMax = latToTileY(minLat, zoom)

  const TILE_SIZE = 256
  const cols = txMax - txMin + 1
  const rows = tyMax - tyMin + 1

  if (cols > 8 || rows > 8) return null

  const canvas = document.createElement('canvas')
  canvas.width  = cols * TILE_SIZE
  canvas.height = rows * TILE_SIZE
  const ctx = canvas.getContext('2d')

  const promises = []
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      const col = tx - txMin
      const row = ty - tyMin
      promises.push(
        new Promise(resolve => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload  = () => { ctx.drawImage(img, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE); resolve() }
          img.onerror = () => resolve()
          img.src = `/api/sat-tile/${zoom}/${ty}/${tx}`
        })
      )
    }
  }
  await Promise.all(promises)

  const totalLngMin = tileToLng(txMin, zoom)
  const totalLngMax = tileToLng(txMax + 1, zoom)
  const totalLatMax = tileToLat(tyMin, zoom)
  const totalLatMin = tileToLat(tyMax + 1, zoom)

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true

  // Retorna também o canvas bruto para análise de IA
  return { texture, canvas, totalLngMin, totalLngMax, totalLatMin, totalLatMax, zoom }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── IA ANÁLISE DE TERRENO ─────────────────────────────────────────────────────
// Usa os pixels da imagem de satélite para detectar cortes, taludes e bordas
// e gera um Normal Map que o Three.js aplica sobre o mesh 3D.
//
// Pipeline:
//   1. Luminância por pixel (grayscale)
//   2. Filtro Sobel → magnitude de borda horizontal/vertical
//   3. Detecção de cortes por cor: solo exposto (bege/marrom claro),
//      rocha nua (cinza claro), talude de mineração (laranja/terra)
//   4. Mapa de normais: bordas fortes → normais inclinadas → relevo visual
//   5. Overlay de destaque (tint) nas áreas de corte detectadas
// ─────────────────────────────────────────────────────────────────────────────
function buildNormalMapFromSatellite(satCanvas, strengthMultiplier = 4.0) {
  const W = satCanvas.width
  const H = satCanvas.height
  const srcCtx = satCanvas.getContext('2d')
  let srcData
  try {
    srcData = srcCtx.getImageData(0, 0, W, H)
  } catch {
    return null  // canvas tainted (CORS falhou)
  }
  const src = srcData.data

  // ── Luminância por pixel ──────────────────────────────────────
  const lum = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const r = src[i*4] / 255, g = src[i*4+1] / 255, b = src[i*4+2] / 255
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b
  }

  // ── Canvas de normal map ─────────────────────────────────────
  const normCanvas = document.createElement('canvas')
  normCanvas.width = W; normCanvas.height = H
  const normCtx = normCanvas.getContext('2d')
  const normOut  = normCtx.createImageData(W, H)
  const nd = normOut.data

  // ── Canvas de highlight (overlay de cortes detectados) ───────
  const hlCanvas = document.createElement('canvas')
  hlCanvas.width = W; hlCanvas.height = H
  const hlCtx = hlCanvas.getContext('2d')
  const hlOut  = hlCtx.createImageData(W, H)
  const hd = hlOut.data

  const S = strengthMultiplier

  for (let y = 1; y < H-1; y++) {
    for (let x = 1; x < W-1; x++) {
      const idx = y * W + x
      // Sobel 3×3 sobre luminância
      const gx = (
        -lum[(y-1)*W+(x-1)] + lum[(y-1)*W+(x+1)]
        -2*lum[y*W+(x-1)]   + 2*lum[y*W+(x+1)]
        -lum[(y+1)*W+(x-1)] + lum[(y+1)*W+(x+1)]
      )
      const gy = (
        -lum[(y-1)*W+(x-1)] - 2*lum[(y-1)*W+x] - lum[(y-1)*W+(x+1)]
        +lum[(y+1)*W+(x-1)] + 2*lum[(y+1)*W+x] + lum[(y+1)*W+(x+1)]
      )
      const mag = Math.sqrt(gx*gx + gy*gy)  // 0..~1.4

      // Normal map: converte gradiente → vetor normal normalizado
      const nx = -gx * S
      const ny = -gy * S
      const nz = 1.0
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1
      nd[idx*4]   = Math.round(((nx/len) * 0.5 + 0.5) * 255)
      nd[idx*4+1] = Math.round(((ny/len) * 0.5 + 0.5) * 255)
      nd[idx*4+2] = Math.round(((nz/len) * 0.5 + 0.5) * 255)
      nd[idx*4+3] = 255

      // ── Detecção de corte/talude por cor ─────────────────────
      // Solo exposto, rocha nua, terra de mineração = alta luminância +
      // saturação baixa OU tonalidade bege/laranja — visíveis por satélite
      const r = src[idx*4] / 255
      const g = src[idx*4+1] / 255
      const b = src[idx*4+2] / 255
      const sat = Math.max(r,g,b) - Math.min(r,g,b)
      const isExposedRock  = lum[idx] > 0.50 && sat < 0.18  // cinza claro/branco
      const isExposedEarth = r > 0.40 && r > g*1.15 && r > b*1.3 && lum[idx] > 0.30 && lum[idx] < 0.72  // marrom/laranja
      const isSharpEdge    = mag > 0.18  // borda forte = transição abrupta

      // Highlight: overlay semitransparente amarelo-laranja nas bordas detectadas
      if ((isExposedRock || isExposedEarth) && isSharpEdge) {
        const t = Math.min((mag - 0.18) / 0.35, 1)
        hd[idx*4]   = 255
        hd[idx*4+1] = Math.round(200 - t * 80)  // amarelo → laranja
        hd[idx*4+2] = 0
        hd[idx*4+3] = Math.round(t * 160)        // semitransparente
      } else if (isSharpEdge && mag > 0.30) {
        // Borda forte genérica (contraste alto) → destaque azul-ciano suave
        const t = Math.min((mag - 0.30) / 0.40, 1)
        hd[idx*4]   = 30
        hd[idx*4+1] = 190
        hd[idx*4+2] = 240
        hd[idx*4+3] = Math.round(t * 90)
      } else {
        hd[idx*4+3] = 0  // transparente
      }
    }
  }

  normCtx.putImageData(normOut, 0, 0)
  hlCtx.putImageData(hlOut, 0, 0)

  const normalMap = new THREE.CanvasTexture(normCanvas)
  normalMap.wrapS = THREE.ClampToEdgeWrapping
  normalMap.wrapT = THREE.ClampToEdgeWrapping
  normalMap.needsUpdate = true

  const highlightMap = new THREE.CanvasTexture(hlCanvas)
  highlightMap.wrapS = THREE.ClampToEdgeWrapping
  highlightMap.wrapT = THREE.ClampToEdgeWrapping
  highlightMap.needsUpdate = true

  return { normalMap, highlightMap }
}

// ── Combina textura satélite + overlay de cortes num único canvas ─
function buildCompositeTexture(satCanvas, hlCanvas) {
  const W = satCanvas.width, H = satCanvas.height
  const out = document.createElement('canvas')
  out.width = W; out.height = H
  const ctx = out.getContext('2d')
  ctx.drawImage(satCanvas, 0, 0)
  ctx.globalAlpha = 0.72
  ctx.drawImage(hlCanvas, 0, 0)
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(out)
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

// ── Cor por altitude relativa (t = 0..1) — usada no ribbon (medir) ──
function elevToColor(t) {
  const low  = new THREE.Color(0x22c55e)
  const mid  = new THREE.Color(0xeab308)
  const high = new THREE.Color(0xf97316)
  const peak = new THREE.Color(0xef4444)
  if (t < 0.33) return low.clone().lerp(mid, t / 0.33)
  if (t < 0.66) return mid.clone().lerp(high, (t - 0.33) / 0.33)
  return high.clone().lerp(peak, (t - 0.66) / 0.34)
}

// ── Classificação de declividade por % → cor (polígono 3D) ───
const SLOPE_CLS_3D = [
  { max: 3,        cor: new THREE.Color('#22c55e') },
  { max: 8,        cor: new THREE.Color('#84cc16') },
  { max: 20,       cor: new THREE.Color('#eab308') },
  { max: 45,       cor: new THREE.Color('#f97316') },
  { max: 75,       cor: new THREE.Color('#ef4444') },
  { max: Infinity, cor: new THREE.Color('#7c3aed') },
]
function slopeToColor3D(slopePct) {
  return (SLOPE_CLS_3D.find(c => slopePct <= c.max) || SLOPE_CLS_3D[SLOPE_CLS_3D.length - 1]).cor
}

function calcContourInterval(range) {
  if (range <= 100) return 1
  if (range <= 250) return 2
  if (range <= 500) return 5
  return 10
}

// ── Marching squares — extrai segmentos de curvas de nível da grade ───────────
// Retorna array de objetos { level, isMajor, segs: [[x,y,z],[x,y,z], ...] }
function buildContourLines3D(points, cols, rows, minE, maxE, vExag, maxXPoly, forcedInterval, maxZFlip = 0) {
  const range    = maxE - minE
  const interval = (forcedInterval && forcedInterval > 0) ? forcedInterval : calcContourInterval(range)
  if (!interval || cols < 2 || rows < 2 || points.length < cols * rows) return []

  const firstLevel = Math.ceil(minE / interval) * interval
  const lastLevel  = Math.floor(maxE / interval) * interval
  const majorStep  = interval * 5
  const groups     = {}

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a  = points[r * cols + c]
      const b  = points[r * cols + c + 1]
      const d  = points[(r + 1) * cols + c + 1]
      const cc = points[(r + 1) * cols + c]
      if (!a || !b || !d || !cc) continue

      const minCell = Math.min(a.y, b.y, d.y, cc.y)
      const maxCell = Math.max(a.y, b.y, d.y, cc.y)
      const sLevel  = Math.ceil(minCell / interval) * interval
      const eLevel  = Math.floor(maxCell / interval) * interval

      for (let level = sLevel; level <= eLevel + 0.001; level += interval) {
        if (level < firstLevel - 0.001 || level > lastLevel + 0.001) continue

        const crossings = []
        function edgeCross(p1, p2) {
          const y1 = p1.y, y2 = p2.y
          if (y1 === y2) return
          if ((y1 <= level && y2 > level) || (y1 > level && y2 <= level)) {
            const t = (level - y1) / (y2 - y1)
            const zCross = p1.z + t * (p2.z - p1.z)
            crossings.push([
              p1.x + t * (p2.x - p1.x),
              (level - minE) * vExag + 0.4,
              maxZFlip > 0 ? maxZFlip - zCross : zCross,
            ])
          }
        }
        edgeCross(a, b); edgeCross(b, d); edgeCross(cc, d); edgeCross(a, cc)
        if (crossings.length < 2) continue

        const key = Math.round(level * 100)
        if (!groups[key]) {
          const rem = Math.abs(((level % majorStep) + majorStep) % majorStep)
          const isMajor = rem < 0.001 || Math.abs(rem - majorStep) < 0.001
          groups[key] = { level, isMajor, segs: [] }
        }
        groups[key].segs.push(crossings[0], crossings[1])
        if (crossings.length === 4) groups[key].segs.push(crossings[2], crossings[3])
      }
    }
  }

  return Object.values(groups)
}

// ── Sprite de texto (canvas) ──────────────────────────────────
// Tamanho em pixels constante — a escala world-space é ajustada no loop de animação
// pixW / pixH: alvo em pixels de tela (independente do zoom)
function makeTextSprite(scene, text, color, x, y, z, scaleX, scaleY) {
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 256, 64)
  // fundo invisível
  ctx.font = 'bold 12px "Courier New", monospace'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.fillText(text, 128, 39)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
  const spr = new THREE.Sprite(mat)
  // Alvo em pixels de tela — escala real calculada no animate loop
  const BASE_PX_W = 68, BASE_PX_H = 17
  spr.userData.isLabel = true
  spr.userData.pixW = scaleX ? Math.min(Math.round((scaleX / 38) * BASE_PX_W), 160) : BASE_PX_W
  spr.userData.pixH = scaleY ? Math.min(Math.round((scaleY / 10) * BASE_PX_H), 34) : BASE_PX_H
  spr.scale.set(spr.userData.pixW, spr.userData.pixH, 1)
  spr.position.set(x, y, z)
  scene.add(spr)
  return spr
}

// ── Grade do polígono — com exagero vertical opcional ─────────
// uvParams (opcional): { bbox:[minLng,minLat,maxLng,maxLat], totalLngMin, totalLngMax, totalLatMin, totalLatMax }
// Quando presente, gera UVs mapeando cada ponto (lng, lat) → (u, v) na textura costurada.
function buildGridMesh(points, cols, rows, minE, maxE, vExag = 1, uvParams = null, flipZ = false) {
  const maxX   = points.length > 0 ? points.reduce((m, p) => Math.max(m, p.x), -Infinity) : 0
  const maxZ   = points.length > 0 ? points.reduce((m, p) => Math.max(m, p.z), -Infinity) : 0
  const total  = points.length
  const positions = new Float32Array(total * 3)
  const colorsArr = new Float32Array(total * 3)
  const uvsArr    = new Float32Array(total * 2)
  const elevRange = Math.max(maxE - minE, 1)

  for (let i = 0; i < total; i++) {
    const p    = points[i]
    const relY = (p.y - minE) * vExag
    positions[i*3]   = p.x
    positions[i*3+1] = relY
    positions[i*3+2] = flipZ ? (maxZ - p.z) : p.z

    let c
    if (p.slopePct !== undefined) {
      c = slopeToColor3D(p.slopePct)
    } else {
      const t = (p.y - minE) / elevRange
      c = elevToColor(Math.min(Math.max(t, 0), 1))
    }
    colorsArr[i*3] = c.r; colorsArr[i*3+1] = c.g; colorsArr[i*3+2] = c.b

    if (uvParams) {
      // p.lng e p.lat vêm do uvParams.origin + coordenadas locais
      // Reconstruímos lng/lat a partir de x,z locais e do bbox
      const { bbox, totalLngMin, totalLngMax, totalLatMin, totalLatMax } = uvParams
      const [bboxMinLng, bboxMinLat, bboxMaxLng, bboxMaxLat] = bbox
      const lng = bboxMinLng + (p.x / maxX) * (bboxMaxLng - bboxMinLng)
      const lat = bboxMinLat + (p.z / maxZ) * (bboxMaxLat - bboxMinLat)
      const lngRange = totalLngMax - totalLngMin
      const latRange = totalLatMax - totalLatMin
      uvsArr[i*2]   = lngRange > 0 ? (lng - totalLngMin) / lngRange : 0.5
      uvsArr[i*2+1] = latRange > 0 ? (lat - totalLatMin) / latRange : 0.5
    } else {
      uvsArr[i*2]   = maxX > 0 ? p.x / maxX : 0
      uvsArr[i*2+1] = maxZ > 0 ? p.z / maxZ : 0
    }
  }
  const indices = []
  const hasInside = points.some(p => p.inside !== undefined)
  for (let r = 0; r < rows-1; r++) {
    for (let c = 0; c < cols-1; c++) {
      const a=r*cols+c, b=r*cols+c+1, cc=(r+1)*cols+c, d=(r+1)*cols+c+1
      if (hasInside) {
        const nIn = [a, b, cc, d].filter(idx => points[idx]?.inside).length
        if (nIn < 1) continue
      }
      indices.push(a, cc, b); indices.push(b, cc, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colorsArr, 3))
  geo.setAttribute('uv',       new THREE.BufferAttribute(uvsArr, 2))
  geo.setIndex(indices)
  return geo
}

// ── Fita de perfil longitudinal — com exagero vertical ────────
function buildRibbonMesh(rowsX, rowsY, rowsZ, minE, maxE, numCols, vExag = 1) {
  const NC    = numCols
  const count = rowsX.length
  const positions = new Float32Array(count * 3)
  const colorsArr = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const raw  = rowsY[i] - minE
    const relY = raw * vExag
    positions[i*3]   = rowsX[i]
    positions[i*3+1] = relY
    positions[i*3+2] = rowsZ[i]
    const t = maxE > minE ? raw / (maxE - minE) : 0.5
    const c = elevToColor(t)
    colorsArr[i*3] = c.r; colorsArr[i*3+1] = c.g; colorsArr[i*3+2] = c.b
  }
  const N = count / NC
  const indices = []
  for (let i = 0; i < N-1; i++) {
    for (let j = 0; j < NC-1; j++) {
      const a=i*NC+j, b=i*NC+j+1, c=(i+1)*NC+j, dd=(i+1)*NC+j+1
      indices.push(a, c, b); indices.push(b, c, dd)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colorsArr, 3))
  geo.setIndex(indices)
  return geo
}

// ── Casa 3D no terreno (para imóveis vistoriados) ─────────────
function addBuilding3D(scene, cx, baseY, cz, areaM2, cor, vExag) {
  const side   = Math.sqrt(Math.max(areaM2 || 50, 12))
  const wallH  = 3.5 * Math.max(vExag, 1)
  const roofH  = 2.0 * Math.max(vExag, 1)
  const color  = new THREE.Color(cor)
  const darker = color.clone().multiplyScalar(0.55)

  // Paredes (caixa)
  const wallGeo = new THREE.BoxGeometry(side, wallH, side)
  const wallMat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.82, side: THREE.DoubleSide })
  const wallMesh = new THREE.Mesh(wallGeo, wallMat)
  wallMesh.position.set(cx, baseY + wallH / 2, cz)
  scene.add(wallMesh)

  // Arestas das paredes
  const edgesGeo = new THREE.EdgesGeometry(wallGeo)
  const edgesMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 })
  const edgesMesh = new THREE.LineSegments(edgesGeo, edgesMat)
  edgesMesh.position.copy(wallMesh.position)
  scene.add(edgesMesh)

  // Telhado (pirâmide 4 lados)
  const roofGeo = new THREE.ConeGeometry(side * 0.78, roofH, 4)
  const roofMat = new THREE.MeshLambertMaterial({ color: darker, transparent: true, opacity: 0.92 })
  const roofMesh = new THREE.Mesh(roofGeo, roofMat)
  roofMesh.rotation.y = Math.PI / 4
  roofMesh.position.set(cx, baseY + wallH + roofH / 2, cz)
  scene.add(roofMesh)

  // Pilar vertical do chão à base (linha tracejada)
  const pillar = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(cx, 0, cz),
      new THREE.Vector3(cx, baseY, cz),
    ]),
    new THREE.LineDashedMaterial({ color, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.4 })
  )
  pillar.computeLineDistances()
  scene.add(pillar)
}

// ── Marcador de pico (cone + calota + label) ──────────────────
function addPeakMarker(scene, px, pz, relPeakY, realPeakElev, range, sw, sh) {
  // Dimensiona o cone pela cena, mas proporcional ao desnível real
  const coneH = Math.max(relPeakY * 0.15, sh * 1.8, 2)
  const coneR = coneH * 0.22

  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(coneR, coneH, 10),
    new THREE.MeshLambertMaterial({ color: 0xb91c1c })
  )
  cone.position.set(px, relPeakY + coneH / 2, pz)
  scene.add(cone)

  // Calota de neve para picos com grande desnível
  if (range > 60) {
    const snow = new THREE.Mesh(
      new THREE.SphereGeometry(coneR * 0.62, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2.3),
      new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 })
    )
    snow.position.set(px, relPeakY + coneH * 0.9, pz)
    scene.add(snow)
  }

  // Anel no topo
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(coneR * 1.35, coneR * 0.12, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.7 })
  )
  ring.rotation.x = Math.PI / 2
  ring.position.set(px, relPeakY + coneH + coneR * 0.4, pz)
  scene.add(ring)

  // Linha vertical tracejada do zero ao pico
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(px, 0, pz),
      new THREE.Vector3(px, relPeakY, pz),
    ]),
    new THREE.LineDashedMaterial({ color: 0xf87171, dashSize: Math.max(coneH * 0.1, 1), gapSize: Math.max(coneH * 0.06, 0.5), transparent: true, opacity: 0.5 })
  )
  line.computeLineDistances()
  scene.add(line)

  makeTextSprite(scene, `▲ ${Math.round(realPeakElev)} m`, '#f87171',
    px, relPeakY + coneH + sh * 1.1, pz, sw * 1.3, sh * 1.2)
}

// ─────────────────────────────────────────────────────────────
export default function TerrainProfile3D({ mode, perfil, gridData, lateralDists, area, vistoriaPolygons, vistoriaZonesMedir, monitoramentoMarkers, contourInterval, onClose }) {
  const mountRef        = useRef(null)
  const cameraRef       = useRef(null)
  const controlsRef     = useRef(null)
  const sceneRef        = useRef(null)
  const rendererRef     = useRef(null)
  const terrainMeshRef   = useRef(null)
  const gridInternalRef  = useRef(null)
  const satTextureRef    = useRef(null)
  const satCanvasRef     = useRef(null)   // canvas bruto para análise IA
  const normalMapRef     = useRef(null)   // normal map gerado pela IA
  const aiCompTexRef     = useRef(null)   // textura composta sat+highlight

  // Exagero vertical controlável (1x = escala real, 2x/3x = relevo amplificado)
  const [vExag, setVExag] = useState(1.0)

  const [showDists, setShowDists] = useState(true)
  const [info, setInfo] = useState(null)
  const [webglErr, setWebglErr] = useState(null)
  const [satMode, setSatMode] = useState(false)
  const [satLoading, setSatLoading] = useState(false)
  const [satError, setSatError] = useState(false)
  const [aiMode, setAiMode] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)

  const [massMovePhase, setMassMovePhase]   = useState('idle')
  const massMovePhaseRef                    = useRef('idle')
  const [massMoveCenter, setMassMoveCenter] = useState(null)
  const [massMoveRadius, setMassMoveRadius] = useState(80)
  const massMoveRadiusRef                   = useRef(80)

  const contourGroupRef  = useRef(null)
  const [showContours, setShowContours] = useState(true)
  const buildingCenterRef = useRef(null)
  const [hasBuildingInScene, setHasBuildingInScene] = useState(false)

  useEffect(() => {
    // Limpa texturas ao trocar de polígono/modo
    if (satTextureRef.current) { satTextureRef.current.dispose(); satTextureRef.current = null }
    if (normalMapRef.current)  { normalMapRef.current.dispose();  normalMapRef.current  = null }
    if (aiCompTexRef.current)  { aiCompTexRef.current.dispose();  aiCompTexRef.current  = null }
    satCanvasRef.current = null
    setSatMode(false)
    setSatError(false)
    setAiMode(false)

    const container = mountRef.current
    if (!container) return
    const W = container.clientWidth  || 800
    const H = container.clientHeight || 500

    const scene    = new THREE.Scene()
    sceneRef.current = scene
    scene.background = new THREE.Color(0x0d1117)
    scene.fog = new THREE.FogExp2(0x0d1117, 0.00016)

    const camera = new THREE.PerspectiveCamera(48, W / H, 0.1, 500000)
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
      rendererRef.current = renderer
    } catch (e) {
      setWebglErr('WebGL não disponível neste ambiente. O relevo 3D funcionará normalmente no dispositivo final (Cloudflare).')
      return
    }
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.rotateSpeed   = 0.8
    controls.zoomSpeed     = 2.5
    controls.minDistance   = 0.1
    controls.maxDistance   = 500000
    controls.zoomToCursor  = true
    cameraRef.current   = camera
    controlsRef.current = controls

    let geo = null
    let realMinE = 0, realMaxE = 0, realRange = 0
    let maxXPoly = 0   // usado para inverter eixo X no modo polígono
    let gridDivisions = 32  // resoluçao da grade decorativa de chão

    // ── Modo Polígono ──────────────────────────────────────────
    if (mode === 'poligono' && gridData?.points?.length > 0) {
      const { points, cols, rows, minE, maxE, polyVerts } = gridData
      gridDivisions = Math.max(8, Math.min(96, cols))
      realMinE = minE; realMaxE = maxE; realRange = maxE - minE
      setInfo({ minE, maxE, range: realRange, interval: calcContourInterval(realRange) })

      maxXPoly = points.length > 0 ? points.reduce((m, p) => Math.max(m, p.x), -Infinity) : 0
      const maxZFlip = points.length > 0 ? points.reduce((m, p) => Math.max(m, p.z), 0) : 0
      geo = buildGridMesh(points, cols, rows, minE, maxE, vExag, null, true)
      gridInternalRef.current = { points, cols, rows, minE, maxXPoly, bbox: gridData.bbox }

      // Wireframe leve
      scene.add(new THREE.Mesh(geo.clone(),
        new THREE.MeshBasicMaterial({ color: 0x1e3a5f, wireframe: true, transparent: true, opacity: 0.05 })))

      // ── Curvas de nível 3D (marching squares sobre grade COP30) ──────────
      {
        const contourData = buildContourLines3D(points, cols, rows, minE, maxE, vExag, maxXPoly, contourInterval, maxZFlip)
        const cGroup = new THREE.Group()
        cGroup.visible = true
        contourGroupRef.current = cGroup

        contourData.forEach(({ level, isMajor, segs }) => {
          if (segs.length < 2) return
          const pts3 = segs.map(([x, y, z]) => new THREE.Vector3(x, y, z))
          const cGeo = new THREE.BufferGeometry().setFromPoints(pts3)
          const cMat = new THREE.LineBasicMaterial({
            color: isMajor ? 0x60a5fa : 0x2563eb,
            transparent: true,
            opacity: isMajor ? 0.88 : 0.40,
          })
          cGroup.add(new THREE.LineSegments(cGeo, cMat))

          if (isMajor && segs.length >= 2) {
            const mid = segs[Math.floor(segs.length / 2)]
            if (mid) makeTextSprite(cGroup, `${Math.round(level)} m`, '#93c5fd',
              mid[0], mid[1] + 0.9, mid[2], 30, 8)
          }
        })
        scene.add(cGroup)
      }

      // ── Borda do polígono no terreno 3D ───────────────────────
      if (polyVerts?.length >= 3) {
        // Tamanho dos marcadores de vértice proporcional à cena
        const vtxR = Math.max((gridData.cols > 0 ? (points[points.length - 1]?.x || 50) / gridData.cols : 1) * 0.7, 0.4)

        const fz = v => maxZFlip - v.z   // helper: inverte Z do polígono
        const borderPts = polyVerts.map(v => new THREE.Vector3(
          v.x,
          (v.y - realMinE) * vExag + 0.8,
          fz(v)
        ))
        borderPts.push(borderPts[0].clone())  // fechar
        const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPts)
        scene.add(new THREE.Line(borderGeo,
          new THREE.LineBasicMaterial({ color: 0xfbbf24, linewidth: 3, transparent: true, opacity: 0.95 })
        ))
        // Labels pequenos nos vértices do polígono (sem esferas)
        polyVerts.forEach((v, i) => {
          makeTextSprite(scene, `V${i+1}`, '#fbbf24',
            v.x, (v.y - realMinE) * vExag + Math.max(vtxR * 1.5, 1.2), fz(v),
            Math.max(vtxR * 6, 7), Math.max(vtxR * 1.5, 2))
        })

        // ── Paredes 3D extrudadas do polígono ─────────────────
        const wallH = Math.max(realRange * 0.22, 2.5)

        // Linha de topo das paredes
        const topWallPts = polyVerts.map(v => new THREE.Vector3(
          v.x, (v.y - realMinE) * vExag + wallH * vExag + 0.8, fz(v)
        ))
        topWallPts.push(topWallPts[0].clone())
        scene.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(topWallPts),
          new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.65 })
        ))

        // Painéis semitransparentes entre vértices adjacentes
        for (let wi = 0; wi < polyVerts.length; wi++) {
          const v1 = polyVerts[wi]
          const v2 = polyVerts[(wi + 1) % polyVerts.length]
          const x1 = v1.x
          const x2 = v2.x
          const z1 = fz(v1)
          const z2 = fz(v2)
          const y1b = (v1.y - realMinE) * vExag + 0.8
          const y2b = (v2.y - realMinE) * vExag + 0.8
          const y1t = y1b + wallH * vExag
          const y2t = y2b + wallH * vExag
          const wallPos = new Float32Array([
            x1, y1b, z1,  x2, y2b, z2,  x2, y2t, z2,
            x1, y1b, z1,  x2, y2t, z2,  x1, y1t, z1,
          ])
          const wGeo = new THREE.BufferGeometry()
          wGeo.setAttribute('position', new THREE.BufferAttribute(wallPos, 3))
          scene.add(new THREE.Mesh(wGeo, new THREE.MeshBasicMaterial({
            color: 0xfbbf24, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false,
          })))
          // Pilares tracejados verticais nos vértices
          const pillar = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(x1, y1b, v1.z),
              new THREE.Vector3(x1, y1t, v1.z),
            ]),
            new THREE.LineDashedMaterial({
              color: 0xfbbf24,
              dashSize: Math.max(wallH * vExag * 0.28, 0.5),
              gapSize:  Math.max(wallH * vExag * 0.14, 0.25),
              transparent: true, opacity: 0.5,
            })
          )
          pillar.computeLineDistances()
          scene.add(pillar)
        }
      }

      // ── Overlay: polígono real 3D das vistorias no relevo ──────
      if (vistoriaPolygons?.length > 0) {
        const vsw = Math.max(realRange * 0.8, 30)
        const vsh = Math.max(realRange * 0.15, 6)

        vistoriaPolygons.forEach(vp => {
          const col = new THREE.Color(vp.cor)

          // ── Caso B: só centróide (sem polígono desenhado) ──────
          if (!vp.verts || vp.verts.length < 3) {
            if (!vp.centroid) return
            const cx = vp.centroid.x
            const cz = maxZFlip - vp.centroid.z
            const baseY = (vp.centroid.y - realMinE) * vExag
            const poleH = Math.max(realRange * 0.22, 4) * Math.max(vExag, 1)
            const sR    = Math.max(realRange * 0.022, 1.0)

            // Haste vertical
            const pole = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(cx, baseY, cz),
                new THREE.Vector3(cx, baseY + poleH, cz),
              ]),
              new THREE.LineDashedMaterial({ color: col, dashSize: poleH * 0.14, gapSize: poleH * 0.07, transparent: true, opacity: 0.75 })
            )
            pole.computeLineDistances(); scene.add(pole)

            // Esfera no topo
            const sph = new THREE.Mesh(
              new THREE.SphereGeometry(sR * 1.4, 14, 12),
              new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.88 })
            )
            sph.position.set(cx, baseY + poleH, cz); scene.add(sph)

            // Halo
            const halo = new THREE.Mesh(
              new THREE.TorusGeometry(sR * 2.4, sR * 0.22, 8, 28),
              new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45 })
            )
            halo.rotation.x = Math.PI / 2
            halo.position.set(cx, baseY + poleH, cz); scene.add(halo)

            // Label
            makeTextSprite(scene,
              `${vp.risco} · ${vp.nome}`,
              vp.cor, cx, baseY + poleH + vsh * 1.1, cz, vsw * 1.4, vsh * 1.2
            )

            // Edificação se disponível
            if (vp.edificacaoVerts?.length >= 3) {
              try {
                const efv = vp.edificacaoVerts.map(v => ({ x: v.x, z: maxZFlip - v.z, y: v.y }))
                const edifBaseY = (efv.reduce((s, v) => s + v.y, 0) / efv.length - realMinE) * vExag
                const edifH = (vp.edificacaoAltura || vp.alturaImovel || 3) * Math.max(vExag, 1)
                const edifPts = efv.map(v => new THREE.Vector3(v.x, (v.y - realMinE) * vExag + 0.6, v.z))
                edifPts.push(edifPts[0].clone())
                scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edifPts),
                  new THREE.LineBasicMaterial({ color: 0xf97316, linewidth: 2, transparent: true, opacity: 0.95 })))
                const edifShape = new THREE.Shape()
                edifShape.moveTo(efv[0].x, -efv[0].z)
                efv.slice(1).forEach(v => edifShape.lineTo(v.x, -v.z))
                edifShape.closePath()
                const edifGeo = new THREE.ExtrudeGeometry(edifShape, { depth: edifH, bevelEnabled: false })
                edifGeo.rotateX(-Math.PI / 2); edifGeo.translate(0, edifBaseY + 0.6, 0)
                scene.add(new THREE.Mesh(edifGeo, new THREE.MeshLambertMaterial({
                  color: 0xf97316, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
                })))
              } catch (_) {}
            }
            return
          }

          // Vértices com Z invertido para coincidir com o flipZ do terreno
          const fv = vp.verts.map(v => ({
            x: v.x,
            z: maxZFlip - v.z,
            y: v.y,
          }))

          // Centróide e elevação base
          const cx      = fv.reduce((s, v) => s + v.x, 0) / fv.length
          const cz      = fv.reduce((s, v) => s + v.z, 0) / fv.length
          const baseY   = (fv.reduce((s, v) => s + v.y, 0) / fv.length - realMinE) * vExag
          const wallH   = vp.alturaImovel
            ? vp.alturaImovel * Math.max(vExag, 1)
            : Math.max(realRange * 0.18, 3) * Math.max(vExag, 1)

          // ── Contorno no terreno ─────────────────────────────
          const pts3d = fv.map(v => new THREE.Vector3(v.x, (v.y - realMinE) * vExag + 0.5, v.z))
          pts3d.push(pts3d[0].clone())
          scene.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts3d),
            new THREE.LineBasicMaterial({ color: col, linewidth: 2, transparent: true, opacity: 0.95 })
          ))

          // ── Polígono extrudado com a forma real ─────────────
          try {
            // THREE.Shape usa XY; vamos usar (x, -z) e rotacionar para o plano XZ
            const shape = new THREE.Shape()
            shape.moveTo(fv[0].x, -fv[0].z)
            fv.slice(1).forEach(v => shape.lineTo(v.x, -v.z))
            shape.closePath()

            const extGeo = new THREE.ExtrudeGeometry(shape, {
              depth: wallH, bevelEnabled: false,
            })
            // rotateX(-π/2): plano XY → XZ, extrusão +Z → +Y
            extGeo.rotateX(-Math.PI / 2)
            extGeo.translate(0, baseY + 0.5, 0)

            scene.add(new THREE.Mesh(extGeo, new THREE.MeshLambertMaterial({
              color: col, transparent: true, opacity: 0.42,
              side: THREE.DoubleSide, depthWrite: false,
            })))

            // Aresta do topo
            const topPts = fv.map(v => new THREE.Vector3(v.x, baseY + wallH + 0.5, v.z))
            topPts.push(topPts[0].clone())
            scene.add(new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(topPts),
              new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 })
            ))
          } catch (_) {
            // Fallback: só o contorno já foi adicionado
          }

          // ── Edificação interna (gpsVerts da Vistoria Residencial) ──
          if (vp.edificacaoVerts?.length >= 3) {
            try {
              const efv = vp.edificacaoVerts.map(v => ({
                x: v.x,
                z: maxZFlip - v.z,
                y: v.y,
              }))
              const edifBaseY = (efv.reduce((s, v) => s + v.y, 0) / efv.length - realMinE) * vExag
              const edifH = (vp.edificacaoAltura || vp.alturaImovel || 3) * Math.max(vExag, 1)

              // Contorno laranja da edificação no terreno
              const edifPts = efv.map(v => new THREE.Vector3(v.x, (v.y - realMinE) * vExag + 0.6, v.z))
              edifPts.push(edifPts[0].clone())
              scene.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(edifPts),
                new THREE.LineBasicMaterial({ color: 0xf97316, linewidth: 2, transparent: true, opacity: 0.95 })
              ))

              // Sólido extrudado da edificação
              const edifShape = new THREE.Shape()
              edifShape.moveTo(efv[0].x, -efv[0].z)
              efv.slice(1).forEach(v => edifShape.lineTo(v.x, -v.z))
              edifShape.closePath()
              const edifGeo = new THREE.ExtrudeGeometry(edifShape, { depth: edifH, bevelEnabled: false })
              edifGeo.rotateX(-Math.PI / 2)
              edifGeo.translate(0, edifBaseY + 0.6, 0)
              scene.add(new THREE.Mesh(edifGeo, new THREE.MeshLambertMaterial({
                color: 0xf97316, transparent: true, opacity: 0.55,
                side: THREE.DoubleSide, depthWrite: false,
              })))
            } catch (_) {}
          }

          // Label acima
          const altLabel = vp.alturaImovel ? ` · ${vp.alturaImovel}m` : ''
          makeTextSprite(scene,
            `${vp.risco} · ${vp.nome}${altLabel}`,
            vp.cor, cx, baseY + wallH + vsh * 0.8, cz, vsw * 1.5, vsh * 1.2
          )

          // ── Anomalias da vistoria no relevo 3D ─────────────────
          if (vp.anomalias?.length > 0) {
            const sR = Math.max(realRange * 0.016, 0.7)
            vp.anomalias.forEach(a => {
              const ax = a.sx
              const az = maxZFlip - a.sz
              const aY = baseY + 0.5 + a.yFrac * wallH

              // Esfera vermelha
              const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(sR, 10, 10),
                new THREE.MeshLambertMaterial({ color: 0xff1133, emissive: new THREE.Color(0x550011) })
              )
              sphere.position.set(ax, aY, az)
              scene.add(sphere)

              // Anel ao redor da esfera
              const ring = new THREE.Mesh(
                new THREE.TorusGeometry(sR * 1.6, sR * 0.22, 8, 20),
                new THREE.MeshBasicMaterial({ color: 0xff4455, transparent: true, opacity: 0.65 })
              )
              ring.rotation.x = Math.PI / 2
              ring.position.set(ax, aY, az)
              scene.add(ring)

              // Linha vertical até a base do imóvel
              const pillar = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                  new THREE.Vector3(ax, baseY + 0.5, az),
                  new THREE.Vector3(ax, aY, az),
                ]),
                new THREE.LineDashedMaterial({ color: 0xff4455, dashSize: sR * 0.8, gapSize: sR * 0.4, transparent: true, opacity: 0.5 })
              )
              pillar.computeLineDistances()
              scene.add(pillar)

              // Etiqueta com nome
              makeTextSprite(scene, a.nome, '#ff4455',
                ax, aY + sR * 3 + vsh * 0.3, az,
                Math.max(vsw * 0.9, 25), Math.max(vsh * 0.85, 5)
              )
            })
          }

          // ── Paredes com anomalia da vistoria (laranja) ─────────
          if (vp.paredes?.length > 0) {
            vp.paredes.forEach(p => {
              const pSX = p.startSx
              const pSZ = maxZFlip - p.startSz
              const pEX = p.endSx
              const pEZ = maxZFlip - p.endSz
              const yBot = baseY + 0.5 + p.yBaseFrac * wallH
              const yTop = baseY + 0.5 + (p.yBaseFrac + p.wallFrac) * wallH

              // Quad translúcido laranja
              const pos = new Float32Array([
                pSX, yBot, pSZ,
                pEX, yBot, pEZ,
                pEX, yTop, pEZ,
                pSX, yTop, pSZ,
              ])
              const wGeo = new THREE.BufferGeometry()
              wGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
              wGeo.setIndex([0, 1, 2, 0, 2, 3])
              wGeo.computeVertexNormals()
              scene.add(new THREE.Mesh(wGeo, new THREE.MeshLambertMaterial({
                color: 0xf97316, transparent: true, opacity: 0.62,
                side: THREE.DoubleSide, depthWrite: false,
              })))

              // Contorno laranja
              scene.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                  new THREE.Vector3(pSX, yBot, pSZ),
                  new THREE.Vector3(pEX, yBot, pEZ),
                  new THREE.Vector3(pEX, yTop, pEZ),
                  new THREE.Vector3(pSX, yTop, pSZ),
                  new THREE.Vector3(pSX, yBot, pSZ),
                ]),
                new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.95 })
              ))

              // Etiqueta
              const midX = (pSX + pEX) / 2
              const midZ = (pSZ + pEZ) / 2
              makeTextSprite(scene, p.nome, '#f97316',
                midX, yTop + vsh * 0.3, midZ,
                Math.max(vsw * 0.8, 22), Math.max(vsh * 0.8, 4)
              )
            })
          }
        })
      }

      // ── Marcadores de anomalias do Monitoramento ───────────────
      if (monitoramentoMarkers?.length > 0) {
        const msw     = Math.max(realRange * 0.9, 35)
        const msh     = Math.max(realRange * 0.15, 6)
        const spreadR = Math.max(realRange * 0.12, 3.5)
        const poleBase= Math.max(realRange * 0.22, 4)  * Math.max(vExag, 1)
        const poleTriH= Math.max(realRange * 0.16, 2.5)* Math.max(vExag, 1)
        const sphereR = Math.max(realRange * 0.022, 1.0)

        monitoramentoMarkers.forEach(marker => {
          const mx    = marker.x
          const mz    = maxZFlip - marker.z
          const baseY = (marker.y - realMinE) * vExag

          const corImovel = marker.numAnomalias === 0 ? '#22c55e'
            : marker.numAnomalias <= 2 ? '#f97316' : '#ef4444'
          const colImovel = new THREE.Color(corImovel)

          // ── Se tem vértices da casa → renderiza edifício 3D ────
          const fvCasa = (marker.verticesCasa || []).map(v => ({
            x: v.x, z: maxZFlip - v.z, y: v.y,
          }))
          const temEdificio = fvCasa.length >= 3

          if (temEdificio) {
            // Centróide do edifício
            const bx = fvCasa.reduce((s, v) => s + v.x, 0) / fvCasa.length
            const bz = fvCasa.reduce((s, v) => s + v.z, 0) / fvCasa.length
            const bBaseY = (fvCasa.reduce((s, v) => s + v.y, 0) / fvCasa.length - realMinE) * vExag

            // Armazena centro do imóvel para o botão "Focar"
            const bSize = Math.max(
              Math.max(...fvCasa.map(v => v.x)) - Math.min(...fvCasa.map(v => v.x)),
              Math.max(...fvCasa.map(v => v.z)) - Math.min(...fvCasa.map(v => v.z)),
              4,
            )
            const wallHEst = marker.alturaCasa
              ? marker.alturaCasa * Math.max(vExag, 1)
              : Math.max(realRange * 0.18, 3) * Math.max(vExag, 1)
            buildingCenterRef.current = { x: bx, y: bBaseY + wallHEst * 0.5, z: bz, size: bSize, wallH: wallHEst }
            setHasBuildingInScene(true)

            const wallH = marker.alturaCasa
              ? marker.alturaCasa * Math.max(vExag, 1)
              : Math.max(realRange * 0.18, 3) * Math.max(vExag, 1)

            // Contorno no terreno
            const edgePts = fvCasa.map(v => new THREE.Vector3(v.x, (v.y - realMinE) * vExag + 0.4, v.z))
            edgePts.push(edgePts[0].clone())
            scene.add(new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(edgePts),
              new THREE.LineBasicMaterial({ color: colImovel, linewidth: 2, transparent: true, opacity: 0.95 })
            ))

            // ExtrudeGeometry com a forma real
            try {
              const shape = new THREE.Shape()
              shape.moveTo(fvCasa[0].x, -fvCasa[0].z)
              fvCasa.slice(1).forEach(v => shape.lineTo(v.x, -v.z))
              shape.closePath()
              const extGeo = new THREE.ExtrudeGeometry(shape, { depth: wallH, bevelEnabled: false })
              extGeo.rotateX(-Math.PI / 2)
              extGeo.translate(0, bBaseY + 0.4, 0)
              scene.add(new THREE.Mesh(extGeo, new THREE.MeshLambertMaterial({
                color: colImovel, transparent: true, opacity: 0.38,
                side: THREE.DoubleSide, depthWrite: false,
              })))

              // Aresta do topo
              const topPts = fvCasa.map(v => new THREE.Vector3(v.x, bBaseY + wallH + 0.4, v.z))
              topPts.push(topPts[0].clone())
              scene.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(topPts),
                new THREE.LineBasicMaterial({ color: colImovel, transparent: true, opacity: 0.85 })
              ))
            } catch (_) {}

            // Label acima do telhado
            const altLabel = marker.alturaCasa ? ` · ${marker.alturaCasa}m` : ''
            const nomeLabel2 = marker.numAnomalias > 0
              ? `${marker.nome.split(' ')[0]}${altLabel} (${marker.numAnomalias})`
              : `${marker.nome.split(' ')[0]}${altLabel}`
            makeTextSprite(scene, nomeLabel2, corImovel,
              bx, bBaseY + wallH + msh * 0.9, bz, msw * 1.5, msh * 1.2)

            // ── Trincas com GPS ou xPct/yPct dentro do edifício ──
            // Bbox do edifício para mapear xPct/yPct
            const bXmin = Math.min(...fvCasa.map(v => v.x)), bXmax = Math.max(...fvCasa.map(v => v.x))
            const bZmin = Math.min(...fvCasa.map(v => v.z)), bZmax = Math.max(...fvCasa.map(v => v.z))

            const allTrincas = [
              // Do cadastro (posições conhecidas)
              ...(marker.trincasCasa || []).map(t => ({ codigo: t.codigo, lat: t.lat, lng: t.lng, xPct: t.xPct, yPct: t.yPct, fonte: 'casa' })),
              // Das fotos/relatórios (apenas código)
              ...(marker.trincas || [])
                .filter(cod => !(marker.trincasCasa || []).find(t => t.codigo === cod))
                .map(cod => ({ codigo: cod, xPct: null, yPct: null, fonte: 'relatorio' })),
            ]

            allTrincas.forEach((t, ti) => {
              let tx, tz, topY = baseY + poleTriH

              if (t.xPct != null && t.yPct != null) {
                // Posição dentro do edifício (planta 2D)
                tx = bXmin + t.xPct * (bXmax - bXmin)
                tz = bZmin + t.yPct * (bZmax - bZmin)
                topY = bBaseY + wallH * 0.5
              } else {
                // Spread radial ao redor do edifício
                const nAll = allTrincas.length
                const ang = ti * (nAll === 1 ? 0 : (2 * Math.PI) / nAll) + Math.PI / 6
                tx = bx + spreadR * Math.cos(ang)
                tz = bz + spreadR * Math.sin(ang)
                topY = bBaseY + poleTriH

                // Linha de conexão do centro ao marcador
                const connL = new THREE.Line(
                  new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(bx, bBaseY + 0.5, bz),
                    new THREE.Vector3(tx, bBaseY + 0.5, tz),
                  ]),
                  new THREE.LineBasicMaterial({ color: new THREE.Color('#f43f5e'), transparent: true, opacity: 0.4 })
                )
                scene.add(connL)
              }

              const corT = '#f43f5e'
              const colT = new THREE.Color(corT)

              // Poste da trinca
              scene.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                  new THREE.Vector3(tx, bBaseY, tz),
                  new THREE.Vector3(tx, topY, tz),
                ]),
                new THREE.LineBasicMaterial({ color: colT, transparent: true, opacity: 0.9 })
              ))

              // Losango no topo
              const coneT = new THREE.Mesh(
                new THREE.ConeGeometry(sphereR * 0.7, sphereR * 1.8, 4),
                new THREE.MeshLambertMaterial({ color: colT, transparent: true, opacity: 0.95 })
              )
              coneT.rotation.y = Math.PI / 4
              coneT.position.set(tx, topY + sphereR * 0.9, tz)
              scene.add(coneT)

              makeTextSprite(scene, t.codigo, corT,
                tx, topY + sphereR * 2.2 + msh * 0.85, tz, msw * 0.72, msh)
            })

          // ── Trincas do Monitoramento (azul) ──────────────────
          if (marker.trincasGeometry?.length > 0) {
            const trR = Math.max(realRange * 0.013, 0.5)
            marker.trincasGeometry.forEach(t => {
              if (t.point) {
                const ptX = t.point.sx
                const ptZ = maxZFlip - t.point.sz
                const ptY = bBaseY + 0.4 + t.point.yFrac * wallH
                const sph = new THREE.Mesh(
                  new THREE.SphereGeometry(trR, 10, 10),
                  new THREE.MeshLambertMaterial({ color: 0x3b82f6, emissive: new THREE.Color(0x1e3a8a) })
                )
                sph.position.set(ptX, ptY, ptZ); scene.add(sph)
                makeTextSprite(scene, t.nome, '#3b82f6',
                  ptX, ptY + trR * 3 + msh * 0.22, ptZ,
                  Math.max(msw * 0.6, 18), Math.max(msh * 0.7, 3.5)
                )
              }
              if (t.linhasTrinca?.length >= 2) {
                const linePts = t.linhasTrinca.map(p => new THREE.Vector3(
                  p.sx, bBaseY + 0.4 + p.yFrac * wallH, maxZFlip - p.sz
                ))
                try {
                  const curve = new THREE.CatmullRomCurve3(linePts)
                  const tube = new THREE.Mesh(
                    new THREE.TubeGeometry(curve, Math.max(linePts.length * 3, 6), trR * 0.45, 6, false),
                    new THREE.MeshLambertMaterial({ color: 0x3b82f6 })
                  )
                  scene.add(tube)
                } catch (_) {
                  scene.add(new THREE.Line(
                    new THREE.BufferGeometry().setFromPoints(linePts),
                    new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.9 })
                  ))
                }
                t.linhasTrinca.forEach(p => {
                  const dot = new THREE.Mesh(
                    new THREE.SphereGeometry(trR * 0.55, 8, 8),
                    new THREE.MeshLambertMaterial({ color: 0x2563eb })
                  )
                  dot.position.set(p.sx, bBaseY + 0.4 + p.yFrac * wallH, maxZFlip - p.sz)
                  scene.add(dot)
                })
              }
            })
          }

          // ── Paredes com anomalia do monitoramento (laranja) ───
          if (marker.paredesAnomalia?.length > 0) {
            marker.paredesAnomalia.forEach(p => {
              const pSX = p.startSx
              const pSZ = maxZFlip - p.startSz
              const pEX = p.endSx
              const pEZ = maxZFlip - p.endSz
              const yBot = bBaseY + 0.4 + p.yBaseFrac * wallH
              const yTop = bBaseY + 0.4 + (p.yBaseFrac + p.wallFrac) * wallH

              const pos = new Float32Array([
                pSX, yBot, pSZ,
                pEX, yBot, pEZ,
                pEX, yTop, pEZ,
                pSX, yTop, pSZ,
              ])
              const wGeo = new THREE.BufferGeometry()
              wGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
              wGeo.setIndex([0, 1, 2, 0, 2, 3])
              wGeo.computeVertexNormals()
              scene.add(new THREE.Mesh(wGeo, new THREE.MeshLambertMaterial({
                color: 0xf97316, transparent: true, opacity: 0.65,
                side: THREE.DoubleSide, depthWrite: false,
              })))
              scene.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                  new THREE.Vector3(pSX, yBot, pSZ),
                  new THREE.Vector3(pEX, yBot, pEZ),
                  new THREE.Vector3(pEX, yTop, pEZ),
                  new THREE.Vector3(pSX, yTop, pSZ),
                  new THREE.Vector3(pSX, yBot, pSZ),
                ]),
                new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.95 })
              ))
              const midX = (pSX + pEX) / 2
              const midZ = (pSZ + pEZ) / 2
              makeTextSprite(scene, p.nome, '#f97316',
                midX, yTop + msh * 0.25, midZ,
                Math.max(msw * 0.65, 20), Math.max(msh * 0.75, 4)
              )
            })
          }

          } else {
            // ── Sem edifício: pin + esfera + anel (comportamento anterior) ──
            const poleImovel = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(mx, 0, mz),
                new THREE.Vector3(mx, baseY + poleBase, mz),
              ]),
              new THREE.LineDashedMaterial({
                color: colImovel,
                dashSize: Math.max(poleBase * 0.14, 0.4),
                gapSize:  Math.max(poleBase * 0.07, 0.2),
                transparent: true, opacity: 0.7,
              })
            )
            poleImovel.computeLineDistances()
            scene.add(poleImovel)

            const sphereIm = new THREE.Mesh(
              new THREE.SphereGeometry(sphereR * 1.4, 14, 12),
              new THREE.MeshLambertMaterial({ color: colImovel, transparent: true, opacity: 0.88 })
            )
            sphereIm.position.set(mx, baseY + poleBase, mz)
            scene.add(sphereIm)

            const haloIm = new THREE.Mesh(
              new THREE.TorusGeometry(sphereR * 2.4, sphereR * 0.22, 8, 28),
              new THREE.MeshBasicMaterial({ color: colImovel, transparent: true, opacity: 0.45 })
            )
            haloIm.rotation.x = Math.PI / 2
            haloIm.position.set(mx, baseY + poleBase, mz)
            scene.add(haloIm)

            const nomeLabel = marker.numAnomalias > 0
              ? `${marker.nome.split(' ')[0]} (${marker.numAnomalias})`
              : `${marker.nome.split(' ')[0]}`
            makeTextSprite(scene, nomeLabel, corImovel,
              mx, baseY + poleBase + msh * 1.1, mz, msw * 1.4, msh * 1.2)

            // Trincas radiais
            const trincas = marker.trincas || []
            const nT = trincas.length
            const angStep = nT === 1 ? 0 : (2 * Math.PI) / nT
            trincas.forEach((codigo, ti) => {
              const angle = ti * angStep + Math.PI / 6
              const tx = mx + spreadR * Math.cos(angle)
              const tz2 = mz + spreadR * Math.sin(angle)
              const topY = baseY + poleTriH
              const corT = '#f43f5e'
              const colT = new THREE.Color(corT)
              scene.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                  new THREE.Vector3(mx, baseY + 0.5, mz),
                  new THREE.Vector3(tx, baseY + 0.5, tz2),
                ]),
                new THREE.LineBasicMaterial({ color: colT, transparent: true, opacity: 0.45 })
              ))
              scene.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                  new THREE.Vector3(tx, baseY, tz2),
                  new THREE.Vector3(tx, topY, tz2),
                ]),
                new THREE.LineBasicMaterial({ color: colT, transparent: true, opacity: 0.9 })
              ))
              const coneT = new THREE.Mesh(
                new THREE.ConeGeometry(sphereR * 0.7, sphereR * 1.8, 4),
                new THREE.MeshLambertMaterial({ color: colT, transparent: true, opacity: 0.95 })
              )
              coneT.rotation.y = Math.PI / 4
              coneT.position.set(tx, topY + sphereR * 0.9, tz2)
              scene.add(coneT)
              makeTextSprite(scene, codigo, corT,
                tx, topY + sphereR * 2.2 + msh * 0.85, tz2, msw * 0.72, msh)
            })
          }
        })
      }

    // ── Modo Medir ─────────────────────────────────────────────
    } else if (mode === 'medir' && perfil?.length > 1) {
      const COLS = 24, N = perfil.length
      const elevs = perfil.map(p => p.elev)
      realMinE = elevs.reduce((m, v) => Math.min(m, v), Infinity)
      realMaxE = elevs.reduce((m, v) => Math.max(m, v), -Infinity)
      realRange = realMaxE - realMinE
      setInfo({ minE: realMinE, maxE: realMaxE, range: realRange, interval: calcContourInterval(realRange) })

      const totalDist = perfil[N-1].dist
      const ribbonW   = Math.max(totalDist * 0.12, 10)
      const rx = [], ry = [], rz = []
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < COLS; j++) {
          rx.push(perfil[i].dist)
          ry.push(perfil[i].elev)
          rz.push((j / (COLS-1)) * ribbonW)
        }
      }
      geo = buildRibbonMesh(rx, ry, rz, realMinE, realMaxE, COLS, vExag)

      // ── Zonas de vistorias no ribbon 3D ───────────────────────
      if (vistoriaZonesMedir?.length > 0) {
        const scaledRange = Math.max(realRange * vExag, 1)
        // sw/sh locais para labels nesta fase (antes do bounding box)
        const lsw = Math.max(totalDist * 0.22, 35)
        const lsh = Math.max(ribbonW * 0.30, 5)

        // Helper: elevação relativa (Y na cena) para uma dada distância
        const getRelY = (d) => {
          const t   = totalDist > 0 ? d / totalDist : 0
          const idx = Math.max(0, Math.min(N - 1, Math.round(t * (N - 1))))
          return ((perfil[idx]?.elev ?? realMinE) - realMinE) * vExag
        }

        vistoriaZonesMedir.forEach(zone => {
          const col = new THREE.Color(zone.cor)
          const x0  = zone.d0
          const x1  = zone.d1
          const pad = ribbonW * 0.08

          // ── Planos verticais de entrada e saída ──────────────
          for (const xPos of [x0, x1]) {
            const planePts = [
              new THREE.Vector3(xPos, -0.5,             -pad),
              new THREE.Vector3(xPos, -0.5,              ribbonW + pad),
              new THREE.Vector3(xPos, scaledRange + 1.5, ribbonW + pad),
              new THREE.Vector3(xPos, scaledRange + 1.5, -pad),
              new THREE.Vector3(xPos, -0.5,             -pad),
            ]
            scene.add(new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(planePts),
              new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 })
            ))
            // Linha horizontal de chão indicando a borda
            scene.add(new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(xPos, -0.5, -pad),
                new THREE.Vector3(xPos, -0.5, ribbonW + pad),
              ]),
              new THREE.LineDashedMaterial({
                color: col, dashSize: ribbonW * 0.06, gapSize: ribbonW * 0.04,
                transparent: true, opacity: 0.7,
              })
            ))
          }

          // ── Faixa semi-transparente entre x0 e x1 ───────────
          const pH = scaledRange + 1.5
          const panelVerts = new Float32Array([
            x0, -0.5, -pad,       x1, -0.5, -pad,       x1, pH, -pad,
            x0, -0.5, -pad,       x1, pH,   -pad,        x0, pH, -pad,
            x0, -0.5, ribbonW+pad, x1, -0.5, ribbonW+pad, x1, pH, ribbonW+pad,
            x0, -0.5, ribbonW+pad, x1, pH,   ribbonW+pad, x0, pH, ribbonW+pad,
            // topo
            x0, pH, -pad,         x1, pH, -pad,         x1, pH, ribbonW+pad,
            x0, pH, -pad,         x1, pH, ribbonW+pad,  x0, pH, ribbonW+pad,
          ])
          const panelGeo = new THREE.BufferGeometry()
          panelGeo.setAttribute('position', new THREE.BufferAttribute(panelVerts, 3))
          scene.add(new THREE.Mesh(panelGeo, new THREE.MeshBasicMaterial({
            color: col, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false,
          })))

          // ── Contorno inferior sobre o ribbon (ao nível do terreno) ──
          const midRibbonZ = ribbonW / 2
          const steps = 24
          const groundPts = []
          for (let si = 0; si <= steps; si++) {
            const xp = x0 + (x1 - x0) * (si / steps)
            groundPts.push(new THREE.Vector3(xp, getRelY(xp) + 0.8, midRibbonZ))
          }
          scene.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(groundPts),
            new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.95, linewidth: 2 })
          ))

          // ── Label acima da zona ──────────────────────────────
          const midX    = (x0 + x1) / 2
          const topElevY = getRelY(midX) + scaledRange * 0.18 + lsh * 3
          const labelY  = Math.max(topElevY, scaledRange * 0.55)
          makeTextSprite(scene,
            `${zone.risco} · ${zone.nome}`,
            zone.cor, midX, labelY, midRibbonZ, lsw, lsh
          )
        })
      }
    }

    if (geo) {
      const mat  = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true })
      const terrainMesh = new THREE.Mesh(geo, mat)
      scene.add(terrainMesh)
      terrainMeshRef.current = terrainMesh

      if (mode !== 'poligono') {
        scene.add(new THREE.Mesh(geo.clone(),
          new THREE.MeshBasicMaterial({ color: 0x1e3a5f, wireframe: true, transparent: true, opacity: 0.06 })))
      }

      geo.computeBoundingBox()
      const box    = geo.boundingBox
      const center = new THREE.Vector3(); box.getCenter(center)
      const size   = new THREE.Vector3(); box.getSize(size)

      // ── Câmera posicionada lateralmente para evidenciar o relevo ──
      const horizMax = Math.max(size.x, size.z)
      const vertMax  = Math.max(size.y, 1)
      if (mode === 'poligono') {
        // Câmera ao noroeste do terreno (Z invertido na geometria = norte fica no fundo/topo)
        // Vetor "direita" aponta para leste (+X) → leste aparece à DIREITA como no mapa 2D
        camera.position.set(
          center.x - horizMax * 0.7,
          center.y + vertMax  * 2.5 + horizMax * 0.4,
          center.z + horizMax * 1.5,
        )
      } else {
        camera.position.set(
          center.x - horizMax * 0.7,
          center.y + vertMax  * 2.5 + horizMax * 0.4,
          center.z + horizMax * 1.5,
        )
      }
      controls.target.copy(center)

      // ── Sprites: escala relativa ao maior lado horizontal ─────
      const sw = horizMax * 0.13
      const sh = horizMax * 0.032

      // ── Grade de chão ─────────────────────────────────────────
      const gridSize = horizMax * 1.9
      const grid     = new THREE.GridHelper(gridSize, gridDivisions, 0x1e3a5f, 0x0f1929)
      grid.position.set(center.x, box.min.y - 0.3, center.z)
      scene.add(grid)

      // ── CURVAS DE NÍVEL (exageradas como o terreno) ───────────
      const interval = (contourInterval && contourInterval > 0) ? contourInterval : calcContourInterval(realRange)
      const startE   = Math.ceil(realMinE / interval) * interval

      for (let e = startE; e <= realMaxE + 0.001; e += interval) {
        const relY = (e - realMinE) * vExag            // Y exagerado na cena
        const t    = realRange > 0 ? (e - realMinE) / realRange : 0.5
        const col  = elevToColor(Math.min(t, 1))
        const hex  = '#' + col.getHexString()

        const pts = [
          new THREE.Vector3(box.min.x, relY, box.min.z),
          new THREE.Vector3(box.max.x, relY, box.min.z),
          new THREE.Vector3(box.max.x, relY, box.max.z),
          new THREE.Vector3(box.min.x, relY, box.max.z),
          new THREE.Vector3(box.min.x, relY, box.min.z),
        ]
        scene.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.55 })
        ))

        makeTextSprite(scene, `${Math.round(e)} m`, hex,
          box.min.x - sw * 0.58, relY, box.min.z, sw, sh)
        makeTextSprite(scene, `${Math.round(e)} m`, hex,
          box.max.x + sw * 0.58, relY, box.max.z, sw, sh)
      }

      // ── BARRA DE DESNÍVEL (Δh exagerado) ──────────────────────
      const scaledRange = realRange * vExag
      const barX   = box.max.x + size.x * 0.07
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(barX, 0,           box.min.z),
          new THREE.Vector3(barX, scaledRange, box.min.z),
        ]),
        new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.75 })
      ))
      makeTextSprite(scene, `Δh = ${Math.round(realRange)} m`, '#38bdf8',
        barX, scaledRange / 2, box.min.z, sw, sh)

      // ── LABELS MIN/MAX ────────────────────────────────────────
      if (mode === 'poligono') {
        makeTextSprite(scene, `min: ${Math.round(realMinE)} m`, '#22c55e',
          center.x, -sh * 0.9, center.z, sw * 1.25, sh)
        makeTextSprite(scene, `max: ${Math.round(realMaxE)} m`, '#ef4444',
          center.x, scaledRange + sh * 0.55, center.z, sw * 1.25, sh)
      }

      // ── PICO DESTACADO quando há relevo significativo ─────────
      if (realRange >= 5) {
        if (mode === 'poligono' && gridData?.points?.length > 0) {
          const peakPt = gridData.points.reduce((a, b) => b.y > a.y ? b : a)
          addPeakMarker(scene, peakPt.x, peakPt.z, (peakPt.y - realMinE) * vExag, peakPt.y, realRange, sw, sh)
        } else if (mode === 'medir' && perfil?.length > 1) {
          const peakPt  = perfil.reduce((a, b) => b.elev > a.elev ? b : a)
          const ribW    = Math.max(perfil[perfil.length-1].dist * 0.12, 10)
          addPeakMarker(scene, peakPt.dist, ribW / 2, (peakPt.elev - realMinE) * vExag, peakPt.elev, realRange, sw, sh)
        }
      }
    }

    controls.update()

    scene.add(new THREE.AmbientLight(0x9ab4d8, 0.95))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun._isSun = true
    sun.position.set(500, 800, 400); scene.add(sun)
    const fillLight = new THREE.DirectionalLight(0x6699ff, 0.35)
    fillLight.position.set(-300, 200, -300)
    scene.add(fillLight)

    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    const _tmpSz = new THREE.Vector2()
    const tanHalfFov = Math.tan(camera.fov * Math.PI / 180 / 2)
    let animId
    const animate = () => {
      animId = requestAnimationFrame(animate)
      controls.update()
      // Mantém labels com tamanho fixo em pixels (não crescem ao aproximar)
      renderer.getSize(_tmpSz)
      const halfH = Math.max(_tmpSz.y / 2, 1)
      scene.traverse(obj => {
        if (obj.isSprite && obj.userData.isLabel) {
          const dist = Math.max(camera.position.distanceTo(obj.position), 0.01)
          const factor = dist * tanHalfFov / halfH
          obj.scale.set(
            obj.userData.pixW * factor,
            obj.userData.pixH * factor,
            1
          )
        }
      })
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      controls.dispose(); renderer.dispose()
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement)
    }
  }, [mode, perfil, gridData, vExag])

  function handleZoom(factor) {
    const cam  = cameraRef.current
    const ctrl = controlsRef.current
    if (!cam || !ctrl) return
    const startDir = cam.position.clone().sub(ctrl.target)
    const endDir   = startDir.clone().multiplyScalar(factor)
    const minD = ctrl.minDistance || 0.1
    const maxD = ctrl.maxDistance || 500000
    const endLen = endDir.length()
    if (endLen < minD) endDir.setLength(minD)
    if (endLen > maxD) endDir.setLength(maxD)
    const startPos = cam.position.clone()
    const endPos   = ctrl.target.clone().add(endDir)
    let t = 0
    function step() {
      t = Math.min(t + 0.14, 1)
      const e = 1 - Math.pow(1 - t, 3)
      cam.position.lerpVectors(startPos, endPos, e)
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  function handleFocusBuilding() {
    const bc   = buildingCenterRef.current
    const cam  = cameraRef.current
    const ctrl = controlsRef.current
    if (!bc || !cam || !ctrl) return
    const target = new THREE.Vector3(bc.x, bc.y, bc.z)
    const dist   = Math.max(bc.size * 2.8, bc.wallH * 2.5, 12)
    const endCam = new THREE.Vector3(
      bc.x - dist * 0.55,
      bc.y + dist * 0.85,
      bc.z + dist * 0.75,
    )
    const startCam    = cam.position.clone()
    const startTarget = ctrl.target.clone()
    ctrl.enabled = false
    let t = 0
    function step() {
      t = Math.min(t + 0.05, 1)
      const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
      cam.position.lerpVectors(startCam, endCam, e)
      ctrl.target.lerpVectors(startTarget, target, e)
      ctrl.update()
      if (t < 1) { requestAnimationFrame(step) }
      else { ctrl.enabled = true; ctrl.update() }
    }
    requestAnimationFrame(step)
  }

  // ── Toggle textura de satélite ─────────────────────────────────────
  useEffect(() => {
    const mesh = terrainMeshRef.current
    if (!mesh) return

    if (!satMode) {
      // Volta para cores de altitude
      mesh.material.map = null
      mesh.material.vertexColors = true
      mesh.material.needsUpdate = true
      return
    }

    const bbox = gridInternalRef.current?.bbox
    if (!bbox) return

    // Se já temos textura carregada, apenas aplica
    if (satTextureRef.current) {
      mesh.material.map = satTextureRef.current
      mesh.material.vertexColors = false
      mesh.material.color.set(0xffffff)
      mesh.material.needsUpdate = true
      return
    }

    setSatLoading(true)
    setSatError(false)

    buildSatelliteTexture(bbox).then(result => {
      setSatLoading(false)
      if (!result) {
        setSatError(true)
        setSatMode(false)
        return
      }
      const { texture, canvas, totalLngMin, totalLngMax, totalLatMin, totalLatMax } = result
      satTextureRef.current = texture
      satCanvasRef.current  = canvas  // guarda canvas bruto para análise IA

      // Recalcula UVs do geo com o mapeamento real de lat/lng
      const gd = gridInternalRef.current
      if (gd?.points?.length) {
        const { points, bbox: bboxGd } = gd
        const maxX = points.reduce((m, p) => Math.max(m, p.x), -Infinity)
        const maxZ = points.reduce((m, p) => Math.max(m, p.z), -Infinity)
        const [bboxMinLng, bboxMinLat, bboxMaxLng, bboxMaxLat] = bboxGd
        const lngRange = totalLngMax - totalLngMin
        const latRange = totalLatMax - totalLatMin
        const uvsArr = new Float32Array(points.length * 2)
        points.forEach((p, i) => {
          const lng = bboxMinLng + (p.x / maxX) * (bboxMaxLng - bboxMinLng)
          const lat = bboxMinLat + (p.z / maxZ) * (bboxMaxLat - bboxMinLat)
          uvsArr[i*2]   = lngRange > 0 ? (lng - totalLngMin) / lngRange : 0.5
          uvsArr[i*2+1] = latRange > 0 ? (lat - totalLatMin) / latRange : 0.5
        })
        mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvsArr, 2))
      }

      const m = terrainMeshRef.current
      if (!m) return
      m.material.map = texture
      m.material.vertexColors = false
      m.material.color.set(0xffffff)
      m.material.needsUpdate = true
    }).catch(() => {
      setSatLoading(false)
      setSatError(true)
      setSatMode(false)
    })
  }, [satMode])

  // ── Modo IA: análise de satélite → normal map + destaque de cortes ────────
  useEffect(() => {
    const mesh = terrainMeshRef.current
    if (!mesh) return

    if (!aiMode) {
      // Desativa IA — volta para material Lambert padrão com vertexColors
      const stdMat = mesh.material
      if (stdMat.isStandard || stdMat.normalMap) {
        // Troca de volta para Lambert
        const newMat = new THREE.MeshLambertMaterial({
          vertexColors: !satMode,
          side: THREE.DoubleSide,
          flatShading: true,
        })
        if (satMode && satTextureRef.current) {
          newMat.map = satTextureRef.current
          newMat.vertexColors = false
          newMat.color.set(0xffffff)
        }
        mesh.material.dispose()
        mesh.material = newMat
      }
      return
    }

    // Precisa de satélite carregado primeiro
    if (!satCanvasRef.current) {
      // Sinaliza para o usuário que precisa ativar satélite antes
      setAiMode(false)
      return
    }

    setAiLoading(true)

    // Roda em microtask para não bloquear UI
    setTimeout(() => {
      try {
        const maps = buildNormalMapFromSatellite(satCanvasRef.current, 5.0)
        if (!maps) { setAiLoading(false); setAiMode(false); return }

        const { normalMap, highlightMap } = maps
        normalMapRef.current = normalMap

        // Textura composta: satélite + overlay de cortes
        const compTex = buildCompositeTexture(satCanvasRef.current, highlightMap)
        aiCompTexRef.current = compTex
        highlightMap.dispose()

        // Recalcula normais suaves (necessário para normal map funcionar)
        mesh.geometry.computeVertexNormals()

        // Troca para MeshStandardMaterial (suporta normalMap)
        const stdMat = new THREE.MeshStandardMaterial({
          map:         compTex,
          normalMap:   normalMap,
          normalScale: new THREE.Vector2(3.5, 3.5),
          roughness:   0.88,
          metalness:   0.0,
          side:        THREE.DoubleSide,
          vertexColors: false,
        })
        stdMat.color.set(0xffffff)
        mesh.material.dispose()
        mesh.material = stdMat

        // Melhora iluminação para PBR
        const scene = sceneRef.current
        if (scene) {
          scene.traverse(obj => {
            if (obj.isDirectionalLight && obj._isSun) obj.intensity = 1.8
          })
        }

        setAiLoading(false)
      } catch {
        setAiLoading(false)
        setAiMode(false)
      }
    }, 20)
  }, [aiMode])

  // ── Toggle visibilidade das curvas de nível ───────────────────────
  useEffect(() => {
    if (contourGroupRef.current) contourGroupRef.current.visible = showContours
  }, [showContours])

  // ── OrbitControls: desabilita ao selecionar ponto de massa ───────
  useEffect(() => {
    const ctrl = controlsRef.current
    if (!ctrl) return
    ctrl.enabled = massMovePhase !== 'selecting'
    return () => { if (controlsRef.current) controlsRef.current.enabled = true }
  }, [massMovePhase])

  // ── Click handler: seleção do ponto central de massa ─────────────
  useEffect(() => {
    if (massMovePhase !== 'selecting') return
    const canvas = rendererRef.current?.domElement
    if (!canvas) return

    function onCanvasClick(e) {
      if (massMovePhaseRef.current !== 'selecting') return
      const rect   = canvas.getBoundingClientRect()
      const mouse  = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        -((e.clientY - rect.top)  / rect.height) * 2 + 1,
      )
      const cam  = cameraRef.current
      const mesh = terrainMeshRef.current
      if (!cam || !mesh) return
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(mouse, cam)
      const hits = raycaster.intersectObject(mesh)
      if (!hits.length) return
      const pt = hits[0].point
      const gd = gridInternalRef.current
      setMassMoveCenter({
        sx: pt.x, sy: pt.y, sz: pt.z,
        gx: pt.x,
        gz: pt.z,
      })
      massMovePhaseRef.current = 'done'
      setMassMovePhase('done')
    }

    canvas.addEventListener('click', onCanvasClick)
    return () => canvas.removeEventListener('click', onCanvasClick)
  }, [massMovePhase])

  // ── Visualização 3D da movimentação de massa ──────────────────────
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.children.filter(c => c.userData.isMassMove).forEach(c => scene.remove(c))
    if (!massMoveCenter) return

    const { sx, sy, sz } = massMoveCenter
    const radius = massMoveRadius
    const gd     = gridInternalRef.current
    if (!gd || !gd.points?.length) return

    const { points, minE, maxXPoly } = gd

    // Pré-computa posições cena para cada ponto da grade
    const scenePts = points.map(p => ({
      sx:   p.x,
      sz:   p.z,
      elev: p.y,
    }))

    // Gradiente em coordenadas de cena via diferenças finitas
    function gradAt(qsx, qsz) {
      const near = scenePts
        .map(p => ({ ...p, d: Math.hypot(p.sx - qsx, p.sz - qsz) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 16)
      if (near.length < 3) return null
      let left = null, right = null, fwd = null, bck = null
      let dL = Infinity, dR = Infinity, dF = Infinity, dB = Infinity
      for (const p of near) {
        if (p.sx < qsx - 0.1 && p.d < dL) { dL = p.d; left  = p }
        if (p.sx > qsx + 0.1 && p.d < dR) { dR = p.d; right = p }
        if (p.sz < qsz - 0.1 && p.d < dF) { dF = p.d; fwd   = p }
        if (p.sz > qsz + 0.1 && p.d < dB) { dB = p.d; bck   = p }
      }
      const c = near[0]
      let gx = 0, gz = 0
      if      (left && right) gx = (right.elev - left.elev)  / (right.sx - left.sx  + 0.001)
      else if (right)         gx = (right.elev - c.elev)     / (right.sx - c.sx     + 0.001)
      else if (left)          gx = (c.elev     - left.elev)  / (c.sx     - left.sx  + 0.001)
      if      (fwd && bck)    gz = (bck.elev   - fwd.elev)   / (bck.sz   - fwd.sz   + 0.001)
      else if (bck)           gz = (bck.elev   - c.elev)     / (bck.sz   - c.sz     + 0.001)
      else if (fwd)           gz = (c.elev     - fwd.elev)   / (c.sz     - fwd.sz   + 0.001)
      const mag = Math.sqrt(gx * gx + gz * gz)
      return { gx, gz, mag, nearElev: c.elev }
    }

    function elevAt(qsx, qsz) {
      const best = scenePts.reduce((b, p) => {
        const d = Math.hypot(p.sx - qsx, p.sz - qsz); return d < b.d ? { d, elev: p.elev } : b
      }, { d: Infinity, elev: minE })
      return (best.elev - minE) * vExag + 0.3
    }

    // 1. Esfera central
    const sphereR = Math.max(radius * 0.045, 1.2)
    const sphere  = new THREE.Mesh(
      new THREE.SphereGeometry(sphereR, 16, 16),
      new THREE.MeshLambertMaterial({ color: 0xff2200, emissive: new THREE.Color(0x440000) }),
    )
    const cyCenter = elevAt(sx, sz)
    sphere.position.set(sx, cyCenter, sz); sphere.userData.isMassMove = true; scene.add(sphere)

    // 2. Anel de raio
    const ringPts = []
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2
      ringPts.push(new THREE.Vector3(sx + radius * Math.cos(a), cyCenter + 0.5, sz + radius * Math.sin(a)))
    }
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.85 }),
    )
    ring.userData.isMassMove = true; scene.add(ring)

    // 3. Setas de fluxo (grade dentro do raio)
    const step   = Math.max(radius / 4, 3)
    const localR = step * 2.5

    for (let dx = -radius; dx <= radius; dx += step) {
      for (let dz = -radius; dz <= radius; dz += step) {
        if (Math.hypot(dx, dz) > radius) continue
        const psx = sx + dx, psz = sz + dz
        const grad = gradAt(psx, psz)
        if (!grad || grad.mag < 0.0002) continue

        const flowX = -grad.gx / grad.mag
        const flowZ = -grad.gz / grad.mag
        const psy   = elevAt(psx, psz)
        const arrowLen = Math.min(step * 0.75, radius * 0.28) * Math.min(1 + grad.mag * 3, 2)
        if (arrowLen < 0.2) continue

        const slopePct = grad.mag * 100
        const cor = slopePct > 50 ? 0xef4444 : slopePct > 25 ? 0xf97316 : slopePct > 10 ? 0xeab308 : 0x4ade80

        const arrowStart = new THREE.Vector3(psx, psy, psz)
        const arrowEnd   = new THREE.Vector3(psx + flowX * arrowLen, psy, psz + flowZ * arrowLen)
        const aLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([arrowStart, arrowEnd]),
          new THREE.LineBasicMaterial({ color: cor, transparent: true, opacity: 0.88 }),
        )
        aLine.userData.isMassMove = true; scene.add(aLine)

        const coneH = arrowLen * 0.38, coneR = coneH * 0.30
        const cone  = new THREE.Mesh(
          new THREE.ConeGeometry(coneR, coneH, 6),
          new THREE.MeshLambertMaterial({ color: cor, transparent: true, opacity: 0.92 }),
        )
        cone.position.copy(arrowEnd)
        const dir3 = new THREE.Vector3(flowX, 0, flowZ).normalize()
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir3)
        cone.userData.isMassMove = true; scene.add(cone)
      }
    }

    // 4. Seta principal no centro (mais grossa, com label)
    const mainGrad = gradAt(sx, sz)
    if (mainGrad && mainGrad.mag > 0.0001) {
      const fx = -mainGrad.gx / mainGrad.mag
      const fz = -mainGrad.gz / mainGrad.mag
      const mainLen = radius * 0.5

      const mLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(sx, cyCenter, sz),
          new THREE.Vector3(sx + fx * mainLen, cyCenter, sz + fz * mainLen),
        ]),
        new THREE.LineBasicMaterial({ color: 0xff4400 }),
      )
      mLine.userData.isMassMove = true; scene.add(mLine)

      const mCone = new THREE.Mesh(
        new THREE.ConeGeometry(radius * 0.07, radius * 0.16, 8),
        new THREE.MeshLambertMaterial({ color: 0xff4400 }),
      )
      mCone.position.set(sx + fx * mainLen, sy, sz + fz * mainLen)
      mCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(fx, 0, fz).normalize())
      mCone.userData.isMassMove = true; scene.add(mCone)

      const slopePct = mainGrad.mag * 100
      const classif  = slopePct > 60 ? 'Alto' : slopePct > 30 ? 'Médio' : slopePct > 10 ? 'Baixo' : 'Mínimo'
      makeTextSprite(scene,
        `▼ ${slopePct.toFixed(0)}% · Risco ${classif}`,
        slopePct > 30 ? '#ef4444' : '#f97316',
        sx + fx * mainLen * 1.25, sy + radius * 0.09, sz + fz * mainLen * 1.25,
        radius * 0.55, radius * 0.11,
      )
    }
  }, [massMoveCenter, massMoveRadius])

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
      zIndex: 9999, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '92vw', maxWidth: 1200, height: '84vh', background: '#0d1117',
        borderRadius: 16, overflow: 'hidden', position: 'relative',
        border: '1px solid #1e3a5f', boxShadow: '0 30px 80px rgba(0,0,0,0.8)',
      }}>

        {/* Cabeçalho */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          background: 'linear-gradient(180deg,rgba(13,17,23,0.97) 0%,transparent 100%)',
          padding: '14px 18px', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', pointerEvents: 'none',
        }}>
          <div style={{ color: '#f0f9ff', fontWeight: 700, fontSize: 16 }}>
            🏔️ {mode === 'poligono' ? 'Relevo 3D do Polígono' : 'Perfil 3D do Terreno'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#475569' }}>
              Arraste → rotacionar &nbsp;·&nbsp; Scroll → zoom no cursor &nbsp;·&nbsp; Botão dir. → mover câmera
            </span>
          </div>
        </div>

        {/* Botão Movimentação de Massa (apenas modo polígono) */}
        {mode === 'poligono' && gridData && (
          <button
            onClick={() => {
              const next = massMovePhase === 'idle' ? 'selecting' : 'idle'
              massMovePhaseRef.current = next
              setMassMovePhase(next)
              if (next === 'idle') setMassMoveCenter(null)
            }}
            style={{
              position: 'absolute', top: 12, left: 14, zIndex: 20,
              background: massMovePhase !== 'idle' ? '#ea580c' : '#1e293b',
              border: massMovePhase !== 'idle' ? '1.5px solid #f97316' : '1px solid #334155',
              color: '#e2e8f0',
              borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
            🌊 {massMovePhase !== 'idle' ? 'Cancelar Análise' : 'Movimentação de Massa'}
          </button>
        )}

        {/* Instrução: selecionar ponto */}
        {massMovePhase === 'selecting' && (
          <div style={{
            position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)', zIndex: 20,
            background: 'rgba(234,88,12,0.92)', borderRadius: 10, padding: '8px 20px',
            color: '#fff', fontWeight: 700, fontSize: 13, pointerEvents: 'none',
            boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
          }}>
            🎯 Clique no terreno para marcar o ponto central da análise
          </div>
        )}

        {/* Controles: raio após ponto selecionado */}
        {massMovePhase === 'done' && massMoveCenter && (
          <div style={{
            position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)', zIndex: 20,
            background: 'rgba(15,23,42,0.95)', border: '1px solid #f97316',
            borderRadius: 10, padding: '10px 18px',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
          }}>
            <span style={{ color: '#f97316', fontWeight: 700, fontSize: 12 }}>🌊 Raio de análise:</span>
            <input type='range' min='10' max='500' step='5' value={massMoveRadius}
              onChange={e => {
                const v = parseInt(e.target.value)
                massMoveRadiusRef.current = v; setMassMoveRadius(v)
              }}
              style={{ width: 120, accentColor: '#f97316' }}
            />
            <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13, minWidth: 42 }}>{massMoveRadius} m</span>
            <button onClick={() => { setMassMoveCenter(null); massMovePhaseRef.current = 'idle'; setMassMovePhase('idle') }}
              style={{ background: '#334155', border: '1px solid #475569', color: '#94a3b8', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
              Limpar
            </button>
          </div>
        )}

        {/* Botões de vista — Satélite e IA (apenas modo polígono) */}
        {mode === 'poligono' && gridData?.bbox && (
          <div style={{
            position: 'absolute', top: 12, right: 90, zIndex: 20,
            display: 'flex', gap: 6,
          }}>
            {/* Botão Curvas de Nível */}
            <button
              onClick={() => setShowContours(s => !s)}
              title="Mostrar/ocultar curvas de nível COP30"
              style={{
                background: showContours ? '#0c3054' : '#1e293b',
                border: showContours ? '1.5px solid #60a5fa' : '1px solid #334155',
                color: showContours ? '#93c5fd' : '#94a3b8',
                borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
              }}>
              📏 {showContours ? 'Curvas ✓' : 'Curvas'}
            </button>

            {/* Botão Satélite */}
            <button
              onClick={() => {
                if (satLoading || aiLoading) return
                const next = !satMode
                setSatMode(next)
                if (!next) setAiMode(false)
              }}
              style={{
                background: satMode ? '#0d4f2e' : '#1e293b',
                border: satMode ? '1.5px solid #22c55e' : '1px solid #334155',
                color: satMode ? '#4ade80' : '#e2e8f0',
                borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700,
                cursor: (satLoading || aiLoading) ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                opacity: satLoading ? 0.7 : 1,
              }}>
              🛰️ {satLoading ? 'Carregando…' : satMode ? 'Satélite ✓' : 'Satélite'}
            </button>

          </div>
        )}

        {satError && (
          <div style={{
            position: 'absolute', top: 50, right: 14, zIndex: 20,
            background: 'rgba(239,68,68,0.92)', borderRadius: 8, padding: '5px 12px',
            color: '#fff', fontSize: 11, fontWeight: 600,
          }}>
            Satélite indisponível (sem conexão)
          </div>
        )}

        <button onClick={onClose} style={{
          position: 'absolute', top: 12, right: 14, zIndex: 20,
          background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0',
          borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>✕ Fechar</button>

        {/* Painel de info */}
        {mode === 'poligono' && gridData && info && (
          <div style={{
            position: 'absolute', bottom: 16, left: 16, zIndex: 10,
            background: 'rgba(13,17,23,0.92)', borderRadius: 10, padding: '10px 14px',
            border: '1px solid #1e3a5f', fontSize: 11, color: '#64748b', minWidth: 155,
          }}>
            <div style={{ color: '#a78bfa', fontWeight: 700, marginBottom: 6, fontSize: 12 }}>
              📐 Grade {gridData.rows} × {gridData.cols}
            </div>
            <div>Alt. mín: <b style={{ color: '#22c55e' }}>{Math.round(info.minE)} m</b></div>
            <div>Alt. máx: <b style={{ color: '#ef4444' }}>{Math.round(info.maxE)} m</b></div>
            <div>Desnível: <b style={{ color: '#38bdf8' }}>{Math.round(info.range)} m</b></div>
            {area != null && (
              <div>Área: <b style={{ color: '#fbbf24' }}>{area >= 10000 ? `${(area/10000).toFixed(2)} ha` : `${area} m²`}</b></div>
            )}
            <div style={{ marginTop: 6, borderTop: '1px solid #1e3a5f', paddingTop: 6 }}>
              <div style={{ color: '#64748b', fontSize: 10 }}>
                Intervalo curvas: <b style={{ color: '#7dd3fc' }}>{info.interval} m</b>
              </div>
            </div>
          </div>
        )}


        {/* Painel de lados do polígono */}
        {mode === 'poligono' && lateralDists?.length > 0 && (
          <div style={{
            position: 'absolute', bottom: 16, right: 16, zIndex: 10,
            background: 'rgba(13,17,23,0.92)', borderRadius: 10,
            border: '1px solid #1e3a5f', fontSize: 11, color: '#64748b',
            maxHeight: '60vh', overflowY: 'auto',
          }}>
            <div style={{
              padding: '10px 14px 6px', borderBottom: '1px solid #1e3a5f',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: 12 }}>📏 Lados do Polígono</span>
              <button onClick={() => setShowDists(s => !s)}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 11 }}>
                {showDists ? '▲ ocultar' : '▼ expandir'}
              </button>
            </div>
            {showDists && (
              <div style={{ padding: '8px 14px' }}>
                {lateralDists.map((d, i) => {
                  const len = d.dist >= 1000 ? `${(d.dist/1000).toFixed(2)} km` : `${d.dist} m`
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '5px 0', borderBottom: '1px solid #0f172a',
                    }}>
                      <span style={{ background: '#1e3a5f', borderRadius: 4, padding: '2px 7px',
                        color: '#93c5fd', fontWeight: 700, fontSize: 11, flexShrink: 0 }}>L{i+1}</span>
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>V{d.from} → V{d.to}</span>
                      <span style={{ color: '#fbbf24', fontWeight: 700, marginLeft: 'auto', fontFamily: 'monospace' }}>{len}</span>
                    </div>
                  )
                })}
                <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #1e3a5f',
                  display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Perímetro</span>
                  <span style={{ color: '#38bdf8', fontWeight: 700, fontFamily: 'monospace' }}>
                    {(() => {
                      const tot = lateralDists.reduce((s, d) => s + d.dist, 0)
                      return tot >= 1000 ? `${(tot/1000).toFixed(2)} km` : `${Math.round(tot)} m`
                    })()}
                  </span>
                </div>
                {area != null && area > 0 && (
                  <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid #1e3a5f',
                    display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748b' }}>Área</span>
                    <span style={{ color: '#34d399', fontWeight: 700, fontFamily: 'monospace' }}>
                      {area >= 1_000_000
                        ? `${(area / 1_000_000).toFixed(4)} km²`
                        : area >= 10_000
                          ? `${(area / 10_000).toFixed(2)} ha`
                          : `${Math.round(area)} m²`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Botões Zoom ± e Focar Imóvel */}
        <div style={{
          position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
          zIndex: 15, display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <button onClick={() => handleZoom(0.55)} title="Aproximar (zoom +)"
            style={{
              background: '#1e3a5f', border: '1.5px solid #3b82f6', color: '#93c5fd',
              borderRadius: 9, width: 42, height: 42, fontSize: 24, fontWeight: 800,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 3px 10px rgba(0,0,0,0.6)',
              userSelect: 'none',
            }}>+</button>

          {hasBuildingInScene && (
            <button onClick={handleFocusBuilding} title="Focar no imóvel"
              style={{
                background: '#1a3a1a', border: '1.5px solid #22c55e', color: '#4ade80',
                borderRadius: 9, width: 42, height: 42, fontSize: 18,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 3px 10px rgba(0,0,0,0.6)',
                userSelect: 'none',
              }}>🏠</button>
          )}

          <button onClick={() => handleZoom(1.6)} title="Afastar (zoom −)"
            style={{
              background: '#1e293b', border: '1.5px solid #475569', color: '#94a3b8',
              borderRadius: 9, width: 42, height: 42, fontSize: 28, fontWeight: 800,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 3px 10px rgba(0,0,0,0.6)',
              userSelect: 'none',
              lineHeight: 1,
            }}>−</button>
        </div>

        {webglErr ? (
          <div style={{
            width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 18,
            background: '#0d1117',
          }}>
            <div style={{ fontSize: 48 }}>🏔️</div>
            <div style={{ fontSize: 15, color: '#94a3b8', textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>
              <b style={{ color: '#f97316' }}>WebGL não disponível</b> neste ambiente de pré-visualização.<br />
              O relevo 3D funcionará normalmente no <b style={{ color: '#38bdf8' }}>dispositivo final</b> após o deploy no Cloudflare.
            </div>
            <button onClick={onClose} style={{
              background: '#1e3a5f', border: '1px solid #3b82f6', color: '#93c5fd',
              borderRadius: 8, padding: '8px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>Fechar</button>
          </div>
        ) : (
          <div ref={mountRef} style={{ width: '100%', height: '100%', cursor: massMovePhase === 'selecting' ? 'crosshair' : undefined }} />
        )}
      </div>

      {/* Legenda */}
      <div style={{ marginTop: 14, display: 'flex', gap: 14, fontSize: 12, color: '#64748b',
        flexWrap: 'wrap', justifyContent: 'center' }}>
        {aiMode ? (
          <>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ fontSize:14 }}>🔬</span>
              <span style={{ color:'#a5b4fc', fontWeight:700 }}>IA + Satélite ativo</span>
            </span>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ width:11, height:11, borderRadius:2, background:'#f59e0b', display:'inline-block' }}/>
              <span style={{ fontSize:11 }}>Cortes/taludes detectados (solo exposto)</span>
            </span>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ width:11, height:11, borderRadius:2, background:'#22d3ee', display:'inline-block' }}/>
              <span style={{ fontSize:11 }}>Bordas acentuadas (mudança de terreno)</span>
            </span>
            <span style={{ color: '#475569', fontSize: 11 }}>Análise Sobel · Detecção de solo exposto/rocha nua · Normal map aplicado</span>
          </>
        ) : satMode ? (
          <>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ fontSize:14 }}>🛰️</span>
              <span style={{ color:'#4ade80', fontWeight:700 }}>Textura ESRI World Imagery</span>
            </span>
            <span style={{ color: '#64748b', fontSize: 11 }}>Imagem de satélite real projetada sobre o relevo topográfico · Clique em 🔬 IA Terreno para análise avançada</span>
          </>
        ) : (
          <>
            {[
              ['#22c55e','0–3% — Plano'],
              ['#84cc16','3–8% — Suave'],
              ['#eab308','8–20% — Moderado'],
              ['#f97316','20–45% — Forte'],
              ['#ef4444','45–75% — Muito forte'],
              ['#7c3aed','> 75% — Escarpado'],
            ].map(([cor,txt]) => (
              <span key={txt} style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ width:11, height:11, borderRadius:3, background:cor, display:'inline-block' }}/>
                {txt}
              </span>
            ))}
            <span style={{ color: '#3b82f6', fontSize: 11 }}>— Curvas de nível (cotas reais em m)</span>
            <span style={{ color: '#f87171', fontSize: 11 }}>▲ Pico destacado quando Δh ≥ 20 m</span>
          </>
        )}
      </div>
    </div>
  )
}
