import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Vistoria from './pages/Vistoria'
import Imoveis from './pages/Imoveis'
import Dashboard from './pages/Dashboard'
import Declividade from './pages/Declividade'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<Home />} />
        <Route path='/vistoria' element={<Vistoria />} />
        <Route path='/imoveis' element={<Imoveis />} />
        <Route path='/dashboard' element={<Dashboard />} />
        <Route path='/declividade' element={<Declividade />} />
      </Routes>
    </BrowserRouter>
  )
}
