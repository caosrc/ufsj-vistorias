import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Home from './pages/Home'
import Vistoria from './pages/Vistoria'
import Imoveis from './pages/Imoveis'
import Dashboard from './pages/Dashboard'
import Declividade from './pages/Declividade'
import SimulacaoChuva from './pages/SimulacaoChuva'
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

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path='/login' element={<Navigate to='/' replace />} />
          <Route path='/' element={<Home />} />
          <Route path='/vistoria' element={<Vistoria />} />
          <Route path='/imoveis' element={<Imoveis />} />
          <Route path='/dashboard' element={<Dashboard />} />
          <Route path='/declividade' element={<Declividade />} />
          <Route path='/simulacao-chuva' element={<SimulacaoChuva />} />
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
        <BottomNav />
        <OfflineManager />
      </BrowserRouter>
    </AuthProvider>
  )
}
