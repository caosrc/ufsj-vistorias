import Sidebar from '../components/Sidebar'
import Mapa from '../components/Mapa'

export default function Home() {
  return (
    <div style={{ display: 'flex', width: '100%', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <Mapa />
    </div>
  )
}
