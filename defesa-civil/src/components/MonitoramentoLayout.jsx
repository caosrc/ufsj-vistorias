import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { FiHome, FiList, FiInfo, FiMenu, FiX, FiLogOut, FiArrowLeft } from 'react-icons/fi'
import styles from './MonitoramentoLayout.module.css'

const NAV = [
  { to: '/monitoramento', icon: <FiHome />, label: 'Início', exact: true },
  { to: '/monitoramento/imoveis', icon: <FiList />, label: 'Imóveis' },
  { to: '/monitoramento/sobre', icon: <FiInfo />, label: 'Sobre' },
]

export default function MonitoramentoLayout({ children }) {
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  const isActive = (item) => {
    if (item.exact) return location.pathname === item.to
    return location.pathname.startsWith(item.to)
  }

  return (
    <div className={styles.mobileShell}>
      <div className={styles.phoneFrame}>

        {/* ── Header ───────────────────────────────────────── */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <button className={styles.menuBtn} onClick={() => setMenuOpen(true)}>
              <FiMenu size={20} />
            </button>
            <Link to="/monitoramento" className={styles.brand}>Monitoramento</Link>
          </div>
          <div className={styles.headerRight}>
            <Link to="/" className={styles.backToMenu}>
              <FiArrowLeft size={13} /> Menu Principal
            </Link>
          </div>
        </header>

        {/* ── Drawer nav ───────────────────────────────────── */}
        {menuOpen && (
          <div className={styles.drawerOverlay} onClick={() => setMenuOpen(false)}>
            <div className={styles.drawer} onClick={e => e.stopPropagation()}>
              <div className={styles.drawerHeader}>
                <span className={styles.drawerTitle}>Monitoramento</span>
                <button className={styles.closeBtn} onClick={() => setMenuOpen(false)}>
                  <FiX size={20} />
                </button>
              </div>
              <nav className={styles.drawerNav}>
                {NAV.map(item => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`${styles.drawerLink} ${isActive(item) ? styles.drawerLinkActive : ''}`}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className={styles.navIcon}>{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className={styles.drawerFooter}>
                <Link to="/" className={styles.logoutBtn}>
                  <FiLogOut size={16} /> Voltar ao Mapa Principal
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* ── Conteúdo principal ───────────────────────────── */}
        <main className={styles.main}>
          {children}
        </main>

        {/* ── Bottom tab bar ───────────────────────────────── */}
        <nav className={styles.bottomBar}>
          {NAV.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className={`${styles.tabItem} ${isActive(item) ? styles.tabItemActive : ''}`}
            >
              <span className={styles.tabIcon}>{item.icon}</span>
              <span className={styles.tabLabel}>{item.label.split('/')[0].trim()}</span>
            </Link>
          ))}
        </nav>

      </div>
    </div>
  )
}
