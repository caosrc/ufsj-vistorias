import { useRef, useEffect, useState } from 'react'
import * as THREE from 'three'

function buildLocalPts(vertices) {
  if (!vertices || vertices.length < 3) return { pts: [], baseR: 20, transform: null }
  const ref = vertices[0]
  const R = 6371000
  const cosLat = Math.cos(ref.lat * Math.PI / 180)
  const raw = vertices.map(v => ({
    x: (v.lng - ref.lng) * cosLat * Math.PI / 180 * R,
    z: -(v.lat - ref.lat) * Math.PI / 180 * R,
  }))
  const cx = raw.reduce((s, p) => s + p.x, 0) / raw.length
  const cz = raw.reduce((s, p) => s + p.z, 0) / raw.length
  const centered = raw.map(p => ({ x: p.x - cx, z: p.z - cz }))
  const maxR = Math.max(...centered.map(p => Math.sqrt(p.x * p.x + p.z * p.z)), 0.1)
  const scale = 12 / maxR
  return {
    pts: centered.map(p => ({ x: p.x * scale, z: p.z * scale })),
    baseR: maxR * scale * 2.8,
    transform: { ref, cosLat, R, cx, cz, scale },
  }
}

function gpsToLocal(lat, lng, transform) {
  if (!transform) return null
  const { ref, cosLat, R, cx, cz, scale } = transform
  const rawX = (lng - ref.lng) * cosLat * Math.PI / 180 * R
  const rawZ = -(lat - ref.lat) * Math.PI / 180 * R
  return { x: (rawX - cx) * scale, z: (rawZ - cz) * scale }
}

function localToGps(x, z, transform) {
  if (!transform) return null
  const { ref, cosLat, R, cx, cz, scale } = transform
  const rawX = x / scale + cx
  const rawZ = z / scale + cz
  const lng = rawX / (cosLat * Math.PI / 180 * R) + ref.lng
  const lat = -rawZ / (Math.PI / 180 * R) + ref.lat
  return { lat, lng }
}

