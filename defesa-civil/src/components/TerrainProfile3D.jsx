import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

function elevToColor(t) {
  const low  = new THREE.Color(0x22c55e)
  const mid  = new THREE.Color(0xeab308)
  const high = new THREE.Color(0xf97316)
  const peak = new THREE.Color(0xef4444)
  if (t < 0.33) return low.clone().lerp(mid, t / 0.33)
  if (t < 0.66) return mid.clone().lerp(high, (t - 0.33) / 0.33)
  return high.clone().lerp(peak, (t - 0.66) / 0.34)
}

// Calcula intervalo de cota apropriado para o desnível
function calcContourInterval(range) {
  if (range <= 10)  return 1
  if (range <= 30)  return 2
  if (range <= 60)  return 5
  if (range <= 150) return 10
  if (range <= 400) return 20
  return 50
}

// Cria sprite com texto usando CanvasTexture
function makeTextSprite(scene, text, color, x, y, z, scaleX, scaleY) {
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 256, 64)
  ctx.fillStyle = 'rgba(10,16,34,0.75)'
  ctx.beginPath()
  ctx.roundRect(2, 4, 252, 56, 8)
  ctx.fill()
  ctx.font = 'bold 28px "Courier New", monospace'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.fillText(text, 128, 42)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(scaleX || 60, scaleY || 14, 1)
  sprite.position.set(x, y, z)
  scene.add(sprite)
  return sprite
}

