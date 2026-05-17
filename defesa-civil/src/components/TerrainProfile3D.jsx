import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// ── Cor por altitude relativa (t = 0..1) ─────────────────────
function elevToColor(t) {
  const low  = new THREE.Color(0x22c55e)
  const mid  = new THREE.Color(0xeab308)
  const high = new THREE.Color(0xf97316)
  const peak = new THREE.Color(0xef4444)
  if (t < 0.33) return low.clone().lerp(mid, t / 0.33)
  if (t < 0.66) return mid.clone().lerp(high, (t - 0.33) / 0.33)
  return high.clone().lerp(peak, (t - 0.66) / 0.34)
}

function calcContourInterval(range) {
  if (range <= 100) return 1
  if (range <= 250) return 2
  if (range <= 500) return 5
  return 10
}

// ── Sprite de texto (canvas) ──────────────────────────────────
function makeTextSprite(scene, text, color, x, y, z, scaleX, scaleY) {
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 256, 64)
  ctx.fillStyle = 'rgba(10,16,34,0.82)'
  ctx.beginPath(); ctx.roundRect(2, 4, 252, 56, 8); ctx.fill()
  ctx.font = 'bold 27px "Courier New", monospace'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.fillText(text, 128, 42)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
  const spr = new THREE.Sprite(mat)
  spr.scale.set(scaleX || 60, scaleY || 14, 1)
  spr.position.set(x, y, z)
  scene.add(spr)
  return spr
}