// modo: null | 'ponto' | 'linha' | 'edificacao' | 'parede'
export default function Edificio3D({
  vertices,
  altura,
  anomalias = [],
  onAddAnomalia,
  onRemoveAnomalia,
  onCrackComplete,
  showPontoButton = true,
  showTrincaButton = true,
  vistoriaAnomalias = [],
  monitoramentoAnomalias = [],
  onSaveEdificacao,
  edificacaoSalva,
}) {
  const mountRef = useRef(null)
  const threeRef = useRef({})

  const modoRef           = useRef(null)
  const anomaliasRef      = useRef(anomalias)
  const onAddRef          = useRef(onAddAnomalia)
  const onRemoveRef       = useRef(onRemoveAnomalia)
  const linhaPtsRef       = useRef([])
  const linhaRefIdRef     = useRef(null)
  const edificVertsRef3D  = useRef([])
  const edificClosedRef3D = useRef(false)
  const paredeStartRef    = useRef(null)

  const [modo,           setModo]           = useState(null)
  const [linhaRefId,     setLinhaRefId]     = useState(null)
  const [linhaPts,       setLinhaPts]       = useState([])
  const [pendingPoint,   setPendingPoint]   = useState(null)
  const [localNome,      setLocalNome]      = useState('')
  const [edificVerts3D,  setEdificVerts3D]  = useState([])
  const [edificClosed3D, setEdificClosed3D] = useState(false)
  const [paredeStart,    setParedeStart]    = useState(null)
  const [isSnapping,     setIsSnapping]     = useState(false)
  const [edificAltura,   setEdificAltura]   = useState('')
  const [sceneKey,       setSceneKey]       = useState(0)
  const [edificPavimentos, setEdificPavimentos] = useState('')
  const [selectedFloor,  setSelectedFloor]  = useState(1)
  const [coordLatInput,  setCoordLatInput]  = useState('')
  const [coordLngInput,  setCoordLngInput]  = useState('')
  const [edificSalva,    setEdificSalva]    = useState(false)
  const [gpsLoadingEdif, setGpsLoadingEdif] = useState(false)

  const edificAlturaRef       = useRef('')
  const edificPavimentosRef   = useRef('')
  const selectedFloorRef      = useRef(1)
  const isLoadingFromSavedRef = useRef(false)

  useEffect(() => { modoRef.current = modo }, [modo])
  useEffect(() => { anomaliasRef.current = anomalias }, [anomalias])
  useEffect(() => { onAddRef.current = onAddAnomalia }, [onAddAnomalia])
  useEffect(() => { onRemoveRef.current = onRemoveAnomalia }, [onRemoveAnomalia])
  useEffect(() => { linhaRefIdRef.current = linhaRefId }, [linhaRefId])

  const monitoramentoAnomaliasRef = useRef(monitoramentoAnomalias)
  useEffect(() => { monitoramentoAnomaliasRef.current = monitoramentoAnomalias }, [monitoramentoAnomalias])
  useEffect(() => { edificVertsRef3D.current = edificVerts3D }, [edificVerts3D])
  useEffect(() => { edificClosedRef3D.current = edificClosed3D }, [edificClosed3D])
  useEffect(() => { paredeStartRef.current = paredeStart }, [paredeStart])
  useEffect(() => { edificAlturaRef.current = edificAltura }, [edificAltura])
  useEffect(() => { edificPavimentosRef.current = edificPavimentos }, [edificPavimentos])
  useEffect(() => { selectedFloorRef.current = selectedFloor }, [selectedFloor])

  // ── Three.js scene ──────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    const H_PX = 360
    const W_PX = el.clientWidth || 360

    const scene    = new THREE.Scene()
    scene.background = new THREE.Color(0xe8f0f8)

    const camera   = new THREE.PerspectiveCamera(45, W_PX / H_PX, 0.1, 5000)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(W_PX, H_PX)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    el.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const sun = new THREE.DirectionalLight(0xfff8ee, 1.1)
    sun.position.set(40, 80, 50); sun.castShadow = true; scene.add(sun)
    const fill = new THREE.DirectionalLight(0xddeeff, 0.35)
    fill.position.set(-30, 20, -40); scene.add(fill)

    const grid = new THREE.GridHelper(120, 30, 0x9fb8cc, 0xc8d8e8)
    grid.position.y = -0.05; scene.add(grid)

    const { pts, baseR, transform } = buildLocalPts(vertices)
    const altH = Math.max(parseFloat(altura) * 1.1, 2.5)

    threeRef.current.altH      = altH
    threeRef.current.outerPts  = pts
    threeRef.current.transform = transform

    const shape = new THREE.Shape()
    if (pts.length >= 3) {
      shape.moveTo(pts[0].x, pts[0].z)
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].z)
      shape.closePath()
    }

    const clickable = []

    if (pts.length >= 3) {
      const floorGeo = new THREE.ShapeGeometry(shape)
      floorGeo.rotateX(Math.PI / 2)
      const floor = new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({ color: 0xc8a878, side: THREE.DoubleSide }))
      floor.receiveShadow = true; floor.userData.face = 'piso'; scene.add(floor); clickable.push(floor)

      const wallColors = [0xdceaf8, 0xcce0f5, 0xd5e8f8, 0xc8dcf0]
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length]
        const dx = b.x - a.x, dz = b.z - a.z
        const len = Math.sqrt(dx * dx + dz * dz)
        if (len < 0.01) continue
        const wallGeo = new THREE.PlaneGeometry(len, altH, 1, 1)
        const wall = new THREE.Mesh(wallGeo, new THREE.MeshLambertMaterial({
          color: wallColors[i % wallColors.length], side: THREE.DoubleSide, transparent: true, opacity: 0.93,
        }))
        wall.position.set((a.x + b.x) / 2, altH / 2, (a.z + b.z) / 2)
        wall.rotation.y = -Math.atan2(dz, dx)
        wall.castShadow = true; wall.receiveShadow = true
        wall.userData.face = `parede-${i + 1}`; scene.add(wall); clickable.push(wall)
      }

      const edgePts = []
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length]
        edgePts.push(a.x, 0, a.z, b.x, 0, b.z)
        edgePts.push(a.x, altH, a.z, b.x, altH, b.z)
        edgePts.push(a.x, 0, a.z, a.x, altH, a.z)
      }
      const edgeGeo = new THREE.BufferGeometry()
      edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3))
      scene.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x2a4060 })))

      // Esferas nos vértices do polígono externo — marcadores de snap
      pts.forEach(v => {
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.26, 10, 10),
          new THREE.MeshLambertMaterial({ color: 0xfbbf24, emissive: new THREE.Color(0x221100) })
        )
        dot.position.set(v.x, 0.1, v.z); dot.userData.isSnapDot = true; scene.add(dot)
      })
    }

    const groundGeo  = new THREE.PlaneGeometry(300, 300)
    const groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }))
    groundMesh.rotation.x = -Math.PI / 2; groundMesh.position.y = 0.01
    groundMesh.userData.face = 'ground'; scene.add(groundMesh)
    threeRef.current.groundPlane = groundMesh
    threeRef.current.scene       = scene
    threeRef.current.clickable   = clickable
    threeRef.current.camera      = camera
    threeRef.current.renderer    = renderer

    let theta = Math.PI / 4, phi = 1.08
    let zoomR = baseR + altH * 0.8
    const MIN_ZOOM = altH * 0.5, MAX_ZOOM = baseR * 5

    function updateCam() {
      camera.position.x = zoomR * Math.sin(phi) * Math.sin(theta)
      camera.position.y = zoomR * Math.cos(phi) + altH * 0.5
      camera.position.z = zoomR * Math.sin(phi) * Math.cos(theta)
      camera.lookAt(0, altH * 0.45, 0)
    }
    updateCam()

    const raycaster = new THREE.Raycaster()
    const mouse2    = new THREE.Vector2()
    threeRef.current.raycaster = raycaster
    threeRef.current.mouse2    = mouse2

    // ── Snap: ponto mais próximo na borda do polígono externo + vértices da edificação ──
    function snapToNearest(px, pz, threshold = 2.2) {
      const outer  = threeRef.current.outerPts || []
      const edific = edificVertsRef3D.current
      let bestPt = null, bestDist = threshold

      // Projeção sobre cada aresta da borda
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i], b = outer[(i + 1) % outer.length]
        const dx = b.x - a.x, dz = b.z - a.z
        const lenSq = dx * dx + dz * dz
        if (lenSq < 0.001) continue
        const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq))
        const cx2 = a.x + t * dx, cz2 = a.z + t * dz
        const d = Math.sqrt((px - cx2) ** 2 + (pz - cz2) ** 2)
        if (d < bestDist) { bestDist = d; bestPt = { x: cx2, z: cz2 } }
      }
      // Snap ao 1º vértice da edificação (para fechar)
      if (edific.length >= 3) {
        const v = edific[0]
        const d = Math.sqrt((px - v.x) ** 2 + (pz - v.z) ** 2)
        if (d < bestDist) { bestDist = d; bestPt = { x: v.x, z: v.z } }
      }
      return bestPt
    }

    // ── Preview de linha enquanto edifica ────────────────────────
    function updateEdificPreview(from, to) {
      const s = threeRef.current.scene
      if (!s) return
      if (threeRef.current.edificPreviewLine) {
        s.remove(threeRef.current.edificPreviewLine)
        threeRef.current.edificPreviewLine = null
      }
      const pts3 = [
        new THREE.Vector3(from.x, 0.12, from.z),
        new THREE.Vector3(to.x, 0.12, to.z),
      ]
      const geo  = new THREE.BufferGeometry().setFromPoints(pts3)
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x2563eb, linewidth: 3 }))
      line.userData.isEdificPreview = true
      s.add(line); threeRef.current.edificPreviewLine = line
    }

    function clearEdificPreview() {
      const s = threeRef.current.scene
      if (!s || !threeRef.current.edificPreviewLine) return
      s.remove(threeRef.current.edificPreviewLine)
      threeRef.current.edificPreviewLine = null
    }

    // ── Raycast utilitário ─────────────────────────────────────────
    function raycastGround(cx, cy) {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse2.x = ((cx - rect.left) / rect.width) * 2 - 1
      mouse2.y = -((cy - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse2, camera)
      const gp = threeRef.current.groundPlane
      return gp ? raycaster.intersectObject(gp) : []
    }

    function doRaycast(cx, cy) {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse2.x = ((cx - rect.left) / rect.width) * 2 - 1
      mouse2.y = -((cy - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse2, camera)

      const currentModo = modoRef.current

      // ── Modo edificação: clique coloca vértice (com snap à borda) ─
      if (currentModo === 'edificacao') {
        const hits = raycastGround(cx, cy)
        if (!hits.length) return
        let px = hits[0].point.x, pz = hits[0].point.z

        const snapped = snapToNearest(px, pz)
        if (snapped) { px = snapped.x; pz = snapped.z }
        setIsSnapping(!!snapped)

        const verts = edificVertsRef3D.current
        // Fechar ao clicar perto do 1º vértice
        if (verts.length >= 3) {
          const first = verts[0]
          const dist  = Math.sqrt((px - first.x) ** 2 + (pz - first.z) ** 2)
          if (dist < 0.5) {
            clearEdificPreview()
            edificClosedRef3D.current = true
            setEdificClosed3D(true)
            setModo(null); modoRef.current = null
            setIsSnapping(false)
            return
          }
        }
        const newVerts = [...verts, { x: px, z: pz }]
        edificVertsRef3D.current = newVerts
        setEdificVerts3D([...newVerts])
        return
      }

      // ── Modo parede com anomalia: 2 cliques = start → end ────────
      if (currentModo === 'parede') {
        const hits = raycastGround(cx, cy)
        if (!hits.length) return
        let px = hits[0].point.x, pz = hits[0].point.z

        const snapped = snapToNearest(px, pz)
        if (snapped) { px = snapped.x; pz = snapped.z }

        const current = paredeStartRef.current
        if (current === null) {
          const start = { x: px, z: pz }
          paredeStartRef.current = start; setParedeStart(start)
        } else {
          const n = anomaliasRef.current.filter(a => a.type === 'parede-anomalia').length + 1
          const numFloors = parseInt(edificPavimentosRef.current) || 1
          const hEdifP = parseFloat(edificAlturaRef.current)
          const totalHP = hEdifP > 0 ? hEdifP : altH
          const floorHP = totalHP / numFloors
          const floorNP = selectedFloorRef.current || 1
          const yBaseP = (floorNP - 1) * floorHP
          onAddRef.current({
            id: Date.now(), nome: `P${n}`, type: 'parede-anomalia',
            localNome: 'Parede com Anomalia',
            startPoint: { x: current.x, y: yBaseP, z: current.z },
            endPoint:   { x: px,        y: yBaseP, z: pz },
            linhasTrinca: [],
            floor: floorNP, floorHeight: floorHP, totalFloors: numFloors,
          })
          paredeStartRef.current = null; setParedeStart(null)
          setModo(null); modoRef.current = null
        }
        return
      }

      // ── Modos normais ─────────────────────────────────────────────
      const hits = raycaster.intersectObjects(threeRef.current.clickable || [])
      if (!hits.length) return
      const hit   = hits[0]
      const point = { x: hit.point.x, y: hit.point.y, z: hit.point.z }
      const face  = hit.object.userData.face

      if (currentModo === 'ponto') {
        setPendingPoint({ face, point }); setLocalNome('')
        setModo(null); modoRef.current = null
      } else if (currentModo === 'linha') {
        if (!linhaRefIdRef.current) return
        const newPts = [...linhaPtsRef.current, point]
        linhaPtsRef.current = newPts; setLinhaPts([...newPts])
      }
    }

    let dragging = false, startX = 0, startY = 0, moved = false

    function onDown(cx, cy) {
      if (modoRef.current === 'edificacao' || modoRef.current === 'parede') {
        dragging = false; moved = false; startX = cx; startY = cy
        return
      }
      dragging = true; startX = cx; startY = cy; moved = false
    }
    function onMove(cx, cy) {
      // Modo edificação: mostrar preview de linha em tempo real
      if (modoRef.current === 'edificacao') {
        const verts = edificVertsRef3D.current
        if (verts.length === 0) return
        const hits = raycastGround(cx, cy)
        if (!hits.length) return
        let px = hits[0].point.x, pz = hits[0].point.z
        const snapped = snapToNearest(px, pz)
        if (snapped) { px = snapped.x; pz = snapped.z }
        const last = verts[verts.length - 1]
        updateEdificPreview(last, { x: px, z: pz })
        setIsSnapping(!!snapped)
        return
      }
      // Modo parede: preview da linha reta
      if (modoRef.current === 'parede' && paredeStartRef.current) {
        const hits = raycastGround(cx, cy)
        if (!hits.length) return
        let px = hits[0].point.x, pz = hits[0].point.z
        const snapped = snapToNearest(px, pz)
        if (snapped) { px = snapped.x; pz = snapped.z }
        updateEdificPreview(paredeStartRef.current, { x: px, z: pz })
        return
      }
      if (!dragging) return
      const dx = cx - startX, dy = cy - startY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true
      theta -= dx * 0.013
      phi = Math.max(0.12, Math.min(1.5, phi + dy * 0.011))
      startX = cx; startY = cy; updateCam()
    }
    function onUp(cx, cy) {
      if (modoRef.current === 'edificacao' || modoRef.current === 'parede') {
        const dx = cx - startX, dy = cy - startY
        // Trata tanto clique quanto drag como "colocar vértice"
        doRaycast(cx, cy)
        return
      }
      dragging = false
      if (!moved && modoRef.current) doRaycast(cx, cy)
    }
    function onWheel(e) {
      e.preventDefault()
      zoomR = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomR * (e.deltaY > 0 ? 1.1 : 0.9)))
      updateCam()
    }

    let lastPinchDist = null
    function getTouchDist(t) {
      const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY
      return Math.sqrt(dx * dx + dy * dy)
    }
    function onTouchStart(e) {
      e.preventDefault()
      if (e.touches.length === 1) {
        const t = e.touches[0]
        onDown(t.clientX, t.clientY); lastPinchDist = null
      } else if (e.touches.length === 2) { dragging = false; lastPinchDist = getTouchDist(e.touches) }
    }
    function onTouchMove(e) {
      e.preventDefault()
      if (e.touches.length === 1 && lastPinchDist === null) {
        const t = e.touches[0]; onMove(t.clientX, t.clientY)
      } else if (e.touches.length === 2) {
        const dist = getTouchDist(e.touches)
        if (lastPinchDist !== null) {
          zoomR = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomR * (lastPinchDist / dist)))
          updateCam()
        }
        lastPinchDist = dist
      }
    }
    function onTouchEnd(e) {
      if (e.touches.length < 2) lastPinchDist = null
      if (e.touches.length === 0) { const t = e.changedTouches[0]; onUp(t.clientX, t.clientY) }
    }

    const cv = renderer.domElement
    cv.addEventListener('mousedown', e => onDown(e.clientX, e.clientY))
    cv.addEventListener('mousemove', e => onMove(e.clientX, e.clientY))
    cv.addEventListener('mouseup',   e => onUp(e.clientX, e.clientY))
    cv.addEventListener('wheel', onWheel, { passive: false })
    cv.addEventListener('touchstart', onTouchStart, { passive: false })
    cv.addEventListener('touchmove',  onTouchMove, { passive: false })
    cv.addEventListener('touchend',   onTouchEnd)

    let frameId
    function animate() { frameId = requestAnimationFrame(animate); renderer.render(scene, camera) }
    animate()

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (w < 10) return
      renderer.setSize(w, H_PX); camera.aspect = w / H_PX; camera.updateProjectionMatrix()
    })
    ro.observe(el)

    setSceneKey(k => k + 1)
    return () => {
      cancelAnimationFrame(frameId); ro.disconnect(); renderer.dispose()
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
      threeRef.current = {}
    }
  }, [vertices, altura])

  // ── Carregar edificação salva anteriormente ───────────────────────
  useEffect(() => {
    if (!edificacaoSalva?.gpsVerts?.length) return
    const transform = threeRef.current.transform
    if (!transform) return
    const verts = edificacaoSalva.gpsVerts.map(v => gpsToLocal(v.lat, v.lng, transform)).filter(Boolean)
    if (verts.length >= 3) {
      isLoadingFromSavedRef.current = true
      setEdificVerts3D(verts)
      edificVertsRef3D.current = verts
      setEdificClosed3D(true)
      edificClosedRef3D.current = true
      if (edificacaoSalva.altura) { setEdificAltura(String(edificacaoSalva.altura)); edificAlturaRef.current = String(edificacaoSalva.altura) }
      if (edificacaoSalva.pavimentos) { setEdificPavimentos(String(edificacaoSalva.pavimentos)); edificPavimentosRef.current = String(edificacaoSalva.pavimentos) }
      setEdificSalva(true)
      setTimeout(() => { isLoadingFromSavedRef.current = false }, 0)
    }
  }, [edificacaoSalva, vertices])

  // ── Auto-salvar edificação ao fechar polígono ─────────────────────
  useEffect(() => {
    if (!edificClosed3D || edificVerts3D.length < 3 || !onSaveEdificacao) return
    if (isLoadingFromSavedRef.current) return
    const transform = threeRef.current.transform
    if (!transform) return
    const gpsVerts = edificVerts3D.map(v => localToGps(v.x, v.z, transform)).filter(Boolean)
    if (gpsVerts.length < 3) return
    onSaveEdificacao({
      gpsVerts,
      altura: parseFloat(edificAlturaRef.current) > 0 ? parseFloat(edificAlturaRef.current) : parseFloat(altura),
      pavimentos: parseInt(edificPavimentosRef.current) > 0 ? parseInt(edificPavimentosRef.current) : 1,
    })
    setEdificSalva(true)
  }, [edificClosed3D]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Renderizar edificação desenhada ──────────────────────────────
  useEffect(() => {
    const { scene, altH } = threeRef.current
    if (!scene) return
    scene.children.filter(c => c.userData.isEdificObj).forEach(c => scene.remove(c))
    if (threeRef.current.clickable) {
      threeRef.current.clickable = threeRef.current.clickable.filter(m => !m.userData.isEdificObj)
    }

    const verts = edificVerts3D
    if (verts.length === 0) return
    const hEdif = parseFloat(edificAltura)
    const h = hEdif > 0 ? hEdif : (altH || 4)

    verts.forEach((v, i) => {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 10, 10),
        new THREE.MeshLambertMaterial({ color: i === 0 ? 0x22c55e : 0x2563eb })
      )
      dot.position.set(v.x, 0.08, v.z); dot.userData.isEdificObj = true; scene.add(dot)
    })

    if (verts.length >= 2) {
      const pts3 = verts.map(v => new THREE.Vector3(v.x, 0.08, v.z))
      if (edificClosed3D) pts3.push(new THREE.Vector3(verts[0].x, 0.08, verts[0].z))
      const geo  = new THREE.BufferGeometry().setFromPoints(pts3)
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x2563eb, linewidth: 2 }))
      line.userData.isEdificObj = true; scene.add(line)
    }

    if (edificClosed3D && verts.length >= 3) {
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i], b = verts[(i + 1) % verts.length]
        const dx = b.x - a.x, dz = b.z - a.z
        const len = Math.sqrt(dx * dx + dz * dz)
        if (len < 0.01) continue
        const wallGeo = new THREE.PlaneGeometry(len, h, 1, 1)
        const wall    = new THREE.Mesh(wallGeo, new THREE.MeshLambertMaterial({
          color: 0xfbbf24, side: THREE.DoubleSide, transparent: true, opacity: 0.82,
        }))
        wall.position.set((a.x + b.x) / 2, h / 2, (a.z + b.z) / 2)
        wall.rotation.y = -Math.atan2(dz, dx)
        wall.castShadow = true; wall.userData.isEdificObj = true
        wall.userData.face = `edif-parede-${i + 1}`
        scene.add(wall)
        if (threeRef.current.clickable) threeRef.current.clickable.push(wall)
      }

      const edgePts = []
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i], b = verts[(i + 1) % verts.length]
        edgePts.push(a.x, 0, a.z, b.x, 0, b.z)
        edgePts.push(a.x, h, a.z, b.x, h, b.z)
        edgePts.push(a.x, 0, a.z, a.x, h, a.z)
      }
      const edgeGeo = new THREE.BufferGeometry()
      edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3))
      const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x92400e }))
      edges.userData.isEdificObj = true; scene.add(edges)

      const shape = new THREE.Shape()
      shape.moveTo(verts[0].x, verts[0].z)
      for (let i = 1; i < verts.length; i++) shape.lineTo(verts[i].x, verts[i].z)
      shape.closePath()
      const floorGeo = new THREE.ShapeGeometry(shape)
      floorGeo.rotateX(Math.PI / 2)
      const floor = new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({ color: 0xfde68a, side: THREE.DoubleSide }))
      floor.userData.isEdificObj = true; floor.userData.face = 'edif-piso'
      scene.add(floor)
      if (threeRef.current.clickable) threeRef.current.clickable.push(floor)

      const numPav = parseInt(edificPavimentos) || 1
      if (numPav > 1) {
        const floorH = h / numPav
        for (let f = 1; f < numPav; f++) {
          const fy = f * floorH
          const fpPts = []
          for (let i = 0; i < verts.length; i++) {
            const a = verts[i], b = verts[(i + 1) % verts.length]
            fpPts.push(a.x, fy, a.z, b.x, fy, b.z)
          }
          const fpGeo = new THREE.BufferGeometry()
          fpGeo.setAttribute('position', new THREE.Float32BufferAttribute(fpPts, 3))
          const fpLine = new THREE.LineSegments(fpGeo, new THREE.LineBasicMaterial({
            color: 0x92400e, transparent: true, opacity: 0.55,
          }))
          fpLine.userData.isEdificObj = true; scene.add(fpLine)

          const fpShape = new THREE.Shape()
          fpShape.moveTo(verts[0].x, verts[0].z)
          for (let i = 1; i < verts.length; i++) fpShape.lineTo(verts[i].x, verts[i].z)
          fpShape.closePath()
          const fpPlaneGeo = new THREE.ShapeGeometry(fpShape)
          fpPlaneGeo.rotateX(Math.PI / 2); fpPlaneGeo.translate(0, fy, 0)
          const fpPlane = new THREE.Mesh(fpPlaneGeo, new THREE.MeshLambertMaterial({
            color: 0xfef3c7, side: THREE.DoubleSide, transparent: true, opacity: 0.32,
          }))
          fpPlane.userData.isEdificObj = true; scene.add(fpPlane)
        }
      }
    }
  }, [edificVerts3D, edificClosed3D, edificAltura, edificPavimentos, sceneKey, vertices])

  // ── Preview ponto inicial da parede ─────────────────────────────
  useEffect(() => {
    const { scene } = threeRef.current
    if (!scene) return
    scene.children.filter(c => c.userData.isParedeStart).forEach(c => scene.remove(c))
    if (!paredeStart) return
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 12, 12),
      new THREE.MeshLambertMaterial({ color: 0xef4444, emissive: new THREE.Color(0x330000) })
    )
    sphere.position.set(paredeStart.x, 0.12, paredeStart.z)
    sphere.userData.isParedeStart = true; scene.add(sphere)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.74, 18),
      new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
    )
    ring.position.set(paredeStart.x, 0.14, paredeStart.z)
    ring.rotation.x = -Math.PI / 2; ring.userData.isParedeStart = true; scene.add(ring)
  }, [paredeStart])

  // ── Preview linha de trinca em construção ───────────────────────
  useEffect(() => {
    const { scene } = threeRef.current
    if (!scene) return
    const keys = ['previewLinePts', 'previewLineMesh']
    keys.forEach(k => {
      if (threeRef.current[k]) { scene.remove(threeRef.current[k]); threeRef.current[k] = null }
    })
    if (linhaPts.length < 1) return
    const v3s  = linhaPts.map(p => new THREE.Vector3(p.x, p.y, p.z))
    const geo  = new THREE.BufferGeometry().setFromPoints(v3s)
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff4400, linewidth: 2 }))
    scene.add(line); threeRef.current.previewLinePts = line
    const group = new THREE.Group()
    for (const p of linhaPts) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshLambertMaterial({ color: 0xff4400 }))
      dot.position.set(p.x, p.y, p.z); group.add(dot)
    }
    scene.add(group); threeRef.current.previewLineMesh = group
  }, [linhaPts])

  // ── Label sprite ────────────────────────────────────────────────
  function makeLabel(text, bg = 'rgba(220,38,38,0.90)') {
    const canvas = document.createElement('canvas')
    const ctx    = canvas.getContext('2d')
    const fontSize = 26
    ctx.font = `bold ${fontSize}px Arial`
    const tw = ctx.measureText(text).width
    const px = 14, py = 10
    canvas.width  = Math.ceil(tw + px * 2); canvas.height = Math.ceil(fontSize + py * 2)
    const r = 10
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.beginPath()
    ctx.moveTo(r, 0); ctx.lineTo(canvas.width - r, 0)
    ctx.quadraticCurveTo(canvas.width, 0, canvas.width, r)
    ctx.lineTo(canvas.width, canvas.height - r)
    ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - r, canvas.height)
    ctx.lineTo(r, canvas.height); ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - r)
    ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.closePath()
    ctx.fillStyle = bg; ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.stroke()
    ctx.font = `bold ${fontSize}px Arial`; ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    const texture = new THREE.CanvasTexture(canvas)
    const mat     = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
    const sprite  = new THREE.Sprite(mat)
    sprite.scale.set((canvas.width / canvas.height) * 2.4, 2.4, 1)
    return sprite
  }

  // ── Renderizar anomalias salvas ──────────────────────────────────
  useEffect(() => {
    const { scene, altH } = threeRef.current
    if (!scene) return
    scene.children.filter(c => c.userData.isAnomalia).forEach(c => scene.remove(c))
    const h = altH || 4

    anomalias.forEach(a => {
      if (a.type === 'parede-anomalia' && a.startPoint && a.endPoint) {
        const sx = a.startPoint.x, sz = a.startPoint.z
        const ex = a.endPoint.x,   ez = a.endPoint.z
        const dx = ex - sx, dz = ez - sz
        const len = Math.sqrt(dx * dx + dz * dz)
        if (len < 0.01) return
        const wallH  = a.floorHeight || h
        const yBase  = a.startPoint.y || 0
        const wall = new THREE.Mesh(
          new THREE.PlaneGeometry(len, wallH),
          new THREE.MeshLambertMaterial({ color: 0xef4444, side: THREE.DoubleSide, transparent: true, opacity: 0.78 })
        )
        wall.position.set((sx + ex) / 2, yBase + wallH / 2, (sz + ez) / 2)
        wall.rotation.y = -Math.atan2(dz, dx); wall.castShadow = true
        wall.userData.isAnomalia = true; scene.add(wall)
        const ep = [sx, yBase, sz, ex, yBase, ez, ex, yBase + wallH, ez, sx, yBase + wallH, sz, sx, yBase, sz]
        const eGeo = new THREE.BufferGeometry()
        eGeo.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3))
        const eLine = new THREE.Line(eGeo, new THREE.LineBasicMaterial({ color: 0x991b1b }))
        eLine.userData.isAnomalia = true; scene.add(eLine)
        const label = makeLabel(a.nome + (a.floor && a.totalFloors > 1 ? ` (${a.floor}º pav.)` : ''), 'rgba(239,68,68,0.92)')
        label.position.set((sx + ex) / 2, yBase + wallH + 1.2, (sz + ez) / 2)
        label.userData.isAnomalia = true; scene.add(label)
        for (const p of [a.startPoint, a.endPoint]) {
          const dot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), new THREE.MeshLambertMaterial({ color: 0xdc2626 }))
          dot.position.set(p.x, yBase + 0.1, p.z); dot.userData.isAnomalia = true; scene.add(dot)
        }
        return
      }

      if (a.point) {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.38, 14, 14),
          new THREE.MeshLambertMaterial({ color: 0xdc2626, emissive: new THREE.Color(0x440000) })
        )
        sphere.position.set(a.point.x, a.point.y, a.point.z)
        sphere.userData.isAnomalia = true; scene.add(sphere)
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.55, 0.78, 20),
          new THREE.MeshBasicMaterial({ color: 0xff4444, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
        )
        ring.position.set(a.point.x, a.point.y + 0.02, a.point.z)
        ring.rotation.x = -Math.PI / 2; ring.userData.isAnomalia = true; scene.add(ring)
        const label = makeLabel(a.nome)
        label.position.set(a.point.x, a.point.y + 1.5, a.point.z)
        label.userData.isAnomalia = true; scene.add(label)
      }

      if (a.linhasTrinca && a.linhasTrinca.length >= 2) {
        const pts3 = a.linhasTrinca.map(p => new THREE.Vector3(p.x, p.y, p.z))
        try {
          const curve = new THREE.CatmullRomCurve3(pts3)
          const tube  = new THREE.Mesh(
            new THREE.TubeGeometry(curve, Math.max(pts3.length * 3, 6), 0.06, 6, false),
            new THREE.MeshLambertMaterial({ color: 0xee1122 })
          )
          tube.userData.isAnomalia = true; scene.add(tube)
        } catch (_) {
          const geo  = new THREE.BufferGeometry().setFromPoints(pts3)
          const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xee1122 }))
          line.userData.isAnomalia = true; scene.add(line)
        }
        for (const p of a.linhasTrinca) {
          const dot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshLambertMaterial({ color: 0xcc0000 }))
          dot.position.set(p.x, p.y, p.z); dot.userData.isAnomalia = true; scene.add(dot)
        }
      }

      if (!a.point && !a.type && a.startPoint && a.endPoint) {
        const start = new THREE.Vector3(a.startPoint.x, a.startPoint.y, a.startPoint.z)
        const end   = new THREE.Vector3(a.endPoint.x, a.endPoint.y, a.endPoint.z)
        const dir   = new THREE.Vector3().subVectors(end, start)
        const len   = dir.length()
        if (len < 0.01) return
        const mid  = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
        const norm = dir.clone().normalize()
        const yAxis = new THREE.Vector3(0, 1, 0)
        const cyl  = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 8), new THREE.MeshLambertMaterial({ color: 0xee1122 }))
        cyl.position.copy(mid)
        if (Math.abs(norm.dot(yAxis)) < 0.9999) cyl.quaternion.setFromUnitVectors(yAxis, norm)
        cyl.userData.isAnomalia = true; scene.add(cyl)
        const label = makeLabel(a.nome)
        label.position.set(mid.x, mid.y + 1.2, mid.z); label.userData.isAnomalia = true; scene.add(label)
      }
    })
  }, [anomalias])

  // ── Renderizar anomalias da vistoria original (somente leitura) ──
  useEffect(() => {
    const { scene, altH } = threeRef.current
    if (!scene) return
    scene.children.filter(c => c.userData.isVistoriaRef).forEach(c => scene.remove(c))
    if (!vistoriaAnomalias || vistoriaAnomalias.length === 0) return
    const h = altH || 4

    vistoriaAnomalias.forEach(a => {
      if (a.type === 'parede-anomalia' && a.startPoint && a.endPoint) {
        const sx = a.startPoint.x, sz = a.startPoint.z
        const ex = a.endPoint.x,   ez = a.endPoint.z
        const dx = ex - sx, dz = ez - sz
        const len = Math.sqrt(dx * dx + dz * dz)
        if (len < 0.01) return
        const wallH = a.floorHeight || h
        const yBase = a.startPoint.y || 0
        const wall  = new THREE.Mesh(
          new THREE.PlaneGeometry(len, wallH),
          new THREE.MeshLambertMaterial({ color: 0xf97316, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })
        )
        wall.position.set((sx + ex) / 2, yBase + wallH / 2, (sz + ez) / 2)
        wall.rotation.y = -Math.atan2(dz, dx)
        wall.userData.isVistoriaRef = true; scene.add(wall)
        const ep = [sx, yBase, sz, ex, yBase, ez, ex, yBase + wallH, ez, sx, yBase + wallH, sz, sx, yBase, sz]
        const eGeo = new THREE.BufferGeometry()
        eGeo.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3))
        const eLine = new THREE.Line(eGeo, new THREE.LineBasicMaterial({ color: 0xea580c }))
        eLine.userData.isVistoriaRef = true; scene.add(eLine)
        const label = makeLabel(a.nome + (a.floor && a.totalFloors > 1 ? ` (${a.floor}º)` : ''), 'rgba(234,88,12,0.85)')
        label.position.set((sx + ex) / 2, yBase + wallH + 1.0, (sz + ez) / 2)
        label.userData.isVistoriaRef = true; scene.add(label)
        return
      }
      if (a.linhasTrinca && a.linhasTrinca.length >= 2) {
        const pts3 = a.linhasTrinca.map(p => new THREE.Vector3(p.x, p.y, p.z))
        try {
          const curve = new THREE.CatmullRomCurve3(pts3)
          const tube  = new THREE.Mesh(
            new THREE.TubeGeometry(curve, Math.max(pts3.length * 3, 6), 0.07, 6, false),
            new THREE.MeshLambertMaterial({ color: 0xf97316 })
          )
          tube.userData.isVistoriaRef = true; scene.add(tube)
        } catch (_) {
          const geo  = new THREE.BufferGeometry().setFromPoints(pts3)
          const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf97316 }))
          line.userData.isVistoriaRef = true; scene.add(line)
        }
      }
      if (a.point) {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.35, 14, 14),
          new THREE.MeshLambertMaterial({ color: 0xf97316 })
        )
        sphere.position.set(a.point.x, a.point.y, a.point.z)
        sphere.userData.isVistoriaRef = true; scene.add(sphere)
        const label = makeLabel(a.nome, 'rgba(234,88,12,0.85)')
        label.position.set(a.point.x, a.point.y + 1.5, a.point.z)
        label.userData.isVistoriaRef = true; scene.add(label)
      }
    })
  }, [vistoriaAnomalias])

  // ── Renderizar trincas do monitoramento (somente leitura, azul) ──
  useEffect(() => {
    const { scene } = threeRef.current
    if (!scene) return
    scene.children.filter(c => c.userData.isMonitorRef).forEach(c => scene.remove(c))
    if (!monitoramentoAnomalias || monitoramentoAnomalias.length === 0) return

    monitoramentoAnomalias.forEach(a => {
      if (a.linhasTrinca && a.linhasTrinca.length >= 2) {
        const pts3 = a.linhasTrinca.map(p => new THREE.Vector3(p.x, p.y, p.z))
        try {
          const curve = new THREE.CatmullRomCurve3(pts3)
          const tube  = new THREE.Mesh(
            new THREE.TubeGeometry(curve, Math.max(pts3.length * 3, 6), 0.07, 6, false),
            new THREE.MeshLambertMaterial({ color: 0x3b82f6 })
          )
          tube.userData.isMonitorRef = true; scene.add(tube)
        } catch (_) {
          const geo  = new THREE.BufferGeometry().setFromPoints(pts3)
          const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x3b82f6 }))
          line.userData.isMonitorRef = true; scene.add(line)
        }
        for (const p of a.linhasTrinca) {
          const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshLambertMaterial({ color: 0x2563eb }))
          dot.position.set(p.x, p.y, p.z); dot.userData.isMonitorRef = true; scene.add(dot)
        }
      }
      if (a.point) {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.32, 14, 14),
          new THREE.MeshLambertMaterial({ color: 0x3b82f6 })
        )
        sphere.position.set(a.point.x, a.point.y, a.point.z)
        sphere.userData.isMonitorRef = true; scene.add(sphere)
        const label = makeLabel(a.nome, 'rgba(59,130,246,0.9)')
        label.position.set(a.point.x, a.point.y + 1.5, a.point.z)
        label.userData.isMonitorRef = true; scene.add(label)
      }
    })
  }, [monitoramentoAnomalias])

  // ── Funções de controle ─────────────────────────────────────────
  function sair() {
    setModo(null); modoRef.current = null
    setLinhaRefId(null); linhaRefIdRef.current = null
    setLinhaPts([]); linhaPtsRef.current = []
    setPendingPoint(null); setLocalNome('')
    setParedeStart(null); paredeStartRef.current = null
    setIsSnapping(false)
    // Limpar preview
    const { scene } = threeRef.current
    if (scene) {
      scene.children.filter(c => c.userData.isEdificPreview).forEach(c => scene.remove(c))
      threeRef.current.edificPreviewLine = null
    }
  }

  function confirmarPonto() {
    if (!pendingPoint) return
    const num = calcNextNum()
    onAddRef.current({
      id: Date.now(), nome: `T${num}`, face: pendingPoint.face,
      localNome: localNome.trim() || faceLabel(pendingPoint.face),
      point: pendingPoint.point, linhasTrinca: [],
    })
    setPendingPoint(null); setLocalNome('')
  }

  function concluirLinha() {
    if (linhaPts.length < 2) return
    if (linhaRefId && linhaRefId !== 'auto') {
      const anomalia = anomaliasRef.current.find(a => a.id === linhaRefId)
      if (!anomalia) return
      onRemoveRef.current(linhaRefId)
      onAddRef.current({ ...anomalia, linhasTrinca: linhaPts })
      if (onCrackComplete) onCrackComplete(anomalia.nome)
    } else {
      const num = calcNextNum()
      onAddRef.current({
        id: Date.now(), nome: `T${num}`, face: 'parede',
        localNome: 'Trinca', point: linhaPts[0], linhasTrinca: linhaPts,
      })
    }
    sair()
  }

  function desfazerUltimoPonto() {
    if (!linhaPts.length) return
    const newPts = linhaPts.slice(0, -1)
    linhaPtsRef.current = newPts; setLinhaPts(newPts)
  }

  function iniciarEdificacao() {
    setEdificVerts3D([]); edificVertsRef3D.current = []
    setEdificClosed3D(false); edificClosedRef3D.current = false
    setEdificAltura(''); setEdificPavimentos(''); setSelectedFloor(1)
    edificPavimentosRef.current = ''; selectedFloorRef.current = 1
    setModo('edificacao'); modoRef.current = 'edificacao'
    setIsSnapping(false)
  }

  function limparEdificacao() {
    setEdificVerts3D([]); edificVertsRef3D.current = []
    setEdificClosed3D(false); edificClosedRef3D.current = false
    setEdificAltura(''); setEdificPavimentos(''); setSelectedFloor(1)
    edificPavimentosRef.current = ''; selectedFloorRef.current = 1
    setModo(null); modoRef.current = null; setIsSnapping(false)
    setCoordLatInput(''); setCoordLngInput('')
    setEdificSalva(false)
    const { scene } = threeRef.current
    if (scene) { scene.children.filter(c => c.userData.isEdificPreview).forEach(c => scene.remove(c)) }
  }

  function addVertFromCoords() {
    const lat = parseFloat(coordLatInput)
    const lng = parseFloat(coordLngInput)
    if (isNaN(lat) || isNaN(lng)) return
    const transform = threeRef.current.transform
    if (!transform) return
    const pt = gpsToLocal(lat, lng, transform)
    if (!pt) return
    const newVerts = [...edificVertsRef3D.current, { x: pt.x, z: pt.z }]
    edificVertsRef3D.current = newVerts
    setEdificVerts3D([...newVerts])
    setCoordLatInput('')
    setCoordLngInput('')
  }

  function salvarEdificacao() {
    if (!edificVerts3D.length) return
    const transform = threeRef.current.transform
    const gpsVerts = edificVerts3D.map(v => localToGps(v.x, v.z, transform)).filter(Boolean)
    if (onSaveEdificacao) {
      onSaveEdificacao({
        gpsVerts,
        altura: parseFloat(edificAltura) > 0 ? parseFloat(edificAltura) : parseFloat(altura),
        pavimentos: parseInt(edificPavimentos) > 0 ? parseInt(edificPavimentos) : 1,
      })
    }
    setEdificSalva(true)
  }

  function desfazerUltimoVert() {
    const verts = edificVertsRef3D.current
    if (!verts.length) return
    const newVerts = verts.slice(0, -1)
    edificVertsRef3D.current = newVerts; setEdificVerts3D([...newVerts])
  }

  const faceLabel = f => {
    if (!f) return ''
    if (f === 'piso' || f === 'edif-piso') return '🟫 Piso'
    if (f === 'teto') return '🔲 Teto'
    if (f?.startsWith('edif-parede')) return `🏠 ${f.replace('edif-parede-', 'Parede Edif. ')}`
    return `🧱 ${f.replace('parede-', 'Parede ')}`
  }

  // Calcula o próximo código considerando TODAS as trincas existentes
  // (sessão atual + relatórios anteriores) — garante T4 se T1/T2/T3 já existem
  function calcNextNum() {
    const all = [...anomaliasRef.current, ...monitoramentoAnomaliasRef.current]
    const nums = all.map(a => { const m = String(a.nome || '').match(/^T(\d+)$/i); return m ? parseInt(m[1], 10) : 0 })
    return nums.length > 0 ? Math.max(...nums) + 1 : 1
  }

  const nextNum           = calcNextNum()
  const podeMarcarAnomalia = showPontoButton ? true : edificClosed3D

  return (
    <div style={{ marginTop: 14, border: '1.5px solid #bfdbfe', borderRadius: 12, overflow: 'hidden', background: '#f0f6ff' }}>

      {/* ── Cabeçalho ─────────────────────────────────────────── */}
      <div style={{
        padding: '10px 14px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
        borderBottom: '1px solid #dbeafe', background: '#eff6ff',
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 6 }}>
          🏠 Modelo 3D do Imóvel
          <span style={{ fontSize: 10, fontWeight: 400, color: '#64748b' }}>— arraste · scroll/pinch zoom</span>
        </span>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {modo === null && !pendingPoint && (
            <>
              {showPontoButton && (
                <button type='button' onClick={() => { setModo('ponto'); modoRef.current = 'ponto' }}
                  style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  ➕ Adicionar nova Trinca
                </button>
              )}
              {!showPontoButton && !edificClosed3D && (
                <button type='button' onClick={iniciarEdificacao}
                  style={{ background: '#d97706', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  🏗️ Acrescentar Edificação
                </button>
              )}
              {!showPontoButton && edificClosed3D && (
                <>
                  {onSaveEdificacao && (
                    <button type='button' onClick={salvarEdificacao}
                      style={{ background: edificSalva ? '#15803d' : '#16a34a', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {edificSalva ? '✓ Edificação Salva' : '💾 Salvar Edificação'}
                    </button>
                  )}
                  <button type='button' onClick={limparEdificacao}
                    style={{ background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}>
                    🔄 Redesenhar
                  </button>
                  <button type='button' onClick={() => { setModo('parede'); modoRef.current = 'parede' }}
                    style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    🧱 Parede com Anomalia
                  </button>
                </>
              )}
              {showTrincaButton && podeMarcarAnomalia && (showPontoButton ? anomalias.length > 0 : true) && (
                <button type='button' onClick={() => {
                  setModo('linha'); modoRef.current = 'linha'
                  if (!showPontoButton) { setLinhaRefId('auto'); linhaRefIdRef.current = 'auto' }
                }}
                  style={{ background: '#9333ea', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  ✏️ Desenhar Trinca
                </button>
              )}
            </>
          )}

          {pendingPoint && (
            <button type='button' onClick={sair}
              style={{ background: '#64748b', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              ✕ Cancelar
            </button>
          )}
          {modo === 'ponto' && (
            <button type='button' onClick={sair}
              style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              ✕ Cancelar
            </button>
          )}
          {modo === 'edificacao' && (
            <>
              {edificVerts3D.length >= 3 && (
                <button type='button' onClick={() => {
                  setEdificClosed3D(true); edificClosedRef3D.current = true
                  setModo(null); modoRef.current = null; setIsSnapping(false)
                  const { scene } = threeRef.current
                  if (scene) { scene.children.filter(c => c.userData.isEdificPreview).forEach(c => scene.remove(c)) }
                }}
                  style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  ✓ Fechar Edificação
                </button>
              )}
              {edificVerts3D.length > 0 && (
                <button type='button' onClick={desfazerUltimoVert}
                  style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  ↩ Desfazer
                </button>
              )}
              <button type='button' onClick={sair}
                style={{ background: '#64748b', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                ✕ Cancelar
              </button>
            </>
          )}
          {modo === 'parede' && (
            <button type='button' onClick={sair}
              style={{ background: '#64748b', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              ✕ Cancelar
            </button>
          )}
          {modo === 'linha' && (
            <>
              {linhaPts.length >= 2 && (
                <button type='button' onClick={concluirLinha}
                  style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  ✓ Concluir Trinca
                </button>
              )}
              {linhaPts.length > 0 && (
                <button type='button' onClick={desfazerUltimoPonto}
                  style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  ↩ Desfazer
                </button>
              )}
              <button type='button' onClick={sair}
                style={{ background: '#64748b', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                ✕ Cancelar
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Formulário T1 ──────────────────────────────────────── */}
      {pendingPoint && (() => {
        const sugestoesParede = ['Parede Norte', 'Parede Sul', 'Parede Leste', 'Parede Oeste', 'Parede da Sala', 'Parede do Quarto', 'Parede da Cozinha', 'Parede do Banheiro', 'Parede da Garagem', 'Parede Fachada']
        const sugestoesPiso   = ['Piso da Sala', 'Piso do Quarto', 'Piso da Cozinha', 'Piso do Banheiro', 'Recalque', 'Recalque - Fundação']
        const sugestoes   = pendingPoint.face === 'piso' ? sugestoesPiso : sugestoesParede
        const placeholder = pendingPoint.face === 'piso' ? 'Ex: Piso da Sala, Recalque...' : 'Ex: Parede Norte, Parede da Sala...'
        return (
          <div style={{ background: '#f0fdf4', borderBottom: '1px solid #86efac', padding: '12px 14px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#14532d', marginBottom: 8 }}>
              📍 Ponto em <strong>{faceLabel(pendingPoint.face)}</strong> — nomeie o local:
            </div>
            <input autoFocus value={localNome}
              onChange={e => setLocalNome(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmarPonto(); if (e.key === 'Escape') sair() }}
              placeholder={placeholder}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '7px 10px', border: '1.5px solid #86efac', borderRadius: 7, outline: 'none', marginBottom: 8, background: '#fff' }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
              {sugestoes.map(s => (
                <button key={s} type='button' onClick={() => setLocalNome(s)}
                  style={{ background: localNome === s ? '#16a34a' : '#dcfce7', color: localNome === s ? '#fff' : '#15803d', border: '1px solid #86efac', borderRadius: 20, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
                  {s}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type='button' onClick={confirmarPonto}
                style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                ✓ Confirmar Ponto T{nextNum}
              </button>
              <button type='button' onClick={sair}
                style={{ background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
                Cancelar
              </button>
            </div>
          </div>
        )
      })()}

      {/* ── Instrução — modo edificação ─────────────────────────── */}
      {modo === 'edificacao' && (
        <div style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '10px 14px', fontSize: 12, color: '#92400e' }}>
          {/* Altura da edificação */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>🏗️ Altura da edificação (m):</span>
            <input
              type='number' min='1' max='99' step='0.5'
              value={edificAltura}
              onChange={e => setEdificAltura(e.target.value)}
              placeholder={`Padrão: ${parseFloat(altura) > 0 ? parseFloat(altura).toFixed(1) : '3.0'} m`}
              style={{
                width: 120, fontSize: 13, padding: '4px 8px',
                border: '1.5px solid #fde68a', borderRadius: 6, outline: 'none',
                background: '#fff', color: '#451a03', fontWeight: 600,
              }}
            />
            {edificAltura && parseFloat(edificAltura) > 0 && (
              <span style={{ fontSize: 11, background: '#fef9c3', color: '#78350f', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>
                {parseFloat(edificAltura).toFixed(1)} m definido
              </span>
            )}
          </div>
          {/* Nº de Pavimentos */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>🏢 Nº de Pavimentos:</span>
            <input
              type='number' min='1' max='20' step='1'
              value={edificPavimentos}
              onChange={e => setEdificPavimentos(e.target.value)}
              placeholder='Ex: 1'
              style={{
                width: 90, fontSize: 13, padding: '4px 8px',
                border: '1.5px solid #fde68a', borderRadius: 6, outline: 'none',
                background: '#fff', color: '#451a03', fontWeight: 600,
              }}
            />
            {edificPavimentos && parseInt(edificPavimentos) > 1 && (() => {
              const totalH = parseFloat(edificAltura) > 0 ? parseFloat(edificAltura) : (parseFloat(altura) > 0 ? parseFloat(altura) : 3)
              const fH = (totalH / parseInt(edificPavimentos)).toFixed(1)
              return (
                <span style={{ fontSize: 11, background: '#fef9c3', color: '#78350f', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>
                  {parseInt(edificPavimentos)} pavimentos · {fH} m/andar
                </span>
              )
            })()}
          </div>
          {/* Instrução de desenho */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14 }}>📐</span>
            <span>
              {edificVerts3D.length === 0
                ? <>Clique (ou clique e arraste) no <strong>terreno</strong> para marcar o 1º vértice — ou insira coordenadas abaixo</>
                : edificVerts3D.length < 3
                  ? <>{edificVerts3D.length} ponto(s) — adicione mais {3 - edificVerts3D.length} para fechar</>
                  : <>{edificVerts3D.length} pontos — clique no <strong>ponto verde</strong> para fechar ou use "Fechar"</>}
            </span>
            {isSnapping && (
              <span style={{ fontSize: 11, background: '#fef9c3', color: '#78350f', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>
                📌 Snap à borda!
              </span>
            )}
          </div>

          {/* Adicionar vértice por coordenadas GPS */}
          <div style={{ marginTop: 10, padding: '8px 10px', background: '#fff8e1', border: '1px solid #fde68a', borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#78350f', marginBottom: 6 }}>📍 Adicionar vértice por coordenadas GPS:</div>
            {/* Botão GPS em tempo real */}
            <div style={{ marginBottom: 8 }}>
              <button type='button'
                disabled={gpsLoadingEdif}
                onClick={() => {
                  if (!navigator.geolocation) return
                  setGpsLoadingEdif(true)
                  navigator.geolocation.getCurrentPosition(
                    pos => {
                      setGpsLoadingEdif(false)
                      const lat = pos.coords.latitude
                      const lng = pos.coords.longitude
                      const transform = threeRef.current.transform
                      if (!transform) return
                      const pt = gpsToLocal(lat, lng, transform)
                      if (!pt) return
                      const newVerts = [...edificVertsRef3D.current, { x: pt.x, z: pt.z }]
                      edificVertsRef3D.current = newVerts
                      setEdificVerts3D([...newVerts])
                    },
                    () => setGpsLoadingEdif(false),
                    { enableHighAccuracy: true, timeout: 15000 }
                  )
                }}
                style={{
                  background: gpsLoadingEdif ? '#92400e' : '#d97706',
                  color: '#fff', border: 'none', borderRadius: 6,
                  padding: '6px 14px', fontSize: 12, fontWeight: 700,
                  cursor: gpsLoadingEdif ? 'wait' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                {gpsLoadingEdif ? '⏳ Capturando GPS...' : '📡 Usar GPS no Momento'}
              </button>
            </div>
            <div style={{ fontSize: 10, color: '#78350f', marginBottom: 6, fontWeight: 600 }}>— ou digitar as coordenadas manualmente:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type='number' step='any'
                value={coordLatInput}
                onChange={e => setCoordLatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addVertFromCoords() }}
                placeholder='Latitude (ex: -20.5236)'
                style={{ flex: '1 1 140px', fontSize: 12, padding: '5px 8px', border: '1.5px solid #fde68a', borderRadius: 6, background: '#fff', color: '#451a03', fontFamily: 'monospace', outline: 'none' }}
              />
              <input
                type='number' step='any'
                value={coordLngInput}
                onChange={e => setCoordLngInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addVertFromCoords() }}
                placeholder='Longitude (ex: -43.6919)'
                style={{ flex: '1 1 140px', fontSize: 12, padding: '5px 8px', border: '1.5px solid #fde68a', borderRadius: 6, background: '#fff', color: '#451a03', fontFamily: 'monospace', outline: 'none' }}
              />
              <button type='button' onClick={addVertFromCoords}
                disabled={!coordLatInput || !coordLngInput}
                style={{
                  background: coordLatInput && coordLngInput ? '#d97706' : '#e5e7eb',
                  color: coordLatInput && coordLngInput ? '#fff' : '#9ca3af',
                  border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: coordLatInput && coordLngInput ? 'pointer' : 'default',
                }}>
                + Adicionar
              </button>
            </div>
            {edificVerts3D.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 10, color: '#92400e' }}>
                {edificVerts3D.length} vértice(s) adicionado(s)
                {edificVerts3D.length >= 3 && <span style={{ marginLeft: 6, fontWeight: 700 }}>— use "Fechar Edificação" no topo</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Instrução — modo parede ─────────────────────────────── */}
      {modo === 'parede' && (
        <div style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', padding: '8px 14px', fontSize: 12, color: '#991b1b' }}>
          {parseInt(edificPavimentos) > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700 }}>🏢 Pavimento:</span>
              {Array.from({ length: parseInt(edificPavimentos) }, (_, i) => i + 1).map(f => (
                <button key={f} type='button' onClick={() => setSelectedFloor(f)}
                  style={{
                    background: selectedFloor === f ? '#dc2626' : '#fee2e2',
                    color: selectedFloor === f ? '#fff' : '#991b1b',
                    border: selectedFloor === f ? '1.5px solid #dc2626' : '1px solid #fca5a5',
                    borderRadius: 6, padding: '3px 11px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}>
                  {f}º
                </button>
              ))}
              {(() => {
                const totalH = parseFloat(edificAltura) > 0 ? parseFloat(edificAltura) : (parseFloat(altura) > 0 ? parseFloat(altura) : 3)
                const fH = (totalH / parseInt(edificPavimentos)).toFixed(1)
                return (
                  <span style={{ fontSize: 11, color: '#7f1d1d', background: '#fee2e2', borderRadius: 5, padding: '2px 7px' }}>
                    {selectedFloor}º pav. · {((selectedFloor - 1) * parseFloat(fH)).toFixed(1)}–{(selectedFloor * parseFloat(fH)).toFixed(1)} m
                  </span>
                )
              })()}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15 }}>🧱</span>
            <span>
              {!paredeStart
                ? <><strong>Clique no ponto inicial</strong> da parede — próximo à borda faz snap automático</>
                : <><strong>Ponto inicial marcado</strong> — clique onde a parede termina (linha reta)</>}
            </span>
            {isSnapping && (
              <span style={{ fontSize: 11, background: '#fee2e2', color: '#7f1d1d', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>
                📌 Snap à borda!
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Instrução — modo ponto ───────────────────────────────── */}
      {modo === 'ponto' && (
        <div style={{ background: '#eff6ff', borderBottom: '1px solid #bfdbfe', padding: '8px 14px', fontSize: 12, color: '#1e40af', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15 }}>📍</span>
          <span>Clique em uma <strong>parede ou piso</strong> para marcar o ponto <strong>T{nextNum}</strong>.</span>
        </div>
      )}

      {/* ── Instrução — modo linha: selecionar ponto ──────────── */}
      {modo === 'linha' && !linhaRefId && showPontoButton && (
        <div style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '8px 14px', fontSize: 12, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15 }}>✏️</span>
          <span style={{ fontWeight: 600 }}>Selecione o ponto ao qual esta trinca pertence:</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {anomalias.map(a => (
              <button key={a.id} type='button'
                onClick={() => { setLinhaRefId(a.id); linhaRefIdRef.current = a.id }}
                style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {a.nome}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Instrução — modo linha: traçar ────────────────────── */}
      {modo === 'linha' && linhaRefId && (
        <div style={{ background: '#fdf4ff', borderBottom: '1px solid #e9d5ff', padding: '8px 14px', fontSize: 12, color: '#6b21a8', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15 }}>✏️</span>
          <span>
            {linhaPts.length === 0
              ? 'Clique na parede ou piso para iniciar o traçado da trinca'
              : `${linhaPts.length} ponto(s) — continue clicando · "Concluir" para salvar`}
          </span>
        </div>
      )}

      {/* ── Canvas 3D ──────────────────────────────────────────── */}
      <div ref={mountRef} style={{
        width: '100%', lineHeight: 0,
        cursor: modo === 'edificacao' || modo === 'parede' ? 'crosshair' : modo ? 'crosshair' : 'grab',
        touchAction: 'none',
      }} />

      {/* ── Trincas do Monitoramento (referência somente leitura, azul) ── */}
      {monitoramentoAnomalias.length > 0 && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid #bfdbfe', background: '#eff6ff' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', marginBottom: 6 }}>
            🔵 Trincas de Relatórios Anteriores ({monitoramentoAnomalias.length}) — referência:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {monitoramentoAnomalias.map((a, i) => (
              <div key={a.id || i} style={{
                background: '#fff', border: '1px solid #93c5fd',
                borderRadius: 7, padding: '3px 10px', fontSize: 11, color: '#1e40af',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <span style={{ fontWeight: 700 }}>📍 {a.nome}</span>
                {a.linhasTrinca?.length >= 2 && (
                  <span style={{ opacity: 0.7, fontSize: 10 }}>↝ {a.linhasTrinca.length} pts</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Paredes da vistoria original (referência somente leitura) ── */}
      {vistoriaAnomalias.length > 0 && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid #fed7aa', background: '#fff7ed' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#c2410c', marginBottom: 6 }}>
            🔶 Paredes da Vistoria Residencial ({vistoriaAnomalias.length}) — referência:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {vistoriaAnomalias.map((a, i) => (
              <div key={a.id || i} style={{
                background: '#fff', border: '1px solid #fdba74',
                borderRadius: 7, padding: '3px 10px', fontSize: 11, color: '#9a3412',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <span style={{ fontWeight: 700 }}>
                  {a.type === 'parede-anomalia' ? '🧱' : '📍'} {a.nome}
                </span>
                <span style={{ opacity: 0.7, fontSize: 10 }}>
                  {a.type === 'parede-anomalia' ? 'Parede' : (a.localNome || faceLabel(a.face))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Lista de anomalias ──────────────────────────────────── */}
      {anomalias.length > 0 && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid #dbeafe', background: '#f8faff' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', marginBottom: 7 }}>
            Anomalias registradas ({anomalias.length}):
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {anomalias.map(a => (
              <div key={a.id} style={{
                background: '#fff1f2', border: '1px solid #fca5a5',
                borderRadius: 7, padding: '4px 6px 4px 10px', fontSize: 11, color: '#991b1b',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <span style={{ fontWeight: 700 }}>
                  {a.type === 'parede-anomalia' ? '🧱' : '📍'} {a.nome}
                </span>
                <span style={{ opacity: 0.7, fontSize: 10, background: '#fde8e8', borderRadius: 4, padding: '1px 5px' }}>
                  {a.type === 'parede-anomalia' ? 'Parede' : (a.localNome || faceLabel(a.face))}
                </span>
                {a.linhasTrinca && a.linhasTrinca.length >= 2 && (
                  <span style={{ opacity: 0.7, fontSize: 10 }}>↝ {a.linhasTrinca.length} pts</span>
                )}
                <button type='button' onClick={() => onRemoveAnomalia(a.id)}
                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 15, padding: '0 3px', lineHeight: 1 }}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
