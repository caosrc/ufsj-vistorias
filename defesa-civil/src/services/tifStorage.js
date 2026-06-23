const DB_NAME    = 'geovistorias_tif'
const DB_VERSION = 1
const STORE      = 'tif_files'
const KEY        = 'elevation_tif'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE)
    req.onsuccess       = e => resolve(e.target.result)
    req.onerror         = ()=> reject(req.error)
  })
}

export async function saveTif(arrayBuffer, filename) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ buffer: arrayBuffer, filename }, KEY)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror    = () => { db.close(); reject(tx.error) }
  })
}

export async function loadTif() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY)
    req.onsuccess = () => { db.close(); resolve(req.result || null) }
    req.onerror   = () => { db.close(); reject(req.error) }
  })
}

export async function removeTif() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror    = () => { db.close(); reject(tx.error) }
  })
}
