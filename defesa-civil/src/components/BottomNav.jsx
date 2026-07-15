import { Link, useLocation } from 'react-router-dom'
import { FiMap, FiHome, FiClipboard, FiBarChart2, FiTrendingUp, FiMonitor } from 'react-icons/fi'
import styles from './BottomNav.module.css'

const NAV_ITEMS = [
  { to: '/', icon: FiMap, label: 'Mapa' },
  { to: '/vistoria', icon: FiClipboard, label: 'Vistoria' },
  { to: '/imoveis', icon: FiHome, label: 'Imóveis' },
  { to: '/dashboard', icon: FiBarChart2, label: 'Painel' },
  { to: '/declividade', icon: FiTrendingUp, label: 'Decliv.' },
  { to: '/monitoramento', icon: FiMonitor, label: 'Monitor.' },
]

export default function BottomNav() {
  const location = useLocation()
  return (
    <nav className={styles.nav} id="bottom-nav-app">
      {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
        const active = location.pathname === to
        return (
          <Link
            key={to}
            to={to}
            className={`${styles.item} ${active ? styles.active : ''}`}
          >
            <span className={styles.iconWrap}>
              <Icon size={22} />
            </span>
            <span className={styles.label}>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
