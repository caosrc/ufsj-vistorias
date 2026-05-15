import { useState, useEffect, useRef, useCallback } from 'react'
import { FiWifi, FiWifiOff, FiDownloadCloud, FiCheckCircle,
         FiAlertCircle, FiTrash2, FiX, FiSmartphone, FiRefreshCw } from 'react-icons/fi'

// ── Cálculo de tiles para bbox ──────────────────────────────────
function lng2tile(lng, z) {
  return Math.floor((lng + 180) / 360 * Math.pow(2, z))
}
function lat2tile(lat, z) {
  const r = lat * Math.PI / 180
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z))
}

function generateTileUrls(bbox, minZ, maxZ) {
  const [minLat, maxLat, minLng, maxLng] = bbox
  const urls = []

  const providers = [
    z => (x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    z => (x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    z => (x, y) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`,
  ]

  for (let z = minZ; z <= maxZ; z++) {
    const xMin = lng2tile(minLng, z), xMax = lng2tile(maxLng, z)
    const yMin = lat2tile(maxLat, z), yMax = lat2tile(minLat, z)

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        providers.forEach(p => urls.push(p(z)(x, y)))
      }
    }
  }
  return urls
}

// Bbox das duas cidades com margem
const CITIES_BBOX = [-20.78, -20.32, -44.10, -43.48]

const ZOOM_PRESETS = [
  { label: 'Rápido (zoom 8–11)', minZ: 8, maxZ: 11, desc: '~120 tiles, ~3 MB' },
  { label: 'Completo (zoom 8–13)', minZ: 8, maxZ: 13, desc: '~550 tiles, ~12 MB' },
  { label: 'Detalhado (zoom 8–14)', minZ: 8, maxZ: 14, desc: '~1800 tiles, ~40 MB' },
]

// ── Componente principal ─────────────────────────────────────────
export default function OfflineManager() {
  const [isOnline,     setIsOnline]     = useState(navigator.onLine)
  const [swReady,      setSwReady]      = useState(false)
  const [open,         setOpen]         = useState(false)
  const [phase,        setPhase]        = useState('idle') // idle | caching | done | error
  const [progress,     setProgress]     = useState({ done: 0, total: 0 })
  const [cacheStats,   setCacheStats]   = useState(null)
  const [selectedZoom, setSelectedZoom] = useState(0)
  const [installPrompt,setInstallPrompt]= useState(null)
  const [installed,    setInstalled]    = useState(false)
  const [swUpdate,     setSwUpdate]     = useState(false)
  const channelRef = useRef(null)

  // Detectar online/offline
  useEffect(() => {
    const goOn  = () => setIsOnline(true)
    const goOff = () => setIsOnline(false)
    window.addEventListener('online',  goOn)
    window.addEventListener('offline', goOff)
    return () => { window.removeEventListener('online', goOn); window.removeEventListener('offline', goOff) }
  }, [])

  // Detectar SW registrado
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(() => setSwReady(true))
    }
    window.addEventListener('sw-update-available', () => setSwUpdate(true))
    return () => window.removeEventListener('sw-update-available', () => {})
  }, [])

  // Detectar prompt de instalação PWA
  useEffect(() => {
    const handler = e => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => { setInstalled(true); setInstallPrompt(null) })
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  // Buscar stats do cache ao abrir
  useEffect(() => {
    if (!open || !swReady) return
    getCacheStats().then(setCacheStats)
  }, [open, swReady, phase])

  async function getCacheStats() {
    if (!('serviceWorker' in navigator)) return null
    const sw = await navigator.serviceWorker.ready
    if (!sw.active) return null
    return new Promise(resolve => {
      const mc = new MessageChannel()
      mc.port1.onmessage = e => {
        if (e.data?.type === 'CACHE_STATUS_RESULT') resolve(e.data)
      }
      sw.active.postMessage({ type: 'CACHE_STATUS' }, [mc.port2])
      setTimeout(() => resolve(null), 3000)
    })
  }

  // Instalar PWA
  async function instalarApp() {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') { setInstalled(true); setInstallPrompt(null) }
  }

  // Iniciar pré-cache de tiles
  async function iniciarCache() {
    if (!swReady) return
    const preset = ZOOM_PRESETS[selectedZoom]
    const urls   = generateTileUrls(CITIES_BBOX, preset.minZ, preset.maxZ)

    setPhase('caching')
    setProgress({ done: 0, total: urls.length })

    const sw = await navigator.serviceWorker.ready
    if (!sw.active) { setPhase('error'); return }

    const mc = new MessageChannel()
    mc.port1.onmessage = e => {
      if (e.data?.type === 'TILE_PROGRESS') {
        setProgress({ done: e.data.done, total: e.data.total })
      }
      if (e.data?.type === 'TILE_DONE') {
        setProgress({ done: e.data.done, total: e.data.total })
        setPhase('done')
        getCacheStats().then(setCacheStats)
      }
    }
    sw.active.postMessage({ type: 'PRECACHE_TILES', urls }, [mc.port2])
  }

  // Limpar cache de tiles
  async function limparTiles() {
    if (!swReady) return
    const sw = await navigator.serviceWorker.ready
    if (!sw.active) return
    const mc = new MessageChannel()
    mc.port1.onmessage = () => {
      setPhase('idle')
      setCacheStats(s => s ? { ...s, tiles: 0 } : null)
    }
    sw.active.postMessage({ type: 'CLEAR_TILES' }, [mc.port2])
  }

  // Recarregar para aplicar atualização
  function aplicarAtualizacao() {
    window.location.reload()
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <>
      {/* Banner offline */}
      {!isOnline && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
          background: 'linear-gradient(90deg, #1a0000, #450a0a)',
          borderBottom: '1px solid #7f1d1d',
          padding: '9px 16px',
          display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center',
        }}>
          <FiWifiOff size={15} color='#fca5a5'/>
          <span style={{ color: '#fca5a5', fontSize: 13, fontWeight: 600 }}>
            Sem conexão — usando dados salvos localmente
          </span>
        </div>
      )}

      {/* Banner de atualização disponível */}
      {swUpdate && (
        <div style={{
          position: 'fixed', top: isOnline ? 0 : 40, left: 0, right: 0, zIndex: 99998,
          background: 'linear-gradient(90deg, #0c2340, #1e3a5f)',
          borderBottom: '1px solid #3b82f6',
          padding: '9px 16px',
          display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center',
        }}>
          <FiRefreshCw size={14} color='#93c5fd'/>
          <span style={{ color: '#93c5fd', fontSize: 13 }}>
            Nova versão disponível
          </span>
          <button onClick={aplicarAtualizacao} style={{
            background: '#2563eb', border: 'none', color: '#fff',
            borderRadius: 6, padding: '3px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>Atualizar agora</button>
          <button onClick={() => setSwUpdate(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
            <FiX size={14}/>
          </button>
        </div>
      )}

      {/* Botão flutuante de acesso rápido */}
      <button
        onClick={() => setOpen(o => !o)}
        title={isOnline ? 'Gerenciar modo offline' : 'Offline — dados locais ativos'}
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9998,
          width: 46, height: 46, borderRadius: '50%',
          background: isOnline ? '#0f2044' : '#450a0a',
          border: `2px solid ${isOnline ? '#3b82f6' : '#ef4444'}`,
          color: isOnline ? '#93c5fd' : '#fca5a5',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          transition: 'all 0.2s',
        }}
      >
        {isOnline ? <FiDownloadCloud size={20}/> : <FiWifiOff size={20}/>}
        {/* Indicador de phase */}
        {phase === 'caching' && (
          <span style={{
            position: 'absolute', top: -4, right: -4, width: 14, height: 14,
            borderRadius: '50%', background: '#3b82f6',
            animation: 'swPulse 1s infinite',
          }}/>
        )}
        {phase === 'done' && (
          <span style={{
            position: 'absolute', top: -4, right: -4, width: 14, height: 14,
            borderRadius: '50%', background: '#22c55e',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: '#fff', fontWeight: 900,
          }}>✓</span>
        )}
      </button>

      {/* Painel de gestão offline */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 74, right: 20, zIndex: 9997,
          width: 320, background: '#0f172a',
          border: '1px solid #1e3a5f', borderRadius: 14,
          boxShadow: '0 12px 50px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}>
          {/* Cabeçalho */}
          <div style={{
            background: 'linear-gradient(135deg, #0f2040, #1e3a5f)',
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid #1e3a5f',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isOnline
                ? <FiWifi size={16} color='#22c55e'/>
                : <FiWifiOff size={16} color='#ef4444'/>
              }
              <span style={{ color: '#f0f9ff', fontWeight: 700, fontSize: 14 }}>
                Uso Offline
              </span>
              <span style={{
                background: isOnline ? '#064e3b' : '#450a0a',
                color:      isOnline ? '#6ee7b7' : '#fca5a5',
                borderRadius: 6, padding: '1px 8px', fontSize: 11, fontWeight: 600,
              }}>{isOnline ? 'Online' : 'Offline'}</span>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
              <FiX size={16}/>
            </button>
          </div>

          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Stats do cache */}
            {cacheStats && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { label: 'Tiles', value: cacheStats.tiles, color: '#38bdf8' },
                  { label: 'APIs', value: cacheStats.api, color: '#a78bfa' },
                  { label: 'App', value: cacheStats.app, color: '#22c55e' },
                ].map(s => (
                  <div key={s.label} style={{
                    background: '#1e293b', borderRadius: 8, padding: '8px 10px', textAlign: 'center',
                  }}>
                    <div style={{ color: s.color, fontWeight: 800, fontSize: 18 }}>{s.value}</div>
                    <div style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Instalar PWA */}
            {!installed && (installPrompt || /iPad|iPhone|iPod|Android/.test(navigator.userAgent)) && (
              <div style={{
                background: '#1e293b', border: '1px solid #3b82f6',
                borderRadius: 10, padding: '12px 14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <FiSmartphone size={14} color='#38bdf8'/>
                  <span style={{ color: '#93c5fd', fontWeight: 700, fontSize: 13 }}>Instalar no dispositivo</span>
                </div>
                <p style={{ color: '#64748b', fontSize: 11, margin: '0 0 10px' }}>
                  Instale o Geovistorias como app nativo para acesso rápido mesmo sem internet.
                </p>
                <button onClick={instalarApp} style={{
                  width: '100%', background: '#1d4ed8', border: 'none', color: '#fff',
                  borderRadius: 8, padding: '9px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}>
                  <FiSmartphone size={13} style={{ marginRight: 6, verticalAlign: 'middle' }}/>
                  Instalar App
                </button>
              </div>
            )}
            {installed && (
              <div style={{
                background: '#064e3b', border: '1px solid #065f46', borderRadius: 8,
                padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6ee7b7',
              }}>
                <FiCheckCircle size={14}/> App instalado no dispositivo
              </div>
            )}

            {/* Pré-cache de tiles */}
            <div style={{
              background: '#1e293b', border: '1px solid #1e3a5f',
              borderRadius: 10, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <FiDownloadCloud size={14} color='#a78bfa'/>
                <span style={{ color: '#c4b5fd', fontWeight: 700, fontSize: 13 }}>Salvar mapas para offline</span>
              </div>
              <p style={{ color: '#64748b', fontSize: 11, margin: '0 0 10px', lineHeight: 1.5 }}>
                Baixa os tiles de Ouro Branco e Congonhas (OSM + Satélite + Topográfico).
              </p>

              {phase !== 'caching' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                    {ZOOM_PRESETS.map((p, i) => (
                      <label key={i} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        cursor: 'pointer', padding: '6px 8px',
                        background: selectedZoom === i ? '#1e3a5f' : 'transparent',
                        borderRadius: 6, border: `1px solid ${selectedZoom === i ? '#3b82f6' : 'transparent'}`,
                        transition: 'all 0.15s',
                      }}>
                        <input
                          type='radio' name='zoom' value={i}
                          checked={selectedZoom === i}
                          onChange={() => setSelectedZoom(i)}
                          style={{ marginTop: 2, accentColor: '#3b82f6' }}
                        />
                        <div>
                          <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{p.label}</div>
                          <div style={{ color: '#475569', fontSize: 10 }}>{p.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={iniciarCache}
                      disabled={!swReady || !isOnline}
                      style={{
                        flex: 1, background: swReady && isOnline ? '#7c3aed' : '#374151',
                        border: 'none', color: swReady && isOnline ? '#fff' : '#6b7280',
                        borderRadius: 8, padding: '9px', fontSize: 13, fontWeight: 700,
                        cursor: swReady && isOnline ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {!isOnline ? '⚠ Sem conexão' : !swReady ? 'Aguardando SW...' : '⬇ Baixar tiles'}
                    </button>
                    {(cacheStats?.tiles || 0) > 0 && (
                      <button onClick={limparTiles} title='Limpar cache de tiles' style={{
                        background: '#1a0a0a', border: '1px solid #7f1d1d', color: '#f87171',
                        borderRadius: 8, padding: '9px 12px', cursor: 'pointer',
                      }}>
                        <FiTrash2 size={14}/>
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* Progresso */}
              {phase === 'caching' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                    <span>Baixando tiles… {progress.done}/{progress.total}</span>
                    <span style={{ color: '#a78bfa', fontWeight: 700 }}>{pct}%</span>
                  </div>
                  <div style={{ background: '#0f172a', borderRadius: 6, height: 10, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 6,
                      background: 'linear-gradient(90deg, #7c3aed, #3b82f6)',
                      width: `${pct}%`, transition: 'width 0.3s ease',
                    }}/>
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>
                    Não feche o app durante o download…
                  </div>
                </div>
              )}

              {phase === 'done' && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: '#064e3b', border: '1px solid #065f46',
                  borderRadius: 8, padding: '10px 12px',
                }}>
                  <FiCheckCircle size={16} color='#22c55e'/>
                  <div>
                    <div style={{ color: '#6ee7b7', fontWeight: 700, fontSize: 12 }}>
                      {progress.done} tiles baixados!
                    </div>
                    <div style={{ color: '#065f46', fontSize: 10 }}>
                      Mapas disponíveis offline
                    </div>
                  </div>
                  <button onClick={() => setPhase('idle')} style={{
                    marginLeft: 'auto', background: 'none', border: 'none',
                    color: '#065f46', cursor: 'pointer',
                  }}><FiX size={12}/></button>
                </div>
              )}
            </div>

            {/* Dados locais */}
            <div style={{
              background: '#1e293b', border: '1px solid #1e3a5f',
              borderRadius: 10, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <FiCheckCircle size={13} color='#22c55e'/>
                <span style={{ color: '#86efac', fontWeight: 700, fontSize: 13 }}>Dados sempre disponíveis</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {[
                  'Vistorias residenciais',
                  'Cadastro de imóveis',
                  'Ocorrências registradas',
                  'Desenho de áreas de risco',
                  'Análise de declividade',
                  'Perfis 3D gerados',
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: '#94a3b8' }}>
                    <span style={{ color: '#22c55e', fontSize: 9 }}>●</span>
                    {item}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 10, color: '#475569', lineHeight: 1.5 }}>
                Registros criados offline são sincronizados automaticamente ao reconectar.
              </div>
            </div>

          </div>
        </div>
      )}

      <style>{`
        @keyframes swPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.6; }
        }
      `}</style>
    </>
  )
}
