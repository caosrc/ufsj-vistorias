// ── Geovistorias Service Worker v7 ─────────────────────────────
const CACHE_APP   = 'geovistorias-app-v7'
const CACHE_TILES = 'geovistorias-tiles-v2'
const CACHE_API   = 'geovistorias-api-v5'

const APP_SHELL = [
  '/', '/index.html', '/manifest.json', '/icone.png',
  '/icons/geovistorias-192.png',
  '/icons/geovistorias-512.png',
  '/icons/geovistorias-maskable-512.png',
]

// ── Install ────────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting()
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_APP)
      await Promise.all(APP_SHELL.map(url => cache.add(url).catch(() => null)))

      // Inclui os bundles do build no cache de instalação quando disponíveis.
      try {
        const response = await fetch('/index.html')
        if (!response.ok) return
        await cache.put('/index.html', response.clone())
        const html = await response.text()
        const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)]
          .map(match => new URL(match[1], self.location.origin).href)
          .filter(url => new URL(url).origin === self.location.origin)
        await Promise.all(assets.map(url => cache.add(url).catch(() => null)))
      } catch { /* assets serão armazenados conforme o app for usado online */ }
    })()
  )
})

// ── Activate ──────────────────────────────────────────────────
self.addEventListener('activate', event => {
  const KEEP = [CACHE_APP, CACHE_TILES, CACHE_API]
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// ── Fetch ─────────────────────────────────────────────────────
const TILE_HOSTS = [
  'tile.openstreetmap.org',
  'server.arcgisonline.com',
  'tile.opentopomap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
]

const EXT_DATA_HOSTS = [
  'api.open-meteo.com',
  'api.opentopodata.org',
  'api.openmeteo.com',
]

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Tiles do mapa → CacheFirst (evita re-download)
  if (TILE_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(cacheFirstNoCorsTile(req))
    return
  }

  // APIs externas (clima, elevação) → CacheFirst com TTL longo
  if (EXT_DATA_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(cacheFirstNoCors(req))
    return
  }

  // Rotas de autenticação → nunca interceptar, deixar ir direto à rede
  if (url.pathname.startsWith('/api/auth/')) {
    return
  }

  // API local /api/ → NetworkFirst com fallback em cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(req))
    return
  }

  // App shell e assets JS/CSS → NetworkFirst (garante versão atualizada)
  event.respondWith(networkFirstApp(req))
})

// ── Estratégias de cache ───────────────────────────────────────
async function cacheFirstNoCorsTile(request) {
  const cache  = await caches.open(CACHE_TILES)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request, { mode: 'no-cors' })
    if (response) cache.put(request, response.clone())
    return response
  } catch {
    return cached || new Response('', { status: 504 })
  }
}

async function cacheFirstNoCors(request) {
  const cache  = await caches.open(CACHE_TILES)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request, { mode: 'no-cors' })
    if (response) cache.put(request, response.clone())
    return response
  } catch {
    return cached || new Response('', { status: 504 })
  }
}

async function networkFirstApi(request) {
  const cache = await caches.open(CACHE_API)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    return new Response(JSON.stringify({ error: 'API indisponível offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'X-Offline': 'true' },
    })
  }
}

async function cacheFirstApp(request) {
  const cache  = await caches.open(CACHE_APP)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch {
    const fallback = await cache.match('/') || await cache.match('/index.html')
    return fallback || new Response('App offline', { status: 503 })
  }
}

async function networkFirstApp(request) {
  const cache = await caches.open(CACHE_APP)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    const fallback = await cache.match('/') || await cache.match('/index.html')
    return fallback || new Response('App offline', { status: 503 })
  }
}

// ── Mensagens (pré-cache de tiles, status) ────────────────────
self.addEventListener('message', async event => {
  const { type } = event.data || {}
  const port = event.ports?.[0]

  // Pré-cache de tiles de uma lista de URLs
  if (type === 'PRECACHE_TILES') {
    const { urls } = event.data
    const cache = await caches.open(CACHE_TILES)
    let done = 0
    let saved = 0
    let failed = 0

    for (const url of urls) {
      try {
        const already = await cache.match(url)
        if (already) {
          saved++
        } else {
          const resp = await fetch(url, { mode: 'no-cors' })
          if (resp) {
            await cache.put(url, resp)
            saved++
          } else {
            failed++
          }
        }
      } catch {
        failed++
      }

      done++
      port?.postMessage({ type: 'TILE_PROGRESS', done, total: urls.length, saved, failed })

      // 40ms entre requisições para não sobrecarregar
      await new Promise(r => setTimeout(r, 40))
    }
    port?.postMessage({ type: 'TILE_DONE', done, total: urls.length, saved, failed })
  }

  // Status dos caches
  if (type === 'CACHE_STATUS') {
    const [tileKeys, apiKeys, appKeys] = await Promise.all([
      caches.open(CACHE_TILES).then(c => c.keys()),
      caches.open(CACHE_API).then(c => c.keys()),
      caches.open(CACHE_APP).then(c => c.keys()),
    ])
    port?.postMessage({
      type: 'CACHE_STATUS_RESULT',
      tiles: tileKeys.length,
      api:   apiKeys.length,
      app:   appKeys.length,
    })
  }

  // Limpar cache de tiles
  if (type === 'CLEAR_TILES') {
    await caches.delete(CACHE_TILES)
    port?.postMessage({ type: 'CLEARED' })
  }
})
