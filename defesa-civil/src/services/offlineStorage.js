const DB_NAME = 'geovistorias-offline'
const DB_VERSION = 1
const CACHE_STORE = 'responses'
const QUEUE_STORE = 'outbox'
const CACHE_PREFIX = '__geovistorias_offline_cache__:'
const QUEUE_KEY = '__geovistorias_offline_outbox__'

let dbPromise

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('O armazenamento offline está bloqueado por outra aba.'))
  }).catch(() => null)

  return dbPromise
}

function runTransaction(db, storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const request = action(transaction.objectStore(storeName))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.onabort = () => reject(transaction.error || new Error('Falha no armazenamento offline.'))
  })
}

function storageKey(key) {
  return `${CACHE_PREFIX}${encodeURIComponent(key)}`
}

function readLegacyQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
  } catch {
    return []
  }
}

export async function readOfflineCache(key) {
  const db = await openDatabase()
  if (db) {
    try {
      const result = await runTransaction(db, CACHE_STORE, 'readonly', store => store.get(key))
      if (result) return result.value
    } catch { /* usa o armazenamento alternativo */ }
  }

  try {
    const value = localStorage.getItem(storageKey(key))
    return value === null ? undefined : JSON.parse(value)
  } catch {
    return undefined
  }
}

export async function writeOfflineCache(key, value) {
  const db = await openDatabase()
  if (db) {
    try {
      await runTransaction(db, CACHE_STORE, 'readwrite', store => store.put({
        key,
        value,
        updatedAt: Date.now(),
      }))
      return
    } catch { /* usa o armazenamento alternativo */ }
  }

  try {
    localStorage.setItem(storageKey(key), JSON.stringify(value))
  } catch {
    // O navegador pode estar sem espaço; a resposta em memória ainda é válida.
  }
}

export async function readOfflineIdMapping(localId) {
  return readOfflineCache(`id-map:${localId}`)
}

export async function writeOfflineIdMapping(localId, serverId) {
  await writeOfflineCache(`id-map:${localId}`, serverId)
}

export async function getOfflineQueue() {
  const db = await openDatabase()
  if (db) {
    try {
      const items = await runTransaction(db, QUEUE_STORE, 'readonly', store => store.getAll())
      if (items?.length) return items.sort((a, b) => a.id - b.id)
      const fallback = readLegacyQueue()
      if (fallback.length) {
        for (const item of fallback) await runTransaction(db, QUEUE_STORE, 'readwrite', store => store.add(item))
        localStorage.removeItem(QUEUE_KEY)
        return getOfflineQueue()
      }
      return []
    } catch { /* usa o armazenamento alternativo */ }
  }
  return readLegacyQueue()
}

export async function enqueueOfflineOperation(operation) {
  const db = await openDatabase()
  if (db) {
    try {
      return await runTransaction(db, QUEUE_STORE, 'readwrite', store => store.add(operation))
    } catch { /* usa o armazenamento alternativo */ }
  }

  const queue = readLegacyQueue()
  const id = queue.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1
  queue.push({ ...operation, id })
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    throw new Error('Não há espaço para guardar a operação offline. Libere espaço no dispositivo e tente novamente.')
  }
  return id
}

export async function updateOfflineOperation(id, changes) {
  const db = await openDatabase()
  if (db) {
    try {
      const current = await runTransaction(db, QUEUE_STORE, 'readonly', store => store.get(id))
      if (current) {
        await runTransaction(db, QUEUE_STORE, 'readwrite', store => store.put({ ...current, ...changes, id }))
        return true
      }
    } catch { /* usa o armazenamento alternativo */ }
  }

  const queue = readLegacyQueue()
  const index = queue.findIndex(item => item.id === id)
  if (index < 0) return false
  queue[index] = { ...queue[index], ...changes, id }
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
    return true
  } catch {
    return false
  }
}

export async function removeOfflineOperation(id) {
  const db = await openDatabase()
  if (db) {
    try {
      await runTransaction(db, QUEUE_STORE, 'readwrite', store => store.delete(id))
      return
    } catch { /* usa o armazenamento alternativo */ }
  }

  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(readLegacyQueue().filter(item => item.id !== id)))
  } catch { /* a operação permanece na fila */ }
}

export async function removeOfflineOperations(ids) {
  await Promise.all(ids.map(removeOfflineOperation))
}
