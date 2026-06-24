import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

// ── Registro do Service Worker ──────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        console.log('[SW] Registrado:', reg.scope)
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Notifica que há atualização disponível
              window.dispatchEvent(new CustomEvent('sw-update-available'))
            }
          })
        })
      })
      .catch(err => console.warn('[SW] Falha no registro:', err))
  })

  // Detecta quando o SW assume o controle (primeira instalação)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('[SW] Controlador atualizado')
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
// trigger deploy