// Constrói grade de terreno (polígono)
function buildGridMesh(points, cols, rows, minE, maxE) {
  const total     = points.length
  const positions = new Float32Array(total * 3)
  const colorsArr = new Float32Array(total * 3)
  for (let i = 0; i < total; i++) {
    const p = points[i]
    positions[i*3] = p.x; positions[i*3+1] = p.y; positions[i*3+2] = p.z
    const t = maxE > minE ? (p.y - minE) / (maxE - minE) : 0.5
    const c = elevToColor(t)
    colorsArr[i*3] = c.r; colorsArr[i*3+1] = c.g; colorsArr[i*3+2] = c.b
  }
  const indices = []
  for (let r = 0; r < rows-1; r++) {
    for (let c = 0; c < cols-1; c++) {
      const a=r*cols+c, b=r*cols+c+1, cc=(r+1)*cols+c, d=(r+1)*cols+c+1
      indices.push(a,cc,b); indices.push(b,cc,d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colorsArr, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

// Constrói fita de perfil 1D (medir)
function buildRibbonMesh(rowsX, rowsY, rowsZ, minE, maxE, numCols) {
  const NC = numCols, N = rowsX.length / NC
  const positions = new Float32Array(rowsX.length * 3)
  const colorsArr = new Float32Array(rowsX.length * 3)
  for (let i = 0; i < rowsX.length; i++) {
    positions[i*3] = rowsX[i]; positions[i*3+1] = rowsY[i]; positions[i*3+2] = rowsZ[i]
    const t = maxE > minE ? (rowsY[i] - minE) / (maxE - minE) : 0.5
    const c = elevToColor(t)
    colorsArr[i*3] = c.r; colorsArr[i*3+1] = c.g; colorsArr[i*3+2] = c.b
  }
  const indices = []
  for (let i = 0; i < N-1; i++) {
    for (let j = 0; j < NC-1; j++) {
      const a=i*NC+j, b=i*NC+j+1, c=(i+1)*NC+j, dd=(i+1)*NC+j+1
      indices.push(a,c,b); indices.push(b,c,dd)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colorsArr, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

export default function TerrainProfile3D({ mode, perfil, gridData, lateralDists, onClose }) {
  const mountRef = useRef(null)
  const [showDists, setShowDists] = useState(true)

  useEffect(() => {
    const container = mountRef.current
    if (!container) return
    const W = container.clientWidth  || 800
    const H = container.clientHeight || 500

    const scene    = new THREE.Scene()
    scene.background = new THREE.Color(0x0d1117)
    scene.fog = new THREE.FogExp2(0x0d1117, 0.00018)

    const camera   = new THREE.PerspectiveCamera(50, W / H, 0.1, 200000)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping  = true
    controls.dampingFactor  = 0.07
    controls.rotateSpeed    = 0.8
    controls.zoomSpeed      = 1.2
    controls.minDistance    = 1
    controls.maxDistance    = 200000

    let geo = null

    // ── Modo Polígono ─────────────────────────────────────────
    if (mode === 'poligono' && gridData?.points?.length > 0) {
      const { points, cols, rows, minE, maxE } = gridData
      geo = buildGridMesh(points, cols, rows, minE, maxE)

      // Wireframe
      const wireMat = new THREE.MeshBasicMaterial({ color: 0x1e3a5f, wireframe: true, transparent: true, opacity: 0.2 })
      scene.add(new THREE.Mesh(geo.clone(), wireMat))

      // Esferas nos pontos internos
      const sphereGeo = new THREE.SphereGeometry(0.3, 6, 6)
      points.forEach(p => {
        if (!p.inside) return
        const t   = maxE > minE ? (p.y - minE) / (maxE - minE) : 0.5
        const col = elevToColor(t)
        const mat = new THREE.MeshLambertMaterial({ color: col })
        const s   = new THREE.Mesh(sphereGeo, mat)
        s.position.set(p.x, p.y + 0.5, p.z)
        scene.add(s)
      })

    // ── Modo Medir ────────────────────────────────────────────
    } else if (mode === 'medir' && perfil?.length > 1) {
      const COLS = 24, N = perfil.length
      const totalDist = perfil[N-1].dist
      const elevs = perfil.map(p => p.elev)
      const minE  = Math.min(...elevs), maxE = Math.max(...elevs)
      const ribbonW = Math.max(totalDist * 0.18, 15)
      const rx = [], ry = [], rz = []
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < COLS; j++) {
          rx.push(perfil[i].dist)
          ry.push(perfil[i].elev)
          rz.push((j / (COLS-1)) * ribbonW)
        }
      }
      geo = buildRibbonMesh(rx, ry, rz, minE, maxE, COLS)
    }

    if (geo) {
      const mat  = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
      const mesh = new THREE.Mesh(geo, mat)
      scene.add(mesh)

      if (mode !== 'poligono') {
        const wireMat = new THREE.MeshBasicMaterial({ color: 0x1e3a5f, wireframe: true, transparent: true, opacity: 0.18 })
        scene.add(new THREE.Mesh(geo.clone(), wireMat))
      }

      geo.computeBoundingBox()
      const box    = geo.boundingBox
      const center = new THREE.Vector3()
      box.getCenter(center)
      const size   = new THREE.Vector3()
      box.getSize(size)
      const maxDim = Math.max(size.x, size.y, size.z)

      camera.position.set(
        center.x - maxDim * 0.5,
        center.y + maxDim * 1.1,
        center.z + maxDim * 1.8,
      )
      controls.target.copy(center)

      // Grade de chão
      const gridSize = Math.max(size.x, size.z) * 1.8
      const grid = new THREE.GridHelper(gridSize, 28, 0x1e3a5f, 0x0f1929)
      grid.position.set(center.x, box.min.y - 0.5, center.z)
      scene.add(grid)

      // ── CURVAS DE NÍVEL ───────────────────────────────────
      const minE = box.min.y, maxE = box.max.y
      const range = maxE - minE
      const interval = calcContourInterval(range)
      const startE   = Math.ceil(minE / interval) * interval

      // Definir escala para os sprites baseada no tamanho da cena
      const spriteW = maxDim * 0.22
      const spriteH = maxDim * 0.055

      for (let e = startE; e <= maxE + 0.01; e += interval) {
        const t = (e - minE) / range
        const col = elevToColor(Math.min(t, 1))
        const hex = '#' + col.getHexString()

        // Retângulo horizontal no nível da cota (perimeter)
        const pts = [
          new THREE.Vector3(box.min.x, e, box.min.z),
          new THREE.Vector3(box.max.x, e, box.min.z),
          new THREE.Vector3(box.max.x, e, box.max.z),
          new THREE.Vector3(box.min.x, e, box.max.z),
          new THREE.Vector3(box.min.x, e, box.min.z),
        ]
        const lMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.55 })
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lMat))

        // Label de cota na frente (z mínimo) e na lateral (x mínimo)
        makeTextSprite(scene, `${Math.round(e)} m`, hex,
          box.min.x - spriteW * 0.6, e, box.min.z,
          spriteW, spriteH)
        makeTextSprite(scene, `${Math.round(e)} m`, hex,
          box.max.x + spriteW * 0.6, e, box.max.z,
          spriteW, spriteH)
      }

      // ── COLUNAS VERTICAIS NOS CANTOS COM ESCALA ──────────
      const corners = [
        [box.min.x, box.min.z],
        [box.max.x, box.min.z],
        [box.min.x, box.max.z],
        [box.max.x, box.max.z],
      ]
      const colMat = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.55 })
      const tickMat = new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.8 })

      corners.forEach(([cx, cz]) => {
        // Linha vertical principal
        const pts = [new THREE.Vector3(cx, minE - 0.5, cz), new THREE.Vector3(cx, maxE + 1, cz)]
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), colMat))

        // Ticks em cada cota
        for (let e = startE; e <= maxE + 0.01; e += interval) {
          const tickLen = size.x * 0.025
          const tpts = [new THREE.Vector3(cx - tickLen, e, cz), new THREE.Vector3(cx + tickLen, e, cz)]
          scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(tpts), tickMat))
        }
      })

      // ── SETA + LABEL DO DESNÍVEL (barra lateral) ─────────
      const barX = box.max.x + size.x * 0.08
      const barPts = [
        new THREE.Vector3(barX, minE, box.min.z),
        new THREE.Vector3(barX, maxE, box.min.z),
      ]
      const barMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.7 })
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(barPts), barMat))
      makeTextSprite(scene, `Δh = ${Math.round(range)} m`, '#38bdf8',
        barX, (minE + maxE) / 2, box.min.z, spriteW, spriteH)

      // ── COTAS POLÍGONO (nome nos cantos do mesh) ──────────
      if (mode === 'poligono') {
        makeTextSprite(scene, `min: ${Math.round(minE)} m`, '#22c55e',
          center.x, minE - spriteH, center.z, spriteW * 1.2, spriteH)
        makeTextSprite(scene, `max: ${Math.round(maxE)} m`, '#ef4444',
          center.x, maxE + spriteH * 0.5, center.z, spriteW * 1.2, spriteH)
      }
    }

    controls.update()

    scene.add(new THREE.AmbientLight(0x8ab4f8, 0.9))
    const sun = new THREE.DirectionalLight(0xffffff, 1.3)
    sun.position.set(500, 800, 400)
    scene.add(sun)
    const fill = new THREE.DirectionalLight(0x6699ff, 0.4)
    fill.position.set(-300, 200, -300)
    scene.add(fill)

    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    let animId
    const animate = () => {
      animId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement)
    }
  }, [mode, perfil, gridData])

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
        {/* Header */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          background: 'linear-gradient(180deg,rgba(13,17,23,0.97) 0%,transparent 100%)',
          padding: '14px 18px', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', pointerEvents: 'none',
        }}>
          <div style={{ color: '#f0f9ff', fontWeight: 700, fontSize: 16 }}>
            🏔️ {mode === 'poligono' ? 'Relevo 3D do Polígono' : 'Perfil 3D do Terreno'}
          </div>
          <div style={{ fontSize: 11, color: '#475569' }}>
            Arraste → rotacionar &nbsp;·&nbsp; Scroll → zoom &nbsp;·&nbsp; Botão direito → mover
          </div>
        </div>

        <button onClick={onClose} style={{
          position: 'absolute', top: 12, right: 14, zIndex: 20,
          background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0',
          borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>✕ Fechar</button>

        {/* Painel de Info (cotas + polígono) */}
        {mode === 'poligono' && gridData && (
          <div style={{
            position: 'absolute', bottom: 16, left: 16, zIndex: 10,
            background: 'rgba(13,17,23,0.92)', borderRadius: 10, padding: '10px 14px',
            border: '1px solid #1e3a5f', fontSize: 11, color: '#64748b', minWidth: 140,
          }}>
            <div style={{ color: '#a78bfa', fontWeight: 700, marginBottom: 6, fontSize: 12 }}>
              📐 Grade {gridData.rows} × {gridData.cols}
            </div>
            <div>Alt. mín: <b style={{ color: '#22c55e' }}>{gridData.minE} m</b></div>
            <div>Alt. máx: <b style={{ color: '#ef4444' }}>{gridData.maxE} m</b></div>
            <div>Desnível: <b style={{ color: '#38bdf8' }}>{gridData.maxE - gridData.minE} m</b></div>
            <div style={{ marginTop: 6, borderTop: '1px solid #1e3a5f', paddingTop: 6 }}>
              <div style={{ color: '#64748b', fontSize: 10 }}>
                Intervalo curvas: <b style={{ color: '#7dd3fc' }}>{calcContourInterval(gridData.maxE - gridData.minE)} m</b>
              </div>
            </div>
          </div>
        )}

        {/* Painel de medidas dos lados do polígono */}
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
              <button
                onClick={() => setShowDists(s => !s)}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 11 }}
              >{showDists ? '▲ ocultar' : '▼ expandir'}</button>
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
                      <span style={{
                        background: '#1e3a5f', borderRadius: 4, padding: '2px 7px',
                        color: '#93c5fd', fontWeight: 700, fontSize: 11, flexShrink: 0,
                      }}>L{i+1}</span>
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>
                        V{d.from} → V{d.to}
                      </span>
                      <span style={{ color: '#fbbf24', fontWeight: 700, marginLeft: 'auto', fontFamily: 'monospace' }}>
                        {len}
                      </span>
                    </div>
                  )
                })}
                <div style={{
                  marginTop: 8, paddingTop: 6, borderTop: '1px solid #1e3a5f',
                  display: 'flex', justifyContent: 'space-between',
                }}>
                  <span style={{ color: '#64748b' }}>Perímetro total</span>
                  <span style={{ color: '#38bdf8', fontWeight: 700, fontFamily: 'monospace' }}>
                    {(() => {
                      const total = lateralDists.reduce((s,d) => s + d.dist, 0)
                      return total >= 1000 ? `${(total/1000).toFixed(2)} km` : `${Math.round(total)} m`
                    })()}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Legenda de cores */}
      <div style={{ marginTop: 14, display: 'flex', gap: 20, fontSize: 12, color: '#64748b' }}>
        {[['#22c55e','Baixa altitude'],['#eab308','Altitude média'],['#f97316','Alta altitude'],['#ef4444','Pico']].map(([cor,txt]) => (
          <span key={txt} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ width:12, height:12, borderRadius:3, background:cor, display:'inline-block' }} />
            {txt}
          </span>
        ))}
        <span style={{ color: '#475569', fontSize: 11 }}>— Linhas = curvas de nível</span>
      </div>
    </div>
  )
}