// ── Grade do polígono — coordenadas reais, sem exagero ────────
// Y = (elev - minE) → base no zero, mas proporção fiel
function buildGridMesh(points, cols, rows, minE, maxE) {
  const total     = points.length
  const positions = new Float32Array(total * 3)
  const colorsArr = new Float32Array(total * 3)
  for (let i = 0; i < total; i++) {
    const p      = points[i]
    const relY   = p.y - minE                           // altura relativa (m reais)
    positions[i*3]   = p.x
    positions[i*3+1] = relY
    positions[i*3+2] = p.z
    const t = maxE > minE ? relY / (maxE - minE) : 0.5
    const c = elevToColor(t)
    colorsArr[i*3] = c.r; colorsArr[i*3+1] = c.g; colorsArr[i*3+2] = c.b
  }
  const indices = []
  for (let r = 0; r < rows-1; r++) {
    for (let c = 0; c < cols-1; c++) {
      const a=r*cols+c, b=r*cols+c+1, cc=(r+1)*cols+c, d=(r+1)*cols+c+1
      indices.push(a, cc, b); indices.push(b, cc, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colorsArr, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

// ── Fita de perfil longitudinal — sem exagero ─────────────────
function buildRibbonMesh(rowsX, rowsY, rowsZ, minE, maxE, numCols) {
  const NC    = numCols
  const count = rowsX.length
  const positions = new Float32Array(count * 3)
  const colorsArr = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const relY = rowsY[i] - minE
    positions[i*3]   = rowsX[i]
    positions[i*3+1] = relY
    positions[i*3+2] = rowsZ[i]
    const t = maxE > minE ? relY / (maxE - minE) : 0.5
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
  geo.computeVertexNormals()
  return geo
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
export default function TerrainProfile3D({ mode, perfil, gridData, lateralDists, area, onClose }) {
  const mountRef     = useRef(null)
  const cameraRef    = useRef(null)
  const controlsRef  = useRef(null)
  const [showDists, setShowDists] = useState(true)
  const [info, setInfo] = useState(null)   // { minE, maxE, range, interval }

  useEffect(() => {
    const container = mountRef.current
    if (!container) return
    const W = container.clientWidth  || 800
    const H = container.clientHeight || 500

    const scene    = new THREE.Scene()
    scene.background = new THREE.Color(0x0d1117)
    scene.fog = new THREE.FogExp2(0x0d1117, 0.00016)

    const camera   = new THREE.PerspectiveCamera(48, W / H, 0.1, 500000)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.rotateSpeed   = 0.8
    controls.zoomSpeed     = 1.2
    controls.minDistance   = 0.5
    controls.maxDistance   = 500000
    cameraRef.current   = camera
    controlsRef.current = controls

    let geo = null
    let realMinE = 0, realMaxE = 0, realRange = 0

    // ── Modo Polígono ──────────────────────────────────────────
    if (mode === 'poligono' && gridData?.points?.length > 0) {
      const { points, cols, rows, minE, maxE } = gridData
      realMinE = minE; realMaxE = maxE; realRange = maxE - minE
      setInfo({ minE, maxE, range: realRange, interval: calcContourInterval(realRange) })

      geo = buildGridMesh(points, cols, rows, minE, maxE)

      // Wireframe leve
      scene.add(new THREE.Mesh(geo.clone(),
        new THREE.MeshBasicMaterial({ color: 0x1e3a5f, wireframe: true, transparent: true, opacity: 0.15 })))

      // Esferas nos vértices internos (pequenas)
      const sphereGeo = new THREE.SphereGeometry(0.25, 6, 6)
      points.forEach(p => {
        if (!p.inside) return
        const t   = realRange > 0 ? (p.y - realMinE) / realRange : 0.5
        const col = elevToColor(t)
        const s   = new THREE.Mesh(sphereGeo, new THREE.MeshLambertMaterial({ color: col }))
        s.position.set(p.x, (p.y - realMinE) + 0.3, p.z)
        scene.add(s)
      })

    // ── Modo Medir ─────────────────────────────────────────────
    } else if (mode === 'medir' && perfil?.length > 1) {
      const COLS = 24, N = perfil.length
      const elevs = perfil.map(p => p.elev)
      realMinE = Math.min(...elevs); realMaxE = Math.max(...elevs); realRange = realMaxE - realMinE
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
      geo = buildRibbonMesh(rx, ry, rz, realMinE, realMaxE, COLS)
    }

    if (geo) {
      const mat  = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
      scene.add(new THREE.Mesh(geo, mat))

      if (mode !== 'poligono') {
        scene.add(new THREE.Mesh(geo.clone(),
          new THREE.MeshBasicMaterial({ color: 0x1e3a5f, wireframe: true, transparent: true, opacity: 0.15 })))
      }

      geo.computeBoundingBox()
      const box    = geo.boundingBox
      const center = new THREE.Vector3(); box.getCenter(center)
      const size   = new THREE.Vector3(); box.getSize(size)

      // ── Câmera posicionada lateralmente para evidenciar o relevo ──
      // Olha de um ângulo que mostra tanto o plano XZ quanto a variação em Y
      const horizMax = Math.max(size.x, size.z)
      const vertMax  = Math.max(size.y, 1)
      // Posição que garante visualizar ambas as dimensões (sem exagero)
      camera.position.set(
        center.x - horizMax * 0.6,
        center.y + vertMax  * 2.0 + horizMax * 0.5,   // sobe proporcionalmente ao desnível
        center.z + horizMax * 1.4,
      )
      controls.target.copy(center)

      // ── Sprites: escala relativa ao maior lado horizontal ─────
      const sw = horizMax * 0.20
      const sh = horizMax * 0.048

      // ── Grade de chão ─────────────────────────────────────────
      const gridSize = horizMax * 1.9
      const grid     = new THREE.GridHelper(gridSize, 32, 0x1e3a5f, 0x0f1929)
      grid.position.set(center.x, box.min.y - 0.3, center.z)
      scene.add(grid)

      // ── CURVAS DE NÍVEL ────────────────────────────────────────
      // Posicionadas exatamente em (e - minE) metros — escala real
      const interval = calcContourInterval(realRange)
      const startE   = Math.ceil(realMinE / interval) * interval

      for (let e = startE; e <= realMaxE + 0.001; e += interval) {
        const relY = e - realMinE                       // Y real na cena
        const t    = realRange > 0 ? (e - realMinE) / realRange : 0.5
        const col  = elevToColor(Math.min(t, 1))
        const hex  = '#' + col.getHexString()

        // Plano horizontal exatamente na cota e
        const pts = [
          new THREE.Vector3(box.min.x, relY, box.min.z),
          new THREE.Vector3(box.max.x, relY, box.min.z),
          new THREE.Vector3(box.max.x, relY, box.max.z),
          new THREE.Vector3(box.min.x, relY, box.max.z),
          new THREE.Vector3(box.min.x, relY, box.min.z),
        ]
        scene.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.6 })
        ))

        // Labels nas laterais com cota absoluta real
        makeTextSprite(scene, `${Math.round(e)} m`, hex,
          box.min.x - sw * 0.58, relY, box.min.z, sw, sh)
        makeTextSprite(scene, `${Math.round(e)} m`, hex,
          box.max.x + sw * 0.58, relY, box.max.z, sw, sh)
      }


      // ── BARRA DE DESNÍVEL (Δh real) ───────────────────────────
      const barX   = box.max.x + size.x * 0.07
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(barX, 0,         box.min.z),
          new THREE.Vector3(barX, realRange, box.min.z),
        ]),
        new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.75 })
      ))
      makeTextSprite(scene, `Δh = ${Math.round(realRange)} m`, '#38bdf8',
        barX, realRange / 2, box.min.z, sw, sh)

      // ── LABELS MIN/MAX ────────────────────────────────────────
      if (mode === 'poligono') {
        makeTextSprite(scene, `min: ${Math.round(realMinE)} m`, '#22c55e',
          center.x, -sh * 0.9, center.z, sw * 1.25, sh)
        makeTextSprite(scene, `max: ${Math.round(realMaxE)} m`, '#ef4444',
          center.x, realRange + sh * 0.55, center.z, sw * 1.25, sh)
      }

      // ── PICO DESTACADO quando há relevo significativo ─────────
      // Cone posicionado na cota real, sem distorção
      if (realRange >= 20) {
        if (mode === 'poligono' && gridData?.points?.length > 0) {
          const peakPt = gridData.points.reduce((a, b) => b.y > a.y ? b : a)
          addPeakMarker(scene, peakPt.x, peakPt.z, peakPt.y - realMinE, peakPt.y, realRange, sw, sh)
        } else if (mode === 'medir' && perfil?.length > 1) {
          const peakPt  = perfil.reduce((a, b) => b.elev > a.elev ? b : a)
          const ribW    = Math.max(perfil[perfil.length-1].dist * 0.12, 10)
          addPeakMarker(scene, peakPt.dist, ribW / 2, peakPt.elev - realMinE, peakPt.elev, realRange, sw, sh)
        }
      }
    }

    controls.update()

    scene.add(new THREE.AmbientLight(0x9ab4d8, 0.95))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(500, 800, 400); scene.add(sun)
    const fillLight = new THREE.DirectionalLight(0x6699ff, 0.35)
    fillLight.position.set(-300, 200, -300)
    scene.add(fillLight)

    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    let animId
    const animate = () => { animId = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera) }
    animate()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      controls.dispose(); renderer.dispose()
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement)
    }
  }, [mode, perfil, gridData])

  function handleZoom(factor) {
    const cam  = cameraRef.current
    const ctrl = controlsRef.current
    if (!cam || !ctrl) return
    const dir = cam.position.clone().sub(ctrl.target)
    dir.multiplyScalar(factor)
    cam.position.copy(ctrl.target).add(dir)
    ctrl.update()
  }

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Indicador de escala real */}
            <span style={{
              background: '#0a2010', border: '1px solid #166534',
              borderRadius: 6, padding: '3px 11px',
              color: '#86efac', fontSize: 11, fontWeight: 700,
            }}>
              Escala real 1:1 &nbsp;·&nbsp; cotas em metros reais
            </span>
            <span style={{ fontSize: 11, color: '#475569' }}>
              Arraste → rotacionar &nbsp;·&nbsp; Scroll → zoom &nbsp;·&nbsp; Dir → mover
            </span>
          </div>
        </div>

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
              <div style={{ color: '#475569', fontSize: 10, marginTop: 3 }}>
                Escala vertical 1:1 — sem exagero
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
              </div>
            )}
          </div>
        )}

        {/* Botões Zoom ± */}
        <div style={{
          position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)',
          zIndex: 15, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <button onClick={() => handleZoom(0.7)} style={{
            background: '#1e293b', border: '1.5px solid #475569', color: '#e2e8f0',
            borderRadius: 8, width: 38, height: 38, fontSize: 22, fontWeight: 700,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          }}>+</button>
          <button onClick={() => handleZoom(1.4)} style={{
            background: '#1e293b', border: '1.5px solid #475569', color: '#e2e8f0',
            borderRadius: 8, width: 38, height: 38, fontSize: 26, fontWeight: 700,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          }}>−</button>
        </div>

        <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Legenda */}
      <div style={{ marginTop: 14, display: 'flex', gap: 18, fontSize: 12, color: '#64748b',
        flexWrap: 'wrap', justifyContent: 'center' }}>
        {[['#22c55e','Cota baixa'],['#eab308','Cota média'],['#f97316','Cota alta'],['#ef4444','Cota máxima']].map(([cor,txt]) => (
          <span key={txt} style={{ display:'flex', alignItems:'center', gap:5 }}>
            <span style={{ width:11, height:11, borderRadius:3, background:cor, display:'inline-block' }}/>
            {txt}
          </span>
        ))}
        <span style={{ color: '#3b82f6', fontSize: 11 }}>— Linhas horizontais = curvas de nível (cotas reais em m)</span>
        <span style={{ color: '#f87171', fontSize: 11 }}>▲ Pico destacado quando Δh ≥ 20 m</span>
      </div>
    </div>
  )
}
