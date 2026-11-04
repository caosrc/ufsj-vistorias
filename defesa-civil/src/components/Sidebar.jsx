import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { FiMap, FiClipboard, FiBarChart2, FiChevronLeft, FiChevronRight, FiLayers, FiTrendingUp, FiMonitor } from 'react-icons/fi'
import styles from './Sidebar.module.css'

const NAV_ITEMS = [
  { to: '/', icon: <FiMap />, label: 'Mapa Operacional' },
  { to: '/vistoria', icon: <FiClipboard />, label: 'Vistoria Residencial' },
  { to: '/dashboard', icon: <FiBarChart2 />, label: 'Painel Operacional' },
  { to: '/declividade', icon: <FiTrendingUp />, label: 'Declividade' },
  { to: '/monitoramento', icon: <FiMonitor />, label: 'Monitoramento' },
]

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()

  return (
    <div className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      <div className={styles.logo}>
        <img className={styles.logoIcon} src='/icons/sismar-192.png' alt='' />
        {!collapsed && (
          <div className={styles.logoText}>
            <span className={styles.logoTitle}>SISMAR</span>
            <span className={styles.logoSub}>Defesa Civil · MG</span>
          </div>
        )}
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map(item => (
          <Link
            key={item.to}
            to={item.to}
            className={`${styles.navItem} ${location.pathname === item.to ? styles.active : ''}`}
            title={collapsed ? item.label : ''}
          >
            <span className={styles.navIcon}>{item.icon}</span>
            {!collapsed && <span className={styles.navLabel}>{item.label}</span>}
          </Link>
        ))}
      </nav>

      <button
        className={styles.collapseBtn}
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'Expandir menu' : 'Recolher menu'}
      >
        {collapsed ? <FiChevronRight /> : <FiChevronLeft />}
      </button>
    </div>
  )
}
