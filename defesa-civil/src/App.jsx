import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Home from './pages/Home'
import Vistoria from './pages/Vistoria'
import Dashboard from './pages/Dashboard'
import Declividade from './pages/Declividade'

import MonitoramentoHome from './pages/MonitoramentoHome'
import Monitoramento from './pages/Monitoramento'
import MonitoramentoNovo from './pages/MonitoramentoNovo'
import MonitoramentoDetalhe from './pages/MonitoramentoDetalhe'
import MonitoramentoNovoRelatorio from './pages/MonitoramentoNovoRelatorio'
import MonitoramentoRelatorios from './pages/MonitoramentoRelatorios'
import MonitoramentoRelatorio from './pages/MonitoramentoRelatorio'
import MonitoramentoEvolucao from './pages/MonitoramentoEvolucao'
import MonitoramentoMapa from './pages/MonitoramentoMapa'
import MonitoramentoSobre from './pages/MonitoramentoSobre'
import OfflineManager from './components/OfflineManager'
import BottomNav from './components/BottomNav'

function AppRoutes() {
  const { autenticado, carregando } = useAuth()

  if (carregando) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#475569', fontFamily: 'system-ui, sans-serif' }}>
        Verificando acesso...
      </div>
    )
  }

  return (
    <>
      <Routes>
        <Route path='/login' element={autenticado ? <Navigate to='/' replace /> : <Login />} />
        <Route path='/' element={autenticado ? <Home /> : <Navigate to='/login' replace />} />
        <Route path='/vistoria' element={autenticado ? <Vistoria /> : <Navigate to='/login' replace />} />
        <Route path='/dashboard' element={autenticado ? <Dashboard /> : <Navigate to='/login' replace />} />
        <Route path='/declividade' element={autenticado ? <Declividade /> : <Navigate to='/login' replace />} />
        <Route path='/monitoramento' element={autenticado ? <MonitoramentoHome /> : <Navigate to='/login' replace />} />
        <Route path='/monitoramento/imoveis' element={autenticado ? <Monitoramento /> : <Navigate to='/login' replace />} />
        <Route path='/monitoramento/novo-imovel' element={autenticado ? <MonitoramentoNovo /> : <Navigate to='/login' replace />} />
        <Route path='/monitoramento/mapa' element={autenticado ? <MonitoramentoMapa /> : <Navigate to='/login' replace />} />
        <Route path='/monitoramento/sobre' element={autenticado ? <MonitoramentoSobre /> : <Navigate to='/login' replace />} />
        <Route path='/monitoramento/:id' element={autenticado ? <MonitoramentoDetalhe /> : <Navigate to='/login' replace />} />
        <Route path='/monitoramento/:id/editar' element={autenticado ? <MonitoramentoNovo /> : <Navigate to='/login' replace />} />
        <Route path='/monitoramento/:id/novo-relatorio' element={autenticado ? <MonitoramentoNovoRelatorio /> : <Navigate to='/login' replace />} />
        <Route path='/monitoramento/:id/relatorios' element={autenticado ? <MonitoramentoRelatorios /> : <Navigate to='/login' replace />} />
        <Route path='/monitoramento/:id/relatorio/:relId' element={autenticado ? <MonitoramentoRelatorio /> : <Navigate to='/login' replace />} />
        <Route path='/monitoramento/:id/evolucao' element={autenticado ? <MonitoramentoEvolucao /> : <Navigate to='/login' replace />} />
        <Route path='*' element={<Navigate to={autenticado ? '/' : '/login'} replace />} />
      </Routes>
      {autenticado && <BottomNav />}
      {autenticado && <OfflineManager />}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
