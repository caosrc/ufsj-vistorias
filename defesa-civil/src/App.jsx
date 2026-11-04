import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Home from './pages/Home'
import Vistoria from './pages/Vistoria'
import Dashboard from './pages/Dashboard'
import Declividade from './pages/Declividade'
import CitizenAccess from './pages/CitizenAccess'
import ResidentHome from './pages/ResidentHome'
import ResidentProfile from './pages/ResidentProfile'
import StaffLogin from './pages/StaffLogin'
import StaffInvites from './pages/StaffInvites'
import PasswordUpdate from './pages/PasswordUpdate'

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
  const { pathname } = useLocation()
  const isPortalRoute = [
    '/morador/acesso',
    '/morador/cadastro',
    '/morador/inicio',
    '/morador/perfil',
    '/setores/login',
    '/setores/convites',
    '/setores/definir-senha',
    '/redefinir-senha',
  ].includes(pathname)

  return (
    <>
      <Routes>
        <Route path='/login' element={<Navigate to='/setores/login' replace />} />
        <Route path='/setores/login' element={<StaffLogin />} />
        <Route path='/setores/convites' element={<StaffInvites />} />
        <Route path='/setores/definir-senha' element={<PasswordUpdate />} />
        <Route path='/redefinir-senha' element={<PasswordUpdate />} />
        <Route path='/morador/acesso' element={<CitizenAccess />} />
        <Route path='/morador/cadastro' element={<CitizenAccess />} />
        <Route path='/morador/inicio' element={<ResidentHome />} />
        <Route path='/morador/perfil' element={<ResidentProfile />} />
        <Route path='/' element={<Home />} />
        <Route path='/vistoria' element={<Vistoria />} />
        <Route path='/dashboard' element={<Dashboard />} />
        <Route path='/declividade' element={<Declividade />} />
        <Route path='/monitoramento' element={<MonitoramentoHome />} />
        <Route path='/monitoramento/imoveis' element={<Monitoramento />} />
        <Route path='/monitoramento/novo-imovel' element={<MonitoramentoNovo />} />
        <Route path='/monitoramento/mapa' element={<MonitoramentoMapa />} />
        <Route path='/monitoramento/sobre' element={<MonitoramentoSobre />} />
        <Route path='/monitoramento/:id' element={<MonitoramentoDetalhe />} />
        <Route path='/monitoramento/:id/editar' element={<MonitoramentoNovo />} />
        <Route path='/monitoramento/:id/novo-relatorio' element={<MonitoramentoNovoRelatorio />} />
        <Route path='/monitoramento/:id/relatorios' element={<MonitoramentoRelatorios />} />
        <Route path='/monitoramento/:id/relatorio/:relId' element={<MonitoramentoRelatorio />} />
        <Route path='/monitoramento/:id/evolucao' element={<MonitoramentoEvolucao />} />
        <Route path='*' element={<Navigate to='/' replace />} />
      </Routes>
      {!isPortalRoute && <BottomNav />}
      {!isPortalRoute && <OfflineManager />}
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
