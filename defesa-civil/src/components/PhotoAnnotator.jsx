import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import styles from './PhotoAnnotator.module.css'
import { API_BASE } from '../services/api'

function dataURLtoBlob(dataurl) {
  const arr = dataurl.split(',')
  const mime = arr[0].match(/:(.*?);/)[1]
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) u8arr[n] = bstr.charCodeAt(n)
  return new Blob([u8arr], { type: mime })
}

function compressImage(dataUrl, maxW = 1200) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width)
      const w = img.width * scale
      const h = img.height * scale
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.75))
    }
    img.src = dataUrl
  })
}

const M2_COLORS = { a: '#22c55e', b: '#3b82f6', c: '#f97316' }

export default function PhotoAnnotator({ imovelId, vistoria, activePhotoId, onVistoriaChange, onBack, defaultCrackCode = '', metodo = 1 }) {
  const [activePhoto, setActivePhoto] = useState(null)
  const [pontos, setPontos] = useState([])
  const [linhas, setLinhas] = useState([])
  const [observacao, setObservacao] = useState('')
  const [selectedPoints, setSelectedPoints] = useState([])
  const [activeTab, setActiveTab] = useState('pontos')

  const [showSourceDialog, setShowSourceDialog] = useState(false)
  const [showCameraDialog, setShowCameraDialog] = useState(false)
  const [showCrackCodeDialog, setShowCrackCodeDialog] = useState(false)
  const [showLineDialog, setShowLineDialog] = useState(false)
  const [showDeletePhotoDialog, setShowDeletePhotoDialog] = useState(false)

  const [newlyCapturedImage, setNewlyCapturedImage] = useState(null)
  const [crackCode, setCrackCode] = useState('')
  const [lineMeasure1, setLineMeasure1] = useState('')
  const [lineMeasure2, setLineMeasure2] = useState('')
  const [lineMeasure3, setLineMeasure3] = useState('')
  const [editingLineId, setEditingLineId] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [toast, setToast] = useState(null)

  const imageRef = useRef(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    if (activePhotoId !== 'new') {
      const foto = vistoria?.fotosAnomalias?.find(f => f.id === activePhotoId)
      if (foto) {
        setActivePhoto(foto)
        setPontos(foto.pontos || [])
        setLinhas(foto.linhas || [])
        setObservacao(foto.observacao || '')
      } else {
        setActivePhoto(null); setPontos([]); setLinhas([]); setObservacao('')
      }
    } else {
      setActivePhoto(null); setPontos([]); setLinhas([]); setObservacao('')
      setShowSourceDialog(true)
    }
    setSelectedPoints([])
  }, [activePhotoId])

  useEffect(() => {
    if (!showCameraDialog) return
    let stream
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then(s => { stream = s; if (videoRef.current) videoRef.current.srcObject = s })
      .catch(() => showToast('Câmera não disponível', 'error'))
    return () => stream?.getTracks().forEach(t => t.stop())
  }, [showCameraDialog])

  const handleImageClick = (e) => {
    if (!imageRef.current || !activePhoto || activeTab !== 'pontos') return

    if (metodo === 2) {
      if (pontos.length >= 3) { showToast('Máximo 3 pontos no Método 2 (Triângulo)', 'error'); return }
      const rect = imageRef.current.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100
      const codigo = String(pontos.length + 1)
      const newPoint = { id: `p${Date.now()}`, codigo, x, y }
      const newPontos = [...pontos, newPoint]
      setPontos(newPontos)
      showToast(`Ponto ${codigo} marcado`)

      if (newPontos.length === 3) {
        const [p1, p2, p3] = newPontos
        const ts = Date.now()
        setLinhas([
          { id: `l${ts}`,   ponto1Id: p1.id, ponto2Id: p2.id, nome: 'a', comprimentos: [null, null, null] },
          { id: `l${ts+1}`, ponto1Id: p1.id, ponto2Id: p3.id, nome: 'b', comprimentos: [null, null, null] },
          { id: `l${ts+2}`, ponto1Id: p2.id, ponto2Id: p3.id, nome: 'c', comprimentos: [null, null, null] },
        ])
        setActiveTab('linhas')
        showToast('3 pontos marcados! Preencha as medidas a, b e c.')
      }
      return
    }

    const rect = imageRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    const newPoint = { id: `p${Date.now()}`, codigo: `P${pontos.length + 1}`, x, y }
    setPontos(prev => [...prev, newPoint])
    showToast(`Ponto ${newPoint.codigo} adicionado`)
  }

  const handlePointClick = (e, pointId) => {
    e.stopPropagation()
    if (metodo === 2) return
    if (activeTab !== 'linhas') { showToast('Mude para a aba Linhas para conectar pontos'); return }
    const sel = selectedPoints.includes(pointId)
      ? selectedPoints.filter(id => id !== pointId)
      : [...selectedPoints, pointId]
    setSelectedPoints(sel)
    if (sel.length === 2) { setLineMeasure1(''); setLineMeasure2(''); setLineMeasure3(''); setEditingLineId(null); setShowLineDialog(true) }
  }

  const openEditLine = (linha) => {
    setEditingLineId(linha.id)
    setLineMeasure1(typeof linha.comprimentos?.[0] === 'number' ? String(linha.comprimentos[0]) : '')
    setLineMeasure2(typeof linha.comprimentos?.[1] === 'number' ? String(linha.comprimentos[1]) : '')
    setLineMeasure3(typeof linha.comprimentos?.[2] === 'number' ? String(linha.comprimentos[2]) : '')
    setShowLineDialog(true)
  }

  const handleAddLine = () => {
    const parse = s => { const v = parseFloat((s || '').replace(',', '.')); return isNaN(v) ? null : v }
    const v1 = parse(lineMeasure1)
    const v2 = parse(lineMeasure2)
    const v3 = parse(lineMeasure3)

    if (editingLineId) {
      setLinhas(prev => prev.map(l => l.id === editingLineId ? { ...l, comprimentos: [v1, v2, v3] } : l))
      setEditingLineId(null)
      showToast('Medidas salvas')
    } else {
      const newLine = { id: `l${Date.now()}`, ponto1Id: selectedPoints[0], ponto2Id: selectedPoints[1], comprimentos: [v1, v2, v3] }
      setLinhas(prev => [...prev, newLine])
      showToast(v1 === null && v2 === null && v3 === null ? 'Linha adicionada (sem medidas — preencha depois ao editar)' : 'Linha adicionada')
    }
    setLineMeasure1(''); setLineMeasure2(''); setLineMeasure3('')
    setSelectedPoints([]); setShowLineDialog(false)
  }

  const handleUndo = () => {
    if (metodo === 2) {
      if (pontos.length === 3) {
        setPontos(prev => prev.slice(0, 2))
        setLinhas([])
        setActiveTab('pontos')
        showToast('Ponto 3 removido')
      } else if (pontos.length > 0) {
        setPontos(prev => prev.slice(0, -1))
        showToast('Ponto removido')
      }
      return
    }
    const lastLineTime = linhas.length > 0 ? parseInt(linhas[linhas.length - 1].id.replace('l', '')) : 0
    const lastPointTime = pontos.length > 0 ? parseInt(pontos[pontos.length - 1].id.replace('p', '')) : 0
    if (lastLineTime > lastPointTime) { setLinhas(prev => prev.slice(0, -1)); showToast('Linha removida') }
    else if (lastPointTime > 0) {
      const lastId = pontos[pontos.length - 1].id
      setLinhas(prev => prev.filter(l => l.ponto1Id !== lastId && l.ponto2Id !== lastId))
      setPontos(prev => prev.slice(0, -1)); showToast('Ponto removido')
    }
  }

  const savePhotoWithCode = async (imageDataUrl, code) => {
    setIsSaving(true)
    const trimmedCode = code.trim().toUpperCase()
    const isDuplicate = vistoria?.fotosAnomalias?.some(f => f.codigoTrinca.toLowerCase() === trimmedCode.toLowerCase())
    if (isDuplicate) { showToast('Código já existe. Use um código único.', 'error'); setIsSaving(false); return }
    try {
      const resp = await fetch(`${API_BASE}/monitoramento/${imovelId}/fotos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: imageDataUrl, codigoTrinca: trimmedCode })
      })
      const result = await resp.json()
      if (!result.success) throw new Error(result.error || 'Erro ao salvar foto')
      const newPhoto = { id: `foto${Date.now()}`, url: result.url, codigoTrinca: trimmedCode, pontos: [], linhas: [], observacao: '' }
      const updated = { ...vistoria, fotosAnomalias: [...(vistoria.fotosAnomalias || []), newPhoto] }
      onVistoriaChange(updated)
      showToast(`Foto ${trimmedCode} adicionada`)
      setShowCrackCodeDialog(false); setNewlyCapturedImage(null); setCrackCode('')
      onBack()
    } catch (err) { showToast(err.message, 'error') }
    finally { setIsSaving(false) }
  }

  const handleSaveCrackCode = async () => {
    if (!crackCode.trim() || !newlyCapturedImage) return
    await savePhotoWithCode(newlyCapturedImage, crackCode)
  }

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return
    const v = videoRef.current; const c = canvasRef.current
    c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    v.srcObject?.getTracks().forEach(t => t.stop()); v.srcObject = null
    const imgData = c.toDataURL('image/jpeg', 0.9)
    setShowCameraDialog(false)
    if (defaultCrackCode) {
      setNewlyCapturedImage(imgData)
      savePhotoWithCode(imgData, defaultCrackCode)
    } else {
      setNewlyCapturedImage(imgData); setCrackCode(defaultCrackCode || ''); setShowCrackCodeDialog(true)
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target.result)
      if (defaultCrackCode) {
        setNewlyCapturedImage(compressed)
        savePhotoWithCode(compressed, defaultCrackCode)
      } else {
        setNewlyCapturedImage(compressed); setCrackCode(defaultCrackCode || ''); setShowCrackCodeDialog(true)
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleSaveEdits = () => {
    if (!activePhoto) return
    const updatedPhoto = { ...activePhoto, pontos, linhas, observacao }
    const updatedFotos = (vistoria.fotosAnomalias || []).map(p => p.id === activePhoto.id ? updatedPhoto : p)
    onVistoriaChange({ ...vistoria, fotosAnomalias: updatedFotos })
    showToast('Anomalia salva')
    onBack()
  }

  const handleDeletePhoto = () => {
    const updatedFotos = (vistoria.fotosAnomalias || []).filter(f => f.id !== activePhoto.id)
    onVistoriaChange({ ...vistoria, fotosAnomalias: updatedFotos })
    showToast('Foto removida')
    setShowDeletePhotoDialog(false); onBack()
  }

  const getPointById = useCallback((id) => pontos.find(p => p.id === id), [pontos])

  const memoizedLines = useMemo(() => linhas.map(line => {
    const p1 = getPointById(line.ponto1Id)
    const p2 = getPointById(line.ponto2Id)
    if (!p1 || !p2) return null
    const midX = (p1.x + p2.x) / 2
    const midY = (p1.y + p2.y) / 2
    const valid = (line.comprimentos || []).filter(c => typeof c === 'number' && c !== null && !isNaN(c) && c > 0)
    const avg = valid.length > 0
      ? (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2).replace('.', ',')
      : null
    const lineColor = (metodo === 2 && line.nome) ? (M2_COLORS[line.nome] || 'black') : 'black'
    const lineLabel = metodo === 2 && line.nome
      ? (avg ? `${line.nome}: Ø ${avg} mm` : line.nome)
      : (avg ? `Ø ${avg} mm` : '— sem medida')
    return (
      <g key={line.id}>
        <line
          x1={`${p1.x}%`} y1={`${p1.y}%`}
          x2={`${p2.x}%`} y2={`${p2.y}%`}
          stroke={lineColor} strokeWidth="2.5"
          strokeDasharray={metodo === 2 ? '8,4' : undefined}
        />
        <text
          x={`${midX}%`} y={`${midY}%`} dy="-8"
          fill="white" fontSize="13" fontWeight="bold"
          textAnchor="middle"
          style={{ paintOrder: 'stroke', stroke: lineColor, strokeWidth: '3px' }}
        >
          {lineLabel}
        </text>
      </g>
    )
  }), [linhas, getPointById, metodo])

  if (activePhotoId === 'new') {
    return (
      <div>
        {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.msg}</div>}
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className={styles.hidden} />
        <canvas ref={canvasRef} className={styles.hidden} />

        {isSaving && (
          <div className={styles.overlay}>
            <div className={styles.dialog} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
              <p style={{ fontWeight: 600 }}>Salvando foto {defaultCrackCode}...</p>
            </div>
          </div>
        )}

        {showSourceDialog && (
          <div className={styles.overlay}>
            <div className={styles.dialog}>
              {defaultCrackCode && (
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 14px', fontSize: 13 }}>
                  📷 Adicionar foto da anomalia <strong style={{ color: '#1d4ed8' }}>{defaultCrackCode}</strong>
                  {metodo === 2 && <span style={{ marginLeft: 8, color: '#16a34a', fontWeight: 600 }}>— Método Triângulo</span>}
                </div>
              )}
              <h3>Fonte da Imagem</h3>
              <p>Escolha de onde adicionar a imagem.</p>
              <div className={styles.dialogBtns}>
                <button className={styles.btnOutline} onClick={() => { setShowSourceDialog(false); setShowCameraDialog(true) }}>📷 Tirar Foto</button>
                <button className={styles.btnOutline} onClick={() => { setShowSourceDialog(false); fileInputRef.current?.click() }}>📁 Da Galeria</button>
              </div>
              <button className={styles.btnCancel} onClick={() => { setShowSourceDialog(false); onBack() }}>Cancelar</button>
            </div>
          </div>
        )}
        {showCameraDialog && (
          <div className={styles.overlay}>
            <div className={styles.dialog}>
              <h3>Capturar Foto — {defaultCrackCode || 'Nova Anomalia'}</h3>
              <video ref={videoRef} className={styles.video} autoPlay muted playsInline />
              <div className={styles.dialogBtns}>
                <button className={styles.btnCancel} onClick={() => { videoRef.current?.srcObject?.getTracks().forEach(t => t.stop()); setShowCameraDialog(false); onBack() }}>Cancelar</button>
                <button className={styles.btnPrimary} onClick={handleCapture}>Capturar</button>
              </div>
            </div>
          </div>
        )}
        {showCrackCodeDialog && (
          <div className={styles.overlay}>
            <div className={styles.dialog}>
              <h3>Código da Anomalia</h3>
              <p>Insira um código único (ex: T1, T2, T3)</p>
              {newlyCapturedImage && <img src={newlyCapturedImage} alt="preview" className={styles.previewImg} />}
              <input className={styles.input} value={crackCode} onChange={e => setCrackCode(e.target.value.toUpperCase())} placeholder="Ex: T1" />
              <div className={styles.dialogBtns}>
                <button className={styles.btnCancel} onClick={() => { setShowCrackCodeDialog(false); setNewlyCapturedImage(null); onBack() }} disabled={isSaving}>Cancelar</button>
                <button className={styles.btnPrimary} onClick={handleSaveCrackCode} disabled={isSaving || !crackCode.trim()}>{isSaving ? 'Salvando...' : 'Salvar Foto'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (!activePhoto) return <div className={styles.loading}>Carregando anomalia...</div>

  const fmtVal = (c) => (typeof c === 'number' && c > 0) ? `${c.toFixed(2).replace('.', ',')} mm` : '—'

  return (
    <div className={styles.annotator}>
      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.msg}</div>}
      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className={styles.hidden} />
      <canvas ref={canvasRef} className={styles.hidden} />

      <div className={styles.toolbar}>
        <h2 className={styles.title}>
          Editando: <span className={styles.code}>{activePhoto.codigoTrinca}</span>
          {metodo === 2 && <span style={{ marginLeft: 10, fontSize: 12, background: '#16a34a', color: '#fff', borderRadius: 5, padding: '2px 8px', fontWeight: 600 }}>Triângulo</span>}
        </h2>
        <div className={styles.tabs}>
          <button className={`${styles.tab} ${activeTab === 'pontos' ? styles.tabActive : ''}`} onClick={() => { setActiveTab('pontos'); setSelectedPoints([]) }}>
            📍 Pontos{metodo === 2 ? ` (${pontos.length}/3)` : ''}
          </button>
          <button className={`${styles.tab} ${activeTab === 'linhas' ? styles.tabActive : ''}`} onClick={() => { setActiveTab('linhas'); setSelectedPoints([]) }}>
            {metodo === 2 ? '📐 Medidas (a, b, c)' : '➖ Linhas'}
          </button>
        </div>
        <div className={styles.actions}>
          <button className={styles.btnIcon} onClick={handleUndo} title="Desfazer">↩</button>
          <button className={`${styles.btnIcon} ${styles.btnDanger}`} onClick={() => setShowDeletePhotoDialog(true)} title="Excluir Foto">🗑</button>
        </div>
      </div>

      <p className={styles.hint}>
        {metodo === 2
          ? (activeTab === 'pontos'
              ? (pontos.length < 3
                  ? `Clique na imagem para marcar o ponto ${pontos.length + 1} de 3.`
                  : '3 pontos marcados — vá para a aba 📐 Medidas.')
              : (pontos.length < 3
                  ? 'Marque os 3 pontos na aba 📍 Pontos primeiro.'
                  : 'Clique em Editar para inserir as medidas de cada linha.'))
          : (activeTab === 'pontos'
              ? 'Clique na imagem para adicionar um ponto.'
              : 'Selecione dois pontos para criar uma linha e medir.')}
      </p>

      <div ref={imageRef} onClick={handleImageClick} className={`${styles.imageContainer} ${activeTab === 'pontos' && (metodo !== 2 || pontos.length < 3) ? styles.crosshair : ''}`}>
        <img src={activePhoto.url} alt={activePhoto.codigoTrinca} className={styles.img} />
        {pontos.map(point => (
          <div key={point.id} onClick={e => handlePointClick(e, point.id)}
            className={`${styles.point} ${activeTab === 'linhas' && metodo !== 2 ? styles.pointClickable : ''} ${selectedPoints.includes(point.id) ? styles.pointSelected : ''}`}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}>
            {point.codigo}
          </div>
        ))}
        <svg className={styles.svg}>{memoizedLines}</svg>
      </div>

      {/* ── Método 2: cards de medidas a, b, c ── */}
      {metodo === 2 && activeTab === 'linhas' && (
        <div style={{ marginTop: 14 }}>
          {pontos.length < 3 ? (
            <div style={{ textAlign: 'center', padding: '20px 16px', color: '#64748b', background: '#f8fafc', border: '1.5px dashed #cbd5e1', borderRadius: 10 }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>📍</div>
              <p style={{ margin: 0, fontWeight: 600 }}>Marque os 3 pontos primeiro</p>
              <p style={{ margin: '4px 0 0', fontSize: 13 }}>{pontos.length}/3 pontos marcados — volte para a aba 📍 Pontos</p>
            </div>
          ) : (
            linhas.map(linha => {
              const p1 = getPointById(linha.ponto1Id)
              const p2 = getPointById(linha.ponto2Id)
              const valid = (linha.comprimentos || []).filter(c => typeof c === 'number' && c > 0)
              const avg = valid.length ? (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2).replace('.', ',') : '—'
              const cor = M2_COLORS[linha.nome] || '#64748b'
              return (
                <div key={linha.id} style={{ border: `2.5px solid ${cor}`, borderRadius: 12, padding: '12px 16px', marginBottom: 10, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <span style={{ color: cor, fontWeight: 800, fontSize: 20 }}>Medida {linha.nome?.toUpperCase()}</span>
                      <span style={{ color: '#64748b', fontSize: 13, marginLeft: 8 }}>({p1?.codigo} → {p2?.codigo})</span>
                    </div>
                    <button
                      onClick={() => openEditLine(linha)}
                      style={{ background: cor, color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                      ✏️ Editar
                    </button>
                  </div>
                  <div style={{ fontSize: 13, color: '#334155', display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                    <span>M1: <strong>{fmtVal(linha.comprimentos?.[0])}</strong></span>
                    <span>M2: <strong>{fmtVal(linha.comprimentos?.[1])}</strong></span>
                    <span>M3: <strong>{fmtVal(linha.comprimentos?.[2])}</strong></span>
                    <span style={{ color: cor, fontWeight: 700 }}>Média: {avg} {avg !== '—' ? 'mm' : ''}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      <div className={styles.obsSection}>
        <label className={styles.label}>Observações</label>
        <textarea className={styles.textarea} value={observacao} onChange={e => setObservacao(e.target.value)} rows={3} placeholder="Descreva a anomalia..." />
      </div>

      <button className={styles.btnSave} onClick={handleSaveEdits}>💾 Salvar Anomalia e Voltar</button>

      {showLineDialog && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            {editingLineId ? (
              <>
                {(() => {
                  const linha = linhas.find(l => l.id === editingLineId)
                  const cor = M2_COLORS[linha?.nome] || '#1d4ed8'
                  return (
                    <h3 style={{ color: cor }}>
                      Medidas — Linha {linha?.nome?.toUpperCase() || ''}
                    </h3>
                  )
                })()}
              </>
            ) : (
              <h3>Registrar Fissura</h3>
            )}
            <p>Medidas em mm — <strong>opcional</strong>, pode deixar em branco e preencher depois ao editar.</p>
            <div className={styles.measureField}>
              <label className={styles.measureLabel}>Medida 1 (mm)</label>
              <input
                className={styles.input} type="text" value={lineMeasure1}
                onChange={e => setLineMeasure1(e.target.value.replace(/[^0-9,.]/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter') document.getElementById('fissura-m2')?.focus() }}
                placeholder="Deixe vazio se não souber" autoFocus
              />
            </div>
            <div className={styles.measureField}>
              <label className={styles.measureLabel}>Medida 2 (mm)</label>
              <input
                id="fissura-m2" className={styles.input} type="text" value={lineMeasure2}
                onChange={e => setLineMeasure2(e.target.value.replace(/[^0-9,.]/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter') document.getElementById('fissura-m3')?.focus() }}
                placeholder="Deixe vazio se não souber"
              />
            </div>
            <div className={styles.measureField}>
              <label className={styles.measureLabel}>Medida 3 (mm)</label>
              <input
                id="fissura-m3" className={styles.input} type="text" value={lineMeasure3}
                onChange={e => setLineMeasure3(e.target.value.replace(/[^0-9,.]/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter') handleAddLine() }}
                placeholder="Deixe vazio se não souber"
              />
            </div>
            {(() => {
              const v1 = parseFloat(lineMeasure1.replace(',', '.'))
              const v2 = parseFloat(lineMeasure2.replace(',', '.'))
              const v3 = parseFloat(lineMeasure3.replace(',', '.'))
              const valid = [v1, v2, v3].filter(v => !isNaN(v) && v > 0)
              if (valid.length > 0) {
                const avg = (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2).replace('.', ',')
                return (
                  <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#1d4ed8', fontWeight: 700, textAlign: 'center' }}>
                    Média: Ø {avg} mm ({valid.length} medida{valid.length > 1 ? 's' : ''})
                  </div>
                )
              }
              return null
            })()}
            <div className={styles.dialogBtns}>
              <button className={styles.btnCancel} onClick={() => { setSelectedPoints([]); setEditingLineId(null); setShowLineDialog(false) }}>Cancelar</button>
              <button className={styles.btnPrimary} onClick={handleAddLine}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {showDeletePhotoDialog && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <h3>Excluir Foto</h3>
            <p>Tem certeza que deseja excluir a anomalia <strong>{activePhoto.codigoTrinca}</strong>? Esta ação não pode ser desfeita.</p>
            <div className={styles.dialogBtns}>
              <button className={styles.btnCancel} onClick={() => setShowDeletePhotoDialog(false)}>Cancelar</button>
              <button className={`${styles.btnPrimary} ${styles.btnDangerFull}`} onClick={handleDeletePhoto}>Sim, Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
