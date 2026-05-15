import { useEffect, useRef } from 'react'
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

// Constrói BufferGeometry de terreno para grade ROWS × COLS
function buildGridMesh(points, cols, rows, minE, maxE) {
  const total     = points.length
  const positions = new Float32Array(total * 3)
  const colorsArr = new Float32Array(total * 3)

  for (let i = 0; i < total; i++) {
    const p = points[i]
    positions[i * 3]     = p.x
    positions[i * 3 + 1] = p.y
    positions[i * 3 + 2] = p.z
    const t = maxE > minE ? (p.y - minE) / (maxE - minE) : 0.5
    const c = elevToColor(t)
    colorsArr[i * 3]     = c.r
    colorsArr[i * 3 + 1] = c.g
    colorsArr[i * 3 + 2] = c.b
  }

  const indices = []
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c
      const b = r * cols + c + 1
      const cc = (r + 1) * cols + c
      const d = (r + 1) * cols + c + 1
      indices.push(a, cc, b)
      indices.push(b, cc, d)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colorsArr, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

// Constrói BufferGeometry de fita (perfil 1D)
function buildRibbonMesh(rowsX, rowsY, rowsZ, minE, maxE, numCols) {
  const NC        = numCols
  const N         = rowsX.length / NC
  const positions = new Float32Array(rowsX.length * 3)
  const colorsArr = new Float32Array(rowsX.length * 3)

  for (let i = 0; i < rowsX.length; i++) {
    positions[i * 3]     = rowsX[i]
    positions[i * 3 + 1] = rowsY[i]
    positions[i * 3 + 2] = rowsZ[i]
    const t = maxE > minE ? (rowsY[i] - minE) / (maxE - minE) : 0.5
    const c = elevToColor(t)
    colorsArr[i * 3]     = c.r
    colorsArr[i * 3 + 1] = c.g
    colorsArr[i * 3 + 2] = c.b
  }

  const indices = []
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < NC - 1; j++) {
      const a = i * NC + j
      const b = i * NC + j + 1
      const c = (i + 1) * NC + j
      const dd = (i + 1) * NC + j + 1
      indices.push(a, c, b)
      indices.push(b, c, dd)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colorsArr, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

export default function TerrainProfile3D({ mode, perfil, gridData, onClose }) {
  const mountRef = useRef(null)

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    const W = container.clientWidth  || 800
    const H = container.clientHeight || 500

    const scene    = new THREE.Scene()
    scene.background = new THREE.Color(0x0d1117)

    const camera   = new THREE.PerspectiveCamera(50, W / H, 0.1, 100000)
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
    controls.minDistance   = 1
    controls.maxDistance   = 100000

    let geo = null

    // ── Modo Polígono: grade 2D de terreno ──────────────────────
    if (mode === 'poligono' && gridData?.points?.length > 0) {
      const { points, cols, rows, minE, maxE } = gridData

      geo = buildGridMesh(points, cols, rows, minE, maxE)

      // Linhas de grade visíveis entre células
      const wireGeo = geo.clone()
      const wireMat = new THREE.MeshBasicMaterial({
        color: 0x1e3a5f, wireframe: true, transparent: true, opacity: 0.25,
      })
      scene.add(new THREE.Mesh(wireGeo, wireMat))

      // Esferas nos pontos internos ao polígono (destaque)
      const sphereGeo = new THREE.SphereGeometry(0.3, 6, 6)
      points.forEach(p => {
        if (!p.inside) return
        const t = maxE > minE ? (p.y - minE) / (maxE - minE) : 0.5
        const col = elevToColor(t)
        const mat = new THREE.MeshLambertMaterial({ color: col })
        const sphere = new THREE.Mesh(sphereGeo, mat)
        sphere.position.set(p.x, p.y + 0.5, p.z)
        scene.add(sphere)
      })

    // ── Modo Medir: fita de perfil 1D ──────────────────────────
    } else if (mode === 'medir' && perfil?.length > 1) {
      const COLS      = 24
      const N         = perfil.length
      const totalDist = perfil[N - 1].dist
      const elevs     = perfil.map(p => p.elev)
      const minE      = Math.min(...elevs)
      const maxE      = Math.max(...elevs)
      const ribbonW   = Math.max(totalDist * 0.18, 15)

      const rx = [], ry = [], rz = []
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < COLS; j++) {
          rx.push(perfil[i].dist)
          ry.push(perfil[i].elev)
          rz.push((j / (COLS - 1)) * ribbonW)
        }
      }
      geo = buildRibbonMesh(rx, ry, rz, minE, maxE, COLS)
    }

    if (geo) {
      const mat  = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
      const mesh = new THREE.Mesh(geo, mat)
      scene.add(mesh)

      // Wireframe sobre o mesh principal
      if (mode !== 'poligono') {
        const wireMat = new THREE.MeshBasicMaterial({ color: 0x1e3a5f, wireframe: true, transparent: true, opacity: 0.22 })
        scene.add(new THREE.Mesh(geo.clone(), wireMat))
      }

      // Câmera enquadrada na cena
      geo.computeBoundingBox()
      const box    = geo.boundingBox
      const center = new THREE.Vector3()
      box.getCenter(center)
      const size   = new THREE.Vector3()
      box.getSize(size)
      const maxDim = Math.max(size.x, size.y, size.z)

      camera.position.set(
        center.x - maxDim * 0.5,
        center.y + maxDim * 1.0,
        center.z + maxDim * 1.6,
      )
      controls.target.copy(center)

      // Grade de chão
      const gridSize = Math.max(size.x, size.z) * 1.6
      const grid = new THREE.GridHelper(gridSize, 24, 0x1e3a5f, 0x111827)
      grid.position.set(center.x, box.min.y - 0.5, center.z)
      scene.add(grid)

      // Linhas de cota (eixo vertical) nos cantos do bbox
      if (mode === 'poligono') {
        const corners = [
          [box.min.x, box.min.z],
          [box.max.x, box.min.z],
          [box.min.x, box.max.z],
          [box.max.x, box.max.z],
        ]
        const lineMat = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.5 })
        corners.forEach(([cx, cz]) => {
          const pts = [new THREE.Vector3(cx, box.min.y - 0.5, cz), new THREE.Vector3(cx, box.max.y + 1, cz)]
          scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat))
        })
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
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
      zIndex: 9999, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '92vw', maxWidth: 1100, height: '82vh', background: '#0d1117',
        borderRadius: 16, overflow: 'hidden', position: 'relative',
        border: '1px solid #1e3a5f', boxShadow: '0 25px 60px rgba(0,0,0,0.7)',
      }}>
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

        {mode === 'poligono' && gridData && (
          <div style={{
            position: 'absolute', bottom: 16, left: 16, zIndex: 10,
            background: 'rgba(13,17,23,0.85)', borderRadius: 8, padding: '8px 12px',
            border: '1px solid #1e3a5f', fontSize: 11, color: '#64748b',
          }}>
            <div style={{ color: '#a78bfa', fontWeight: 700, marginBottom: 4 }}>Grade {gridData.rows} × {gridData.cols}</div>
            <div>Alt. mín: <b style={{ color: '#22c55e' }}>{gridData.minE} m</b></div>
            <div>Alt. máx: <b style={{ color: '#ef4444' }}>{gridData.maxE} m</b></div>
            <div>Desnível: <b style={{ color: '#38bdf8' }}>{gridData.maxE - gridData.minE} m</b></div>
          </div>
        )}

        <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 20, fontSize: 12, color: '#64748b' }}>
        {[['#22c55e','Baixa altitude'],['#eab308','Altitude média'],['#f97316','Alta altitude'],['#ef4444','Pico']].map(([cor,txt]) => (
          <span key={txt} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ width:12, height:12, borderRadius:3, background:cor, display:'inline-block' }} />
            {txt}
          </span>
        ))}
      </div>
    </div>
  )
}
