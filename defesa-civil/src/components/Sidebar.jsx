import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { FiMap, FiAlertTriangle, FiHome, FiClipboard, FiBarChart2, FiChevronLeft, FiChevronRight, FiShield } from 'react-icons/fi'
import styles from './Sidebar.module.css'

const NAV_ITEMS = [
  { to: '/', icon: <FiMap />, label: 'Mapa Operacional' },
  { to: '/ocorrencias', icon: <FiAlertTriangle />, label: 'Ocorrências' },
  { to: '/vistoria', icon: <FiClipboard />, label: 'Vistoria Residencial' },
  { to: '/imoveis', icon: <FiHome />, label: 'Imóveis' },
  { to: '/dashboard', icon: <FiBarChart2 />, label: 'Painel Operacional' },
]

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()

  return (
    <div className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      <div className={styles.logo}>
        <FiShield size={24} color='#38bdf8' />
        {!collapsed && (
          <div className={styles.logoText}>
            <span className={styles.logoTitle}>Defesa Civil</span>
            <span className={styles.logoSub}>Ouro Branco · Congonhas</span>
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
