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

export default function PhotoAnnotator({ imovelId, vistoria, activePhotoId, onVistoriaChange, onBack, defaultCrackCode = '' }) {
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
  }, [vistoria, activePhotoId])

  useEffect(() => {
    let stream = null
    if (showCameraDialog) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(s => { stream = s; if (videoRef.current) videoRef.current.srcObject = s })
        .catch(() => { showToast('Câmera não disponível', 'error'); setShowCameraDialog(false) })
    }
    return () => stream?.getTracks().forEach(t => t.stop())
  }, [showCameraDialog])

  const handleImageClick = (e) => {
    if (!imageRef.current || !activePhoto || activeTab !== 'pontos') return
    const rect = imageRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    const newPoint = { id: `p${Date.now()}`, codigo: `P${pontos.length + 1}`, x, y }
    setPontos(prev => [...prev, newPoint])
    showToast(`Ponto ${newPoint.codigo} adicionado`)
  }

  const handlePointClick = (e, pointId) => {
    e.stopPropagation()
    if (activeTab !== 'linhas') { showToast('Mude para a aba Linhas para conectar pontos'); return }
    const sel = selectedPoints.includes(pointId)
      ? selectedPoints.filter(id => id !== pointId)
      : [...selectedPoints, pointId]
    setSelectedPoints(sel)
    if (sel.length === 2) { setLineMeasure1(''); setLineMeasure2(''); setLineMeasure3(''); setShowLineDialog(true) }
  }

  const handleAddLine = () => {
    const parse = s => { const v = parseFloat((s || '').replace(',', '.')); return isNaN(v) ? null : v }
    const v1 = parse(lineMeasure1)
    const v2 = parse(lineMeasure2)
    const v3 = parse(lineMeasure3)
    const newLine = { id: `l${Date.now()}`, ponto1Id: selectedPoints[0], ponto2Id: selectedPoints[1], comprimentos: [v1, v2, v3] }
    setLinhas(prev => [...prev, newLine])
    setLineMeasure1(''); setLineMeasure2(''); setLineMeasure3('')
    setSelectedPoints([]); setShowLineDialog(false)
    showToast(v1 === null && v2 === null && v3 === null ? 'Linha adicionada (sem medidas — preencha depois ao editar)' : 'Linha adicionada')
  }

  const handleUndo = () => {
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
    const measuresText = valid.length > 0
      ? `Ø ${(valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2).replace('.', ',')} mm`
      : '— sem medida'
    return (
      <g key={line.id}>
        <line x1={`${p1.x}%`} y1={`${p1.y}%`} x2={`${p2.x}%`} y2={`${p2.y}%`} stroke="black" strokeWidth="2" />
        <text x={`${midX}%`} y={`${midY}%`} dy="-8" fill="white" fontSize="12" fontWeight="bold"
          textAnchor="middle" style={{ paintOrder: 'stroke', stroke: 'black', strokeWidth: '3px' }}>
          {measuresText}
        </text>
      </g>
    )
  }), [linhas, getPointById])

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

  return (
    <div className={styles.annotator}>
      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.msg}</div>}
      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className={styles.hidden} />
      <canvas ref={canvasRef} className={styles.hidden} />

      <div className={styles.toolbar}>
        <h2 className={styles.title}>Editando: <span className={styles.code}>{activePhoto.codigoTrinca}</span></h2>
        <div className={styles.tabs}>
          <button className={`${styles.tab} ${activeTab === 'pontos' ? styles.tabActive : ''}`} onClick={() => { setActiveTab('pontos'); setSelectedPoints([]) }}>📍 Pontos</button>
          <button className={`${styles.tab} ${activeTab === 'linhas' ? styles.tabActive : ''}`} onClick={() => { setActiveTab('linhas'); setSelectedPoints([]) }}>➖ Linhas</button>
        </div>
        <div className={styles.actions}>
          <button className={styles.btnIcon} onClick={handleUndo} title="Desfazer">↩</button>
          <button className={`${styles.btnIcon} ${styles.btnDanger}`} onClick={() => setShowDeletePhotoDialog(true)} title="Excluir Foto">🗑</button>
        </div>
      </div>

      <p className={styles.hint}>{activeTab === 'pontos' ? 'Clique na imagem para adicionar um ponto.' : 'Selecione dois pontos para criar uma linha e medir.'}</p>

      <div ref={imageRef} onClick={handleImageClick} className={`${styles.imageContainer} ${activeTab === 'pontos' ? styles.crosshair : ''}`}>
        <img src={activePhoto.url} alt={activePhoto.codigoTrinca} className={styles.img} />
        {pontos.map(point => (
          <div key={point.id} onClick={e => handlePointClick(e, point.id)}
            className={`${styles.point} ${activeTab === 'linhas' ? styles.pointClickable : ''} ${selectedPoints.includes(point.id) ? styles.pointSelected : ''}`}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}>
            {point.codigo}
          </div>
        ))}
        <svg className={styles.svg}>{memoizedLines}</svg>
      </div>

      <div className={styles.obsSection}>
        <label className={styles.label}>Observações</label>
        <textarea className={styles.textarea} value={observacao} onChange={e => setObservacao(e.target.value)} rows={3} placeholder="Descreva a anomalia..." />
      </div>

      <button className={styles.btnSave} onClick={handleSaveEdits}>💾 Salvar Anomalia e Voltar</button>

      {showLineDialog && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <h3>Registrar Fissura</h3>
            <p>Medidas em mm — <strong>opcional</strong>, pode deixar em branco e preencher depois ao editar.</p>
            <div className={styles.measureField}>
              <label className={styles.measureLabel}>Medida 1 (mm)</label>
              <input
                className={styles.input}
                type="text"
                value={lineMeasure1}
                onChange={e => setLineMeasure1(e.target.value.replace(/[^0-9,.]/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter') document.getElementById('fissura-m2')?.focus() }}
                placeholder="Deixe vazio se não souber"
                autoFocus
              />
            </div>
            <div className={styles.measureField}>
              <label className={styles.measureLabel}>Medida 2 (mm)</label>
              <input
                id="fissura-m2"
                className={styles.input}
                type="text"
                value={lineMeasure2}
                onChange={e => setLineMeasure2(e.target.value.replace(/[^0-9,.]/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter') document.getElementById('fissura-m3')?.focus() }}
                placeholder="Deixe vazio se não souber"
              />
            </div>
            <div className={styles.measureField}>
              <label className={styles.measureLabel}>Medida 3 (mm)</label>
              <input
                id="fissura-m3"
                className={styles.input}
                type="text"
                value={lineMeasure3}
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
              <button className={styles.btnCancel} onClick={() => { setSelectedPoints([]); setShowLineDialog(false) }}>Cancelar</button>
              <button className={styles.btnPrimary} onClick={handleAddLine}>Salvar Linha</button>
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
