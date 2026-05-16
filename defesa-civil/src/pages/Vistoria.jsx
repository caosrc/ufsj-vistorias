import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { FiArrowLeft, FiClipboard, FiSave, FiTrash2, FiMapPin,
         FiDownload, FiBarChart2, FiCheckCircle, FiAlertTriangle, FiNavigation } from 'react-icons/fi'
import { api } from '../services/api'
import styles from './Vistoria.module.css'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

// ── Conversor Decimal → GMS ─────────────────────────────────────
function decToGMS(decimal, isLat) {
  const dir = isLat ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'L' : 'O')
  const abs = Math.abs(decimal)
  const deg = Math.floor(abs)
  const minF = (abs - deg) * 60
  const min = Math.floor(minF)
  const sec = ((minF - min) * 60).toFixed(2)
  return `${deg}°${String(min).padStart(2,'0')}'${String(sec).padStart(5,'0')}"${dir}`
}

// ── SVGs: Ângulos de Encosta (casas próximas à encosta) ─────────
function EncostaSVG10() {
  return (
    <svg viewBox="0 0 160 100" width="150" height="94">
      <defs>
        <linearGradient id="sky10" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0b1a2e"/>
          <stop offset="100%" stopColor="#0d2137"/>
        </linearGradient>
        <linearGradient id="solo10" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1c3320"/>
          <stop offset="100%" stopColor="#0e1f13"/>
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill="url(#sky10)"/>
      {/* Solo plano */}
      <polygon points="0,73 90,73 160,60 160,100 0,100" fill="url(#solo10)"/>
      {/* Superfície */}
      <line x1="0" y1="73" x2="90" y2="73" stroke="#22c55e" strokeWidth="2"/>
      <line x1="90" y1="73" x2="160" y2="60" stroke="#22c55e" strokeWidth="2.5"/>
      {/* Arc 10° */}
      <path d="M 90,73 A 22,22 0 0,1 111.6,69.2" fill="none" stroke="#22c55e" strokeWidth="1.5"/>
      <text x="114" y="71" fontSize="9" fill="#22c55e" fontWeight="bold">10°</text>
      {/* Casa */}
      <rect x="12" y="52" width="36" height="21" rx="1" fill="#1e3020" stroke="#22c55e" strokeWidth="1.5"/>
      <polygon points="10,52 30,37 50,52" fill="#22c55e" opacity="0.75"/>
      <rect x="18" y="62" width="9" height="11" fill="#0b1220"/>
      <rect x="33" y="57" width="10" height="10" rx="1" fill="#38bdf8" opacity="0.35"/>
      <line x1="30" y1="37" x2="30" y2="34" stroke="#94a3b8" strokeWidth="1"/>
      {/* Vegetação */}
      {[97,108,120,134,148].map((x,i)=>(
        <g key={i} transform={`translate(${x},${[72,69,66,63,61][i]})`}>
          <ellipse cx="0" cy="-4" rx="5" ry="6" fill="#15803d" opacity="0.8"/>
        </g>
      ))}
      <text x="80" y="97" fontSize="8" fill="#22c55e" textAnchor="middle" opacity="0.7">Encosta suave — R1</text>
    </svg>
  )
}

function EncostaSVG17() {
  return (
    <svg viewBox="0 0 160 100" width="150" height="94">
      <defs>
        <linearGradient id="solo17" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#263320"/>
          <stop offset="100%" stopColor="#0e1f13"/>
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill="#0b1a2e"/>
      {/* Solo com inclinação 17° */}
      <polygon points="0,73 85,73 160,49 160,100 0,100" fill="url(#solo17)"/>
      <line x1="0" y1="73" x2="85" y2="73" stroke="#84cc16" strokeWidth="2"/>
      <line x1="85" y1="73" x2="160" y2="49" stroke="#84cc16" strokeWidth="2.5"/>
      {/* Arc */}
      <path d="M 85,73 A 20,20 0 0,1 104.2,66.1" fill="none" stroke="#84cc16" strokeWidth="1.5"/>
      <text x="106" y="68" fontSize="9" fill="#84cc16" fontWeight="bold">17°</text>
      {/* Casa */}
      <rect x="10" y="52" width="36" height="21" rx="1" fill="#1e2e10" stroke="#84cc16" strokeWidth="1.5"/>
      <polygon points="8,52 28,36 46,52" fill="#84cc16" opacity="0.75"/>
      <rect x="14" y="62" width="9" height="11" fill="#0b1220"/>
      <rect x="30" y="57" width="10" height="10" rx="1" fill="#38bdf8" opacity="0.35"/>
      {/* Erosão leve */}
      <path d="M 100,60 Q 115,58 130,54 Q 145,50 160,49" fill="none" stroke="#84cc16" strokeWidth="1" strokeDasharray="3,3" opacity="0.5"/>
      {/* Vegetação esparsa */}
      {[95,115,140].map((x,i)=>(
        <ellipse key={i} cx={x} cy={[71,64,55][i]-4} rx="5" ry="6" fill="#4d7c0f" opacity="0.7"/>
      ))}
      <text x="80" y="97" fontSize="8" fill="#84cc16" textAnchor="middle" opacity="0.7">Inclinação leve — R1–R2</text>
    </svg>
  )
}

function EncostaSVG30() {
  return (
    <svg viewBox="0 0 160 100" width="150" height="94">
      <defs>
        <linearGradient id="solo30" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#2c2800"/>
          <stop offset="100%" stopColor="#3d3500"/>
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill="#0c1520"/>
      {/* Solo inclinação 30° */}
      <polygon points="0,73 78,73 160,27 160,100 0,100" fill="#1c1900"/>
      <polygon points="78,73 160,27 160,100 78,100" fill="url(#solo30)" opacity="0.8"/>
      <line x1="0" y1="73" x2="78" y2="73" stroke="#eab308" strokeWidth="2"/>
      <line x1="78" y1="73" x2="160" y2="27" stroke="#eab308" strokeWidth="2.5"/>
      {/* Arc */}
      <path d="M 78,73 A 22,22 0 0,1 97.1,62" fill="none" stroke="#eab308" strokeWidth="1.5"/>
      <text x="100" y="65" fontSize="9" fill="#eab308" fontWeight="bold">30°</text>
      {/* Casa */}
      <rect x="10" y="51" width="35" height="22" rx="1" fill="#2c2000" stroke="#eab308" strokeWidth="1.5"/>
      <polygon points="8,51 27.5,35 47,51" fill="#eab308" opacity="0.7"/>
      <rect x="14" y="62" width="9" height="11" fill="#0b1220"/>
      <rect x="30" y="57" width="10" height="10" rx="1" fill="#fef08a" opacity="0.25"/>
      {/* Rachaduras no solo */}
      <path d="M 52,70 L 58,67 L 54,65" fill="none" stroke="#eab308" strokeWidth="1" opacity="0.6"/>
      <path d="M 62,71 L 65,67" fill="none" stroke="#eab308" strokeWidth="1" opacity="0.5"/>
      <text x="80" y="97" fontSize="8" fill="#eab308" textAnchor="middle" opacity="0.7">Inclinação moderada — R2</text>
    </svg>
  )
}

function EncostaSVG60() {
  return (
    <svg viewBox="0 0 160 100" width="150" height="94">
      <rect width="160" height="100" fill="#0c1020"/>
      {/* Solo muito inclinado 60° */}
      <polygon points="0,73 90,73 116,27 160,27 160,100 0,100" fill="#2c1000"/>
      <polygon points="90,73 116,27 160,27 160,100 90,100" fill="#3d1500" opacity="0.8"/>
      <line x1="0" y1="73" x2="90" y2="73" stroke="#f97316" strokeWidth="2"/>
      <line x1="90" y1="73" x2="116" y2="27" stroke="#f97316" strokeWidth="2.5"/>
      <line x1="116" y1="27" x2="160" y2="27" stroke="#f97316" strokeWidth="2" opacity="0.6"/>
      {/* Arc 60° */}
      <path d="M 90,73 A 18,18 0 0,1 99,57.4" fill="none" stroke="#f97316" strokeWidth="1.5"/>
      <text x="100" y="60" fontSize="9" fill="#f97316" fontWeight="bold">60°</text>
      {/* Casa inclinada/ameaçada */}
      <g transform="rotate(-3, 26, 62)">
        <rect x="8" y="52" width="34" height="21" rx="1" fill="#2c1000" stroke="#f97316" strokeWidth="1.5"/>
        <polygon points="6,52 25,37 44,52" fill="#f97316" opacity="0.65"/>
        <rect x="14" y="63" width="8" height="10" fill="#0b1220"/>
        <rect x="29" y="58" width="9" height="9" rx="1" fill="#fed7aa" opacity="0.2"/>
      </g>
      {/* Setas de deslizamento */}
      <path d="M 96,60 L 92,68" stroke="#ef4444" strokeWidth="2" markerEnd="url(#arr)" opacity="0.8"/>
      <path d="M 104,50 L 100,58" stroke="#ef4444" strokeWidth="2" opacity="0.6"/>
      <path d="M 108,40 L 105,48" stroke="#ef4444" strokeWidth="1.5" opacity="0.5"/>
      {/* Blocos de rocha caindo */}
      <rect x="88" y="63" width="6" height="5" rx="1" fill="#7c2d12" stroke="#f97316" strokeWidth="0.8"/>
      <text x="80" y="97" fontSize="8" fill="#f97316" textAnchor="middle" opacity="0.7">Encosta acentuada — R3–R4</text>
    </svg>
  )
}

function EncostaSVG90() {
  return (
    <svg viewBox="0 0 160 100" width="150" height="94">
      <rect width="160" height="100" fill="#0c0a18"/>
      {/* Paredão vertical */}
      <polygon points="0,73 75,73 75,10 160,10 160,100 0,100" fill="#1a0000"/>
      <polygon points="75,73 75,10 160,10 160,100 75,100" fill="#2c0000" opacity="0.8"/>
      <line x1="0" y1="73" x2="75" y2="73" stroke="#ef4444" strokeWidth="2"/>
      <line x1="75" y1="73" x2="75" y2="10" stroke="#ef4444" strokeWidth="3"/>
      <line x1="75" y1="10" x2="160" y2="10" stroke="#ef4444" strokeWidth="2" opacity="0.6"/>
      {/* Ângulo reto 90° */}
      <rect x="75" y="63" width="10" height="10" fill="none" stroke="#ef4444" strokeWidth="1.5"/>
      <text x="88" y="73" fontSize="9" fill="#ef4444" fontWeight="bold">90°</text>
      {/* Estratificação da rocha */}
      {[20,32,44,56,68].map((y,i)=>(
        <line key={i} x1="75" y1={y} x2="160" y2={y} stroke="#ef4444" strokeWidth="0.5" opacity="0.25"/>
      ))}
      {/* Casa pressionada contra o paredão */}
      <g>
        <rect x="8" y="50" width="34" height="23" rx="1" fill="#1a0000" stroke="#ef4444" strokeWidth="2"/>
        <polygon points="6,50 25,34 44,50" fill="#ef4444" opacity="0.6"/>
        <rect x="13" y="62" width="8" height="11" fill="#0b1220"/>
        <rect x="28" y="57" width="9" height="9" rx="1" fill="#fecaca" opacity="0.15"/>
      </g>
      {/* Blocos desprendendo */}
      {[[76,38,5,4],[80,55,4,3],[72,48,6,4]].map(([x,y,w,h],i)=>(
        <rect key={i} x={x} y={y} width={w} height={h} rx="0.5" fill="#7f1d1d" stroke="#ef4444" strokeWidth="0.8"/>
      ))}
      <text x="80" y="97" fontSize="8" fill="#ef4444" textAnchor="middle" opacity="0.7">Paredão vertical — R4 CRÍTICO</text>
    </svg>
  )
}

const ANGULOS_ENCOSTA = [
  { ang: 10,  label: '10°',  cor: '#22c55e', risco: 'R1',      desc: 'Encosta suave', SVG: EncostaSVG10 },
  { ang: 17,  label: '17°',  cor: '#84cc16', risco: 'R1–R2',   desc: 'Inclinação leve', SVG: EncostaSVG17 },
  { ang: 30,  label: '30°',  cor: '#eab308', risco: 'R2',      desc: 'Moderada', SVG: EncostaSVG30 },
  { ang: 60,  label: '60°',  cor: '#f97316', risco: 'R3–R4',   desc: 'Acentuada', SVG: EncostaSVG60 },
  { ang: 90,  label: '90°',  cor: '#ef4444', risco: 'R4',      desc: 'Paredão vertical', SVG: EncostaSVG90 },
]

// ── SVGs: Características do Talude ────────────────────────────
function TaludeCorteIlus() {
  return (
    <svg viewBox="0 0 110 80" width="100" height="72">
      <rect width="110" height="80" fill="#0b1220"/>
      {/* Solo original */}
      <polygon points="0,60 55,60 55,20 110,20 110,80 0,80" fill="#1c1400"/>
      {/* Corte no talude */}
      <line x1="0" y1="60" x2="55" y2="60" stroke="#eab308" strokeWidth="2"/>
      <line x1="55" y1="60" x2="55" y2="20" stroke="#eab308" strokeWidth="2.5"/>
      <line x1="55" y1="20" x2="110" y2="20" stroke="#eab308" strokeWidth="2"/>
      {/* Perfil do solo exposto */}
      {[[55,22,80,22],[55,34,80,34],[55,46,80,46]].map(([x1,y1,x2,y2],i)=>(
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#78350f" strokeWidth="0.8" opacity="0.5"/>
      ))}
      {/* Casa pequena */}
      <rect x="5" y="42" width="28" height="18" rx="1" fill="#1e293b" stroke="#eab308" strokeWidth="1"/>
      <polygon points="3,42 19,30 33,42" fill="#eab308" opacity="0.6"/>
      {/* Seta marcando o corte */}
      <text x="58" y="45" fontSize="9" fill="#eab308">corte</text>
      <text x="55" y="73" fontSize="8" fill="#eab308" textAnchor="middle" opacity="0.7">Talude de Corte</text>
    </svg>
  )
}

function DistMoradiaProxIlus() {
  return (
    <svg viewBox="0 0 110 80" width="100" height="72">
      <rect width="110" height="80" fill="#0b1220"/>
      <polygon points="0,60 110,60 110,80 0,80" fill="#1c2000"/>
      <line x1="0" y1="60" x2="110" y2="60" stroke="#f97316" strokeWidth="2"/>
      {/* Encosta */}
      <polygon points="70,60 70,10 110,10 110,60" fill="#2c1500" opacity="0.8"/>
      <line x1="70" y1="60" x2="70" y2="10" stroke="#f97316" strokeWidth="2.5"/>
      {/* Casa muito próxima */}
      <rect x="42" y="40" width="24" height="20" rx="1" fill="#2c1000" stroke="#ef4444" strokeWidth="1.5"/>
      <polygon points="40,40 54,28 68,40" fill="#ef4444" opacity="0.7"/>
      <rect x="47" y="50" width="7" height="10" fill="#0b1220"/>
      {/* Seta distância pequena */}
      <line x1="68" y1="52" x2="70" y2="52" stroke="#ef4444" strokeWidth="1.5" markerEnd="url(#arr)"/>
      <line x1="64" y1="52" x2="68" y2="52" stroke="#ef4444" strokeWidth="1.5"/>
      <text x="54" y="57" fontSize="7" fill="#ef4444">{'<'}2m</text>
      <text x="55" y="73" fontSize="8" fill="#f97316" textAnchor="middle" opacity="0.7">Dist. {'<'} 2 m</text>
    </svg>
  )
}

function DistMoradiaMedIlus() {
  return (
    <svg viewBox="0 0 110 80" width="100" height="72">
      <rect width="110" height="80" fill="#0b1220"/>
      <polygon points="0,60 110,60 110,80 0,80" fill="#1c2000"/>
      <line x1="0" y1="60" x2="110" y2="60" stroke="#eab308" strokeWidth="2"/>
      <polygon points="80,60 80,15 110,15 110,60" fill="#2c2000" opacity="0.8"/>
      <line x1="80" y1="60" x2="80" y2="15" stroke="#eab308" strokeWidth="2.5"/>
      {/* Casa com distância média */}
      <rect x="28" y="40" width="24" height="20" rx="1" fill="#2c2000" stroke="#eab308" strokeWidth="1.5"/>
      <polygon points="26,40 40,28 54,40" fill="#eab308" opacity="0.7"/>
      <rect x="33" y="50" width="7" height="10" fill="#0b1220"/>
      {/* Seta distância */}
      <line x1="55" y1="55" x2="78" y2="55" stroke="#eab308" strokeWidth="1.5"/>
      <text x="66" y="52" fontSize="7" fill="#eab308" textAnchor="middle">2–5m</text>
      <text x="55" y="73" fontSize="8" fill="#eab308" textAnchor="middle" opacity="0.7">Dist. 2–5 m</text>
    </svg>
  )
}

function AterroLancadoIlus() {
  return (
    <svg viewBox="0 0 110 80" width="100" height="72">
      <rect width="110" height="80" fill="#0b1220"/>
      {/* Aterro irregular */}
      <polygon points="0,65 20,55 35,60 50,45 70,52 90,40 110,48 110,80 0,80" fill="#3d2000"/>
      <path d="M 0,65 Q 20,52 35,58 Q 50,43 70,50 Q 90,38 110,46" fill="none" stroke="#f97316" strokeWidth="2" strokeDasharray="4,2"/>
      {/* Setas de aterro caindo */}
      {[20,40,60,80].map((x,i)=>(
        <g key={i}>
          <line x1={x} y1={[35,25,30,22][i]} x2={x} y2={[50,42,45,38][i]} stroke="#f97316" strokeWidth="1.5" opacity="0.7"/>
          <polygon points={`${x-3},${[48,40,43,36][i]} ${x+3},${[48,40,43,36][i]} ${x},${[52,44,47,40][i]}`} fill="#f97316" opacity="0.7"/>
        </g>
      ))}
      {/* Casa */}
      <rect x="5" y="47" width="22" height="17" rx="1" fill="#1e293b" stroke="#f97316" strokeWidth="1"/>
      <polygon points="3,47 16,36 29,47" fill="#f97316" opacity="0.5"/>
      <text x="55" y="73" fontSize="8" fill="#f97316" textAnchor="middle" opacity="0.7">Aterro Lançado</text>
    </svg>
  )
}

function ParedeRochosaIlus() {
  return (
    <svg viewBox="0 0 110 80" width="100" height="72">
      <rect width="110" height="80" fill="#0b1220"/>
      {/* Parede de rocha */}
      <polygon points="65,65 65,8 110,8 110,65" fill="#1a1a2e"/>
      <polygon points="65,8 110,8 110,65 65,65" fill="#252540" opacity="0.6"/>
      <line x1="65" y1="8" x2="65" y2="65" stroke="#9ca3af" strokeWidth="3"/>
      <line x1="65" y1="8" x2="110" y2="8" stroke="#9ca3af" strokeWidth="2"/>
      {/* Estratificação */}
      {[20,32,44,56].map((y,i)=>(
        <line key={i} x1="65" y1={y} x2="110" y2={y} stroke="#6b7280" strokeWidth="0.7"/>
      ))}
      {/* Blocos */}
      {[[70,12,14,10],[85,24,16,10],[72,38,12,9],[90,45,14,10]].map(([x,y,w,h],i)=>(
        <rect key={i} x={x} y={y} width={w} height={h} fill="none" stroke="#4b5563" strokeWidth="0.7"/>
      ))}
      {/* Solo */}
      <polygon points="0,65 65,65 110,65 110,80 0,80" fill="#1c1400"/>
      <line x1="0" y1="65" x2="110" y2="65" stroke="#9ca3af" strokeWidth="2"/>
      {/* Casa */}
      <rect x="8" y="46" width="28" height="19" rx="1" fill="#1e293b" stroke="#9ca3af" strokeWidth="1"/>
      <polygon points="6,46 22,33 38,46" fill="#6b7280" opacity="0.7"/>
      <text x="55" y="75" fontSize="8" fill="#9ca3af" textAnchor="middle" opacity="0.7">Parede Rochosa</text>
    </svg>
  )
}

function DeslizamentoIlus() {
  return (
    <svg viewBox="0 0 110 80" width="100" height="72">
      <rect width="110" height="80" fill="#0b1220"/>
      {/* Encosta com cicatriz de deslizamento */}
      <polygon points="55,65 55,10 110,10 110,65 110,80 55,80" fill="#2c0a00"/>
      {/* Cicatriz (concôncava) */}
      <path d="M 55,30 Q 70,20 85,25 Q 95,28 95,40 L 90,65" fill="#1a0500" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4,2"/>
      <line x1="55" y1="10" x2="55" y2="65" stroke="#ef4444" strokeWidth="2.5"/>
      <line x1="55" y1="10" x2="110" y2="10" stroke="#ef4444" strokeWidth="2" opacity="0.5"/>
      {/* Detritos na base */}
      <polygon points="55,60 80,65 90,60 110,65 110,80 55,80" fill="#3d0a00"/>
      {/* Solo plano */}
      <polygon points="0,65 55,65 55,80 0,80" fill="#1c1400"/>
      <line x1="0" y1="65" x2="110" y2="65" stroke="#ef4444" strokeWidth="2"/>
      {/* Casa danificada */}
      <g transform="rotate(-8,20,55)">
        <rect x="5" y="46" width="28" height="18" rx="1" fill="#2c0500" stroke="#ef4444" strokeWidth="1.5"/>
        <polygon points="3,46 19,33 35,46" fill="#ef4444" opacity="0.5"/>
        <line x1="5" y1="55" x2="33" y2="55" stroke="#ef4444" strokeWidth="0.8" strokeDasharray="2,2"/>
      </g>
      <text x="55" y="78" fontSize="8" fill="#ef4444" textAnchor="middle" opacity="0.8">Deslizamentos</text>
    </svg>
  )
}

// ── SVG: Casas R1–R4 ───────────────────────────────────────────
function CasaR1() {
  return (
    <svg viewBox="0 0 100 80" width="80" height="72">
      <rect width="100" height="80" fill="#0b1220" rx="4"/>
      {/* Solo suave */}
      <polygon points="0,65 100,65 100,80 0,80" fill="#14532d"/>
      <path d="M0,65 Q50,60 100,65" fill="none" stroke="#22c55e" strokeWidth="2"/>
      {/* Casa estável */}
      <rect x="22" y="42" width="56" height="23" rx="2" fill="#14532d" stroke="#22c55e" strokeWidth="2"/>
      <polygon points="18,42 50,20 82,42" fill="#166534" stroke="#22c55e" strokeWidth="2"/>
      <rect x="30" y="52" width="12" height="13" fill="#0b1220"/>
      <rect x="58" y="48" width="13" height="12" rx="1" fill="#bbf7d0" opacity="0.5"/>
      {/* Fundação sólida */}
      <line x1="22" y1="65" x2="78" y2="65" stroke="#22c55e" strokeWidth="2"/>
      <text x="50" y="76" fontSize="8" fill="#22c55e" textAnchor="middle" fontWeight="bold">~10–15°</text>
    </svg>
  )
}
function CasaR2() {
  return (
    <svg viewBox="0 0 100 80" width="80" height="72">
      <rect width="100" height="80" fill="#0b1220" rx="4"/>
      <path d="M0,68 Q30,64 60,70 Q80,72 100,68" fill="#713f12" stroke="none"/>
      <polygon points="0,68 100,68 100,80 0,80" fill="#713f12"/>
      <g transform="rotate(-7,50,60)">
        <rect x="22" y="43" width="56" height="22" rx="2" fill="#422006" stroke="#eab308" strokeWidth="2"/>
        <polygon points="18,43 50,22 82,43" fill="#713f12" stroke="#eab308" strokeWidth="2"/>
        <rect x="30" y="53" width="12" height="12" fill="#0b1220"/>
        <rect x="58" y="49" width="13" height="12" rx="1" fill="#fef08a" opacity="0.4"/>
        <line x1="22" y1="54" x2="78" y2="55" stroke="#eab308" strokeWidth="0.8" strokeDasharray="3,2"/>
      </g>
      <text x="50" y="77" fontSize="8" fill="#facc15" textAnchor="middle" fontWeight="bold">~25–30°</text>
    </svg>
  )
}
function CasaR3() {
  return (
    <svg viewBox="0 0 100 82" width="80" height="72">
      <rect width="100" height="82" fill="#0b1220" rx="4"/>
      <path d="M0,70 Q25,62 50,72 Q75,78 100,68" fill="#7c2d12" stroke="none"/>
      <polygon points="0,70 100,70 100,82 0,82" fill="#7c2d12"/>
      <g transform="rotate(-20,50,62)">
        <rect x="22" y="44" width="56" height="22" rx="2" fill="#431407" stroke="#f97316" strokeWidth="2"/>
        <polygon points="18,44 50,22 82,44" fill="#7c2d12" stroke="#f97316" strokeWidth="2"/>
        <rect x="30" y="54" width="12" height="12" fill="#0b1220"/>
        <rect x="58" y="50" width="13" height="11" rx="1" fill="#fed7aa" opacity="0.3"/>
      </g>
      {/* Setas de movimento */}
      {[15,48,82].map((x,i)=>(
        <line key={i} x1={x} y1={[48,38,50][i]} x2={x+3} y2={[58,48,60][i]} stroke="#f97316" strokeWidth="1.5" opacity="0.8"/>
      ))}
      <text x="50" y="79" fontSize="8" fill="#fb923c" textAnchor="middle" fontWeight="bold">~40–45°</text>
    </svg>
  )
}
function CasaR4() {
  return (
    <svg viewBox="0 0 100 82" width="80" height="72">
      <rect width="100" height="82" fill="#0b1220" rx="4"/>
      <path d="M0,72 L25,60 Q40,54 55,68 Q70,72 100,65" fill="#7f1d1d" stroke="none"/>
      <polygon points="0,72 100,72 100,82 0,82" fill="#7f1d1d"/>
      <polygon points="20,68 42,46 62,62 78,42 92,68" fill="#450a0a" stroke="#ef4444" strokeWidth="2"/>
      <polygon points="30,46 62,62 42,62" fill="#7f1d1d" stroke="#ef4444" strokeWidth="1"/>
      <rect x="54" y="54" width="14" height="12" rx="1" fill="#fecaca" opacity="0.3" transform="rotate(20,61,60)"/>
      {/* Detritos */}
      {[[10,66,6],[20,68,5],[30,64,7],[40,70,4]].map(([x,y,s],i)=>(
        <ellipse key={i} cx={x} cy={y} rx={s} ry={3} fill="#7f1d1d" stroke="#ef4444" strokeWidth="0.8"/>
      ))}
      <text x="50" y="79" fontSize="8" fill="#f87171" textAnchor="middle" fontWeight="bold">&gt;45° — EVACUAÇÃO</text>
    </svg>
  )
}

// ── SVG: Tipos de Talude (melhorados) ──────────────────────────
function TaludeNatural() {
  return (
    <svg viewBox="0 0 100 70" width="90" height="62">
      <rect width="100" height="70" fill="#0b1220" rx="3"/>
      <polygon points="0,55 100,55 100,70 0,70" fill="#14532d" opacity="0.6"/>
      <path d="M2,55 Q20,30 45,20 Q65,12 98,18" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round"/>
      {[8,20,32,46,60,74,88].map((x,i)=>(
        <g key={i} transform={`translate(${x},${[43,33,25,21,19,21,25][i]})`}>
          <line x1="0" y1="0" x2="-2" y2="-8" stroke="#22c55e" strokeWidth="1.5"/>
          <ellipse cx="-4" cy="-10" rx="4" ry="5" fill="#16a34a" opacity="0.9"/>
          <ellipse cx="3" cy="-11" rx="3.5" ry="4.5" fill="#15803d" opacity="0.9"/>
        </g>
      ))}
      <line x1="2" y1="55" x2="98" y2="55" stroke="#4ade80" strokeWidth="1.5"/>
      <text x="50" y="65" fontSize="8" fill="#4ade80" textAnchor="middle">Natural / Vegetado</text>
    </svg>
  )
}
function TaludeCorte() {
  return (
    <svg viewBox="0 0 100 70" width="90" height="62">
      <rect width="100" height="70" fill="#0b1220" rx="3"/>
      <polygon points="0,55 55,55 55,12 100,12 100,70 0,70" fill="#78350f" opacity="0.35"/>
      <line x1="2" y1="55" x2="55" y2="55" stroke="#eab308" strokeWidth="2"/>
      <line x1="55" y1="55" x2="55" y2="12" stroke="#eab308" strokeWidth="2.5"/>
      <line x1="55" y1="12" x2="98" y2="12" stroke="#eab308" strokeWidth="2"/>
      {/* Perfil exposto */}
      {[[55,20,90,20],[55,32,90,32],[55,44,90,44]].map(([x1,y1,x2,y2],i)=>(
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#92400e" strokeWidth="0.8" opacity="0.5"/>
      ))}
      <rect x="65" y="20" width="8" height="5" fill="#92400e" opacity="0.4"/>
      <rect x="70" y="33" width="10" height="5" fill="#92400e" opacity="0.4"/>
      <text x="28" y="36" fontSize="7" fill="#fbbf24" textAnchor="middle">solo</text>
      <text x="75" y="10" fontSize="7" fill="#fbbf24" textAnchor="middle">topo</text>
      <text x="50" y="64" fontSize="8" fill="#eab308" textAnchor="middle">Talude de Corte</text>
    </svg>
  )
}
function AlertaLancado() {
  return (
    <svg viewBox="0 0 100 70" width="90" height="62">
      <rect width="100" height="70" fill="#0b1220" rx="3"/>
      <path d="M2,55 Q25,40 50,20 Q65,10 98,15" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round"/>
      <polygon points="0,55 100,55 100,70 0,70" fill="#3d1500" opacity="0.5"/>
      {[12,28,44,60,76].map((x,i)=>(
        <g key={i}>
          <polygon points={`${x},${[47,34,25,22,23][i]} ${x+6},${[42,29,20,17,18][i]} ${x+12},${[48,35,26,23,24][i]}`} fill="#f97316" opacity="0.8"/>
          <line x1={x+6} y1={[42,29,20,17,18][i]} x2={x+6} y2={[35,22,13,10,11][i]} stroke="#f97316" strokeWidth="1" opacity="0.4"/>
        </g>
      ))}
      <line x1="2" y1="55" x2="98" y2="55" stroke="#92400e" strokeWidth="2"/>
      <text x="50" y="64" fontSize="8" fill="#fb923c" textAnchor="middle">Aterro Lançado</text>
    </svg>
  )
}
function ParedRochosa() {
  return (
    <svg viewBox="0 0 100 70" width="90" height="62">
      <rect width="100" height="70" fill="#0b1220" rx="3"/>
      <rect x="28" y="8" width="44" height="47" rx="2" fill="#1f2937" stroke="#9ca3af" strokeWidth="1.5"/>
      {[[28,18,72,18],[28,28,72,28],[28,38,72,38],[28,48,72,48]].map(([x1,y1,x2,y2],i)=>(
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6b7280" strokeWidth="0.8"/>
      ))}
      {[[28,8,42,18],[42,8,72,18],[28,18,38,28],[38,18,72,28],[28,28,48,38],[48,28,72,38],[28,38,44,48],[44,38,72,48]].map(([x1,y1,x2,y2],i)=>(
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6b7280" strokeWidth="0.4" opacity="0.5"/>
      ))}
      <polygon points="0,55 28,55 28,8 0,8" fill="#1f2937" stroke="#4b5563" strokeWidth="1"/>
      <polygon points="72,8 72,55 100,55 100,8" fill="#1f2937" stroke="#4b5563" strokeWidth="1"/>
      <polygon points="0,55 100,55 100,70 0,70" fill="#1c1400"/>
      <line x1="2" y1="55" x2="98" y2="55" stroke="#6b7280" strokeWidth="2"/>
      <text x="50" y="64" fontSize="8" fill="#9ca3af" textAnchor="middle">Parede Rochosa</text>
    </svg>
  )
}
function BlocosRocha() {
  return (
    <svg viewBox="0 0 100 70" width="90" height="62">
      <rect width="100" height="70" fill="#0b1220" rx="3"/>
      <path d="M2,52 Q40,45 98,48" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round"/>
      <polygon points="0,52 100,52 100,70 0,70" fill="#1c1400"/>
      {[[10,45,14],[25,36,18],[42,42,12],[56,34,20],[72,40,14],[88,37,11]].map(([x,y,s],i)=>(
        <g key={i}>
          <polygon points={`${x},${y} ${x+s},${y-5} ${x+s},${y}`} fill="#374151" stroke="#9ca3af" strokeWidth="1"/>
          <ellipse cx={x} cy={y+1} rx={s*0.4} ry={3} fill="#4b5563" stroke="#9ca3af" strokeWidth="1"/>
        </g>
      ))}
      <text x="50" y="64" fontSize="8" fill="#9ca3af" textAnchor="middle">Blocos / Matacões</text>
    </svg>
  )
}

const TIPOS_TALUDE = [
  { id:'natural', label:'Talude Natural',          Icone: TaludeNatural },
  { id:'corte',   label:'Talude de Corte',          Icone: TaludeCorte   },
  { id:'alerta',  label:'Aterro Lançado',           Icone: AlertaLancado },
  { id:'rocha',   label:'Parede Rochosa',           Icone: ParedRochosa  },
  { id:'blocos',  label:'Blocos de Rocha/Matacões', Icone: BlocosRocha   },
]

const CARACT_ENCOSTA = [
  { id:'corte',       label:'Talude de Corte',          desc:'Solo exposto por corte', Icone: TaludeCorteIlus },
  { id:'dist_prox',   label:'Dist. < 2 m',              desc:'Moradia próxima ao talude', Icone: DistMoradiaProxIlus },
  { id:'dist_med',    label:'Dist. 2–5 m',              desc:'Distância moderada', Icone: DistMoradiaMedIlus },
  { id:'aterro',      label:'Aterro Lançado',           desc:'Material não compactado', Icone: AterroLancadoIlus },
  { id:'rocha',       label:'Parede Rochosa',           desc:'Afloramento rochoso', Icone: ParedeRochosaIlus },
  { id:'desliz',      label:'Deslizamentos',            desc:'Evidências de movimentos', Icone: DeslizamentoIlus },
]

const COND_ENCOSTA = [
  { id:'estavel',  label:'Estável',        cor:'#22c55e', icon:'✅', desc:'Sem sinais de instabilidade' },
  { id:'atencao',  label:'Atenção',        cor:'#eab308', icon:'⚠️', desc:'Sinais de movimentação' },
  { id:'critico',  label:'Crítico',        cor:'#ef4444', icon:'🚨', desc:'Risco iminente — evacuação' },
]

const PROCESSOS = [
  { id:'rastejo',     label:'Rastejo / Creep',             icon:'🌀', desc:'Movimentação lenta e contínua' },
  { id:'transl',      label:'Escorregamento Translacional', icon:'↗️', desc:'Ruptura planar, blocos deslizantes' },
  { id:'rotat',       label:'Escorregamento Rotacional',   icon:'🔄', desc:'Ruptura circular / côncava' },
  { id:'queda',       label:'Queda / Tombamento de Blocos',icon:'🪨', desc:'Desprendimento de rocha ou solo' },
  { id:'corrida',     label:'Corrida de Lama/Detritos',   icon:'🌊', desc:'Fluxo rápido saturado' },
  { id:'subsidencia', label:'Subsidência',                 icon:'⬇️', desc:'Recalque / afundamento do solo' },
]

const TIPOS_SOLO = [
  { id:'argiloso', label:'Argiloso/Coeso',   cor:'#b45309', icon:'🟫' },
  { id:'arenoso',  label:'Arenoso/Granular', cor:'#d97706', icon:'🟡' },
  { id:'rocha',    label:'Rocha',            cor:'#6b7280', icon:'⬛' },
  { id:'aterro',   label:'Aterro',           cor:'#78350f', icon:'🟤' },
  { id:'misto',    label:'Misto',            cor:'#059669', icon:'🟩' },
  { id:'organico', label:'Orgânico/Turfoso', cor:'#15803d', icon:'🌿' },
]

const TIPOS_USO = ['Residencial','Comercial','Institucional','Terreno vazio','Área rural']

const PATOLOGIAS = [
  { id:'trinca',    label:'Trinca nas Paredes',      icon:'🧱' },
  { id:'recalque',  label:'Recalque de Fundação',    icon:'🏗️' },
  { id:'umidade',   label:'Umidade/Infiltração',     icon:'💧' },
  { id:'erosao',    label:'Erosão no Terreno',       icon:'🌊' },
  { id:'talude',    label:'Instabilidade de Talude', icon:'⛰️' },
  { id:'cobertura', label:'Cobertura Danificada',    icon:'🏠' },
  { id:'drenagem',  label:'Ausência de Drenagem',   icon:'🚧' },
  { id:'esgoto',    label:'Lançamento de Esgoto',   icon:'⚠️' },
  { id:'fundacao',  label:'Fundação Exposta',        icon:'🏛️' },
  { id:'vegetacao', label:'Vegetação Inadequada',   icon:'🌱' },
  { id:'encosta',   label:'Encosta sem Contenção',  icon:'🗻' },
  { id:'vizinho',   label:'Interferência de Vizinho',icon:'🏘️' },
]

const NIVEIS_RISCO = [
  { value:'R1', label:'Baixo Risco',      color:'#22c55e', Casa: CasaR1, desc:'Terreno estável. Monitoramento periódico.',         ang:'~10–15°' },
  { value:'R2', label:'Médio Risco',      color:'#eab308', Casa: CasaR2, desc:'Instabilidade potencial. Investigação geotécnica.', ang:'~25–30°' },
  { value:'R3', label:'Alto Risco',       color:'#f97316', Casa: CasaR3, desc:'Risco elevado. Obras de contenção urgentes.',        ang:'~40–45°' },
  { value:'R4', label:'Muito Alto Risco', color:'#ef4444', Casa: CasaR4, desc:'Risco geológico severo. Evacuação imediata.',         ang:'>45°'    },
]

// ── Export helpers ───────────────────────────────────────────────
function exportExcel(vistorias) {
  const rows = vistorias.map(v => ({
    'ID':                    v.id,
    'Data':                  v.data ? new Date(v.data).toLocaleString('pt-BR') : '',
    'Nome':                  v.nome || '',
    'CPF':                   v.cpf || '',
    'Telefone':              v.telefone || '',
    'Endereço':              v.endereco || '',
    'Latitude':              v.lat || v.coordenada?.lat || '',
    'Longitude':             v.lng || v.coordenada?.lng || '',
    'Condição da Encosta':   v.condEncosta || '',
    'Ângulo da Encosta':     v.anguloEncosta || '',
    'Características':       Array.isArray(v.caractsEncosta) ? v.caractsEncosta.join('; ') : '',
    'Tipo de Talude':        v.tipoTalude || '',
    'Processos':             Array.isArray(v.processos) ? v.processos.join('; ') : '',
    'Tipo de Solo':          v.solo || '',
    'Uso do Imóvel':         v.tipoUso || v.tipo_uso || '',
    'Moradores':             v.moradores || '',
    'Patologias':            Array.isArray(v.patologias) ? v.patologias.join('; ') : '',
    'Grau de Risco':         v.risco || '',
    'Observações':           v.observacao || '',
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Vistorias')
  XLSX.writeFile(wb, `geovistorias_${new Date().toISOString().slice(0,10)}.xlsx`)
}

async function exportKMZ(vistorias) {
  const placemarks = vistorias
    .filter(v => (v.lat || v.coordenada?.lat) && (v.lng || v.coordenada?.lng))
    .map(v => {
      const lat = v.lat || v.coordenada?.lat
      const lng = v.lng || v.coordenada?.lng
      const cor = NIVEIS_RISCO.find(r => r.value === v.risco)?.color?.replace('#','') || 'ffffff'
      return `
  <Placemark>
    <name>${v.nome || 'Sem nome'} — ${v.risco || ''}</name>
    <description><![CDATA[
      <b>Endereço:</b> ${v.endereco || ''}<br/>
      <b>Risco:</b> ${v.risco || ''}<br/>
      <b>Ângulo:</b> ${v.anguloEncosta || ''}<br/>
      <b>Solo:</b> ${v.solo || ''}<br/>
      <b>Processos:</b> ${Array.isArray(v.processos) ? v.processos.join(', ') : ''}<br/>
      <b>Patologias:</b> ${Array.isArray(v.patologias) ? v.patologias.join(', ') : ''}<br/>
      <b>Observações:</b> ${v.observacao || ''}
    ]]></description>
    <Style><IconStyle><color>ff${cor}</color><scale>1.1</scale></IconStyle></Style>
    <Point><coordinates>${lng},${lat},0</coordinates></Point>
  </Placemark>`
    }).join('\n')
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Geovistorias — ${new Date().toLocaleDateString('pt-BR')}</name>
    ${placemarks}
  </Document>
</kml>`
  const zip = new JSZip()
  zip.file('doc.kml', kml)
  const blob = await zip.generateAsync({ type: 'blob' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `geovistorias_${new Date().toISOString().slice(0,10)}.kmz`
  a.click(); URL.revokeObjectURL(url)
}

// ── Dashboard ───────────────────────────────────────────────────
function Dashboard({ vistorias }) {
  if (vistorias.length === 0) return <div className={styles.vazio}>Nenhuma vistoria registrada.</div>
  const byRisco = NIVEIS_RISCO.map(r => ({ ...r, count: vistorias.filter(v => v.risco === r.value).length }))
  const total = vistorias.length
  const comCoord = vistorias.filter(v => v.lat || v.coordenada?.lat).length
  const processoCounts = {}
  vistorias.forEach(v => { (Array.isArray(v.processos) ? v.processos : []).forEach(p => { processoCounts[p] = (processoCounts[p] || 0) + 1 }) })
  const patCounts = {}
  vistorias.forEach(v => { (Array.isArray(v.patologias) ? v.patologias : []).forEach(p => { patCounts[p] = (patCounts[p] || 0) + 1 }) })
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div className={styles.dashGrid}>
        <div className={styles.dashCard}><div className={styles.dashCardNum}>{total}</div><div className={styles.dashCardLabel}>Total de Vistorias</div></div>
        <div className={styles.dashCard}><div className={styles.dashCardNum} style={{color:'#ef4444'}}>{vistorias.filter(v=>v.risco==='R4').length}</div><div className={styles.dashCardLabel}>R4 — Muito Alto</div></div>
        <div className={styles.dashCard}><div className={styles.dashCardNum} style={{color:'#f97316'}}>{vistorias.filter(v=>v.risco==='R3').length}</div><div className={styles.dashCardLabel}>R3 — Alto Risco</div></div>
        <div className={styles.dashCard}><div className={styles.dashCardNum} style={{color:'#38bdf8'}}>{comCoord}</div><div className={styles.dashCardLabel}>Com GPS</div></div>
      </div>
      <div className={styles.dashSection}>
        <div className={styles.dashTitle}>Distribuição por Grau de Risco</div>
        {byRisco.map(r => (
          <div key={r.value} className={styles.dashBarRow}>
            <span style={{color:r.color, fontWeight:700, minWidth:28}}>{r.value}</span>
            <div className={styles.dashBarTrack}><div className={styles.dashBarFill} style={{width:`${total>0?(r.count/total)*100:0}%`, background:r.color}}/></div>
            <span style={{color:'#94a3b8', minWidth:20, textAlign:'right'}}>{r.count}</span>
          </div>
        ))}
      </div>
      {Object.keys(processoCounts).length > 0 && (
        <div className={styles.dashSection}>
          <div className={styles.dashTitle}>Processos Mais Frequentes</div>
          {Object.entries(processoCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([p,n])=>(
            <div key={p} className={styles.dashBarRow}>
              <span style={{color:'#94a3b8', minWidth:140, fontSize:11}}>{PROCESSOS.find(x=>x.id===p)?.label || p}</span>
              <div className={styles.dashBarTrack}><div className={styles.dashBarFill} style={{width:`${(n/total)*100}%`, background:'#3b82f6'}}/></div>
              <span style={{color:'#94a3b8', minWidth:20, textAlign:'right'}}>{n}</span>
            </div>
          ))}
        </div>
      )}
      {Object.keys(patCounts).length > 0 && (
        <div className={styles.dashSection}>
          <div className={styles.dashTitle}>Patologias Mais Frequentes</div>
          {Object.entries(patCounts).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([p,n])=>(
            <div key={p} className={styles.dashBarRow}>
              <span style={{color:'#94a3b8', minWidth:140, fontSize:11}}>{PATOLOGIAS.find(x=>x.id===p)?.label || p}</span>
              <div className={styles.dashBarTrack}><div className={styles.dashBarFill} style={{width:`${(n/total)*100}%`, background:'#f97316'}}/></div>
              <span style={{color:'#94a3b8', minWidth:20, textAlign:'right'}}>{n}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
        <button className={styles.exportBtn} onClick={() => exportExcel(vistorias)}><FiDownload size={14}/> Exportar Excel</button>
        <button className={styles.exportBtn} style={{background:'#065f46', borderColor:'#065f46'}} onClick={() => exportKMZ(vistorias)}><FiDownload size={14}/> Exportar KMZ</button>
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────
export default function Vistoria() {
  const [abaAtiva, setAbaAtiva] = useState('form')

  const [nome,      setNome]      = useState('')
  const [cpf,       setCpf]       = useState('')
  const [telefone,  setTelefone]  = useState('')
  const [endereco,  setEndereco]  = useState('')
  const [moradores, setMoradores] = useState('')

  const [condEncosta,    setCondEncosta]    = useState('')
  const [anguloEncosta,  setAnguloEncosta]  = useState('')
  const [caractsEncosta, setCaractsEncosta] = useState([])
  const [tipoTalude,     setTipoTalude]     = useState('')
  const [processos,      setProcessos]      = useState([])

  const [solo,    setSolo]    = useState('')
  const [tipoUso, setTipoUso] = useState('')

  const [patologias,  setPatologias]  = useState([])
  const [risco,       setRisco]       = useState('')
  const [observacao,  setObservacao]  = useState('')

  const [vistorias,     setVistorias]     = useState([])
  const [coordAtual,    setCoordAtual]    = useState(null)
  const [sucesso,       setSucesso]       = useState(false)
  const [carregando,    setCarregando]    = useState(false)
  const [gpsLoading,    setGpsLoading]    = useState(false)
  const [gpsErro,       setGpsErro]       = useState('')
  const [showGMSModal,  setShowGMSModal]  = useState(false)
  const [gmsLat,        setGmsLat]        = useState('')
  const [gmsLng,        setGmsLng]        = useState('')
  const [gmsErroModal,  setGmsErroModal]  = useState('')

  useEffect(() => {
    carregar()
    const coord = localStorage.getItem('ultimaCoordenada')
    if (coord) setCoordAtual(JSON.parse(coord))
  }, [])

  async function carregar() {
    setCarregando(true)
    try {
      const dados = await api.getVistorias()
      setVistorias(dados)
    } catch {
      setVistorias(JSON.parse(localStorage.getItem('vistorias') || '[]'))
    } finally {
      setCarregando(false)
    }
  }

  function ativarGPS() {
    if (!navigator.geolocation) { setGpsErro('GPS não disponível neste navegador.'); return }
    setGpsLoading(true); setGpsErro('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        const coord = { lat, lng, accuracy: pos.coords.accuracy }
        setCoordAtual(coord)
        localStorage.setItem('ultimaCoordenada', JSON.stringify(coord))
        setGpsLoading(false)
      },
      () => {
        setGpsErro('Não foi possível obter localização. Verifique as permissões.')
        setGpsLoading(false)
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    )
  }

  function parseGMSToDecimal(gms) {
    if (!gms) return null
    const s = gms.trim()
    // Aceita formatos: 20°31'30.00"S  |  20 31 30.00 S  |  20°31'30,00"S
    const m = s.match(/^(\d+)[°\s](\d+)['\s]([0-9.,]+)["\s]?\s*([NSEWnsewsSoOoO]?)$/)
    if (!m) return null
    const deg = parseFloat(m[1])
    const min = parseFloat(m[2])
    const sec = parseFloat(m[3].replace(',', '.'))
    const dir = (m[4] || '').toUpperCase()
    if (isNaN(deg) || isNaN(min) || isNaN(sec)) return null
    let dec = deg + min / 60 + sec / 3600
    if (dir === 'S' || dir === 'O' || dir === 'W') dec = -dec
    return dec
  }

  function confirmarGMS() {
    setGmsErroModal('')
    const lat = parseGMSToDecimal(gmsLat)
    const lng = parseGMSToDecimal(gmsLng)
    if (lat === null || lng === null) {
      setGmsErroModal('Formato inválido. Exemplo: 20°31\'30.00"S e 43°22\'15.00"O')
      return
    }
    if (lat < -35 || lat > 6 || lng < -75 || lng > -28) {
      setGmsErroModal('Coordenadas fora do Brasil. Verifique os valores.')
      return
    }
    const coord = { lat, lng }
    setCoordAtual(coord)
    localStorage.setItem('ultimaCoordenada', JSON.stringify(coord))
    setShowGMSModal(false)
    setGmsLat('')
    setGmsLng('')
  }

  function toggleProcesso(id) { setProcessos(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]) }
  function togglePatologia(id) { setPatologias(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]) }
  function toggleCaract(id) { setCaractsEncosta(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]) }

  async function salvar(e) {
    e.preventDefault()
    if (!nome || !risco) return alert('Preencha o responsável e o grau de risco.')
    const payload = {
      nome, cpf, telefone, endereco, moradores,
      condEncosta, anguloEncosta, caractsEncosta,
      tipoTalude, processos,
      solo, tipo_uso: tipoUso,
      risco, patologias, observacao,
      cidade: 'ouro_branco',
      lat: coordAtual?.lat,
      lng: coordAtual?.lng,
      data: new Date().toISOString(),
    }
    try {
      await api.createVistoria(payload)
    } catch {
      const dados = JSON.parse(localStorage.getItem('vistorias') || '[]')
      dados.push({ id: Date.now(), ...payload, coordenada: coordAtual })
      localStorage.setItem('vistorias', JSON.stringify(dados))
    }
    setNome(''); setCpf(''); setTelefone(''); setEndereco(''); setMoradores('')
    setCondEncosta(''); setAnguloEncosta(''); setCaractsEncosta([]); setTipoTalude(''); setProcessos([])
    setSolo(''); setTipoUso(''); setRisco(''); setPatologias([]); setObservacao('')
    setSucesso(true); setTimeout(() => setSucesso(false), 3500)
    carregar(); setAbaAtiva('lista')
  }

  async function remover(id) {
    if (!confirm('Remover esta vistoria?')) return
    try { await api.deleteVistoria(id) } catch {
      const lista = JSON.parse(localStorage.getItem('vistorias') || '[]').filter(v => v.id !== id)
      localStorage.setItem('vistorias', JSON.stringify(lista))
    }
    carregar()
  }

  const getRiscoColor = r => NIVEIS_RISCO.find(x => x.value === r)?.color || '#64748b'

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link to='/' className={styles.back}><FiArrowLeft /> Voltar ao Mapa</Link>
        <h1><FiClipboard /> Vistoria Residencial</h1>
        <p className={styles.headerSub}>Modelo NBR 11682 / IPT–Defesa Civil</p>
      </div>

      <div className={styles.abas}>
        {[['form','Nova Vistoria'],['lista',`Realizadas (${vistorias.length})`],['dashboard','Dashboard']].map(([k,l])=>(
          <button key={k} className={`${styles.aba} ${abaAtiva===k?styles.abaAtiva:''}`} onClick={()=>setAbaAtiva(k)}>{l}</button>
        ))}
      </div>

      {/* ── FORMULÁRIO ── */}
      {abaAtiva === 'form' && (
        <div className={styles.formCard}>

          {/* ── GPS + GMS ── */}
          <div className={styles.gpsBox}>
            <div className={styles.gpsLeft}>
              <FiMapPin size={16} color={coordAtual ? '#22c55e' : '#f97316'}/>
              <div>
                {coordAtual ? (
                  <>
                    <div className={styles.gmsLine}>{decToGMS(coordAtual.lat, true)}</div>
                    <div className={styles.gmsLine}>{decToGMS(coordAtual.lng, false)}</div>
                    {coordAtual.accuracy && (
                      <div className={styles.gpsAcc}>Precisão: ±{Math.round(coordAtual.accuracy)} m</div>
                    )}
                  </>
                ) : (
                  <div className={styles.gpsSemCoord}>Localização não definida</div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
              <button type='button' className={`${styles.gpsBtn} ${gpsLoading ? styles.gpsBtnLoad : ''}`} onClick={ativarGPS} disabled={gpsLoading}>
                <FiNavigation size={14}/>
                {gpsLoading ? 'Aguardando GPS...' : 'Capturar GPS'}
              </button>
              <button type='button' className={styles.gmsBtn} onClick={() => { setShowGMSModal(true); setGmsErroModal('') }}>
                <FiMapPin size={13}/>
                Inserir GMS
              </button>
            </div>
          </div>
          {gpsErro && <div className={styles.gpsErro}>{gpsErro}</div>}

          {/* ── Modal GMS ── */}
          {showGMSModal && (
            <div className={styles.gmsModalOverlay} onClick={e => { if (e.target === e.currentTarget) setShowGMSModal(false) }}>
              <div className={styles.gmsModalCard}>
                <h3 className={styles.gmsModalTitle}>Inserir Coordenadas GMS</h3>
                <p className={styles.gmsModalSub}>Graus, Minutos e Segundos (formato GMS)</p>

                {gmsErroModal && <div className={styles.gmsModalErro}>{gmsErroModal}</div>}

                <div className={styles.gmsModalField}>
                  <label className={styles.gmsModalLabel}>Latitude</label>
                  <input
                    className={styles.gmsModalInput}
                    placeholder='20°31′30.00″S'
                    value={gmsLat}
                    onChange={e => setGmsLat(e.target.value)}
                    autoFocus
                  />
                  <div className={styles.gmsModalHint}>Ex: 20°31'30.00"S — use S para Sul</div>
                </div>

                <div className={styles.gmsModalField}>
                  <label className={styles.gmsModalLabel}>Longitude</label>
                  <input
                    className={styles.gmsModalInput}
                    placeholder='43°22′15.00″O'
                    value={gmsLng}
                    onChange={e => setGmsLng(e.target.value)}
                  />
                  <div className={styles.gmsModalHint}>Ex: 43°22'15.00"O — use O ou W para Oeste</div>
                </div>

                <div className={styles.gmsModalBtns}>
                  <button type='button' className={styles.gmsModalConfirm} onClick={confirmarGMS}>
                    <FiMapPin size={13}/> Confirmar
                  </button>
                  <button type='button' className={styles.gmsModalCancel} onClick={() => setShowGMSModal(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={salvar} className={styles.form}>

            {/* ── 1. Dados do Responsável ── */}
            <div className={styles.section}>
              <h3>1. Dados do Responsável / Morador</h3>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Nome *</label>
                  <input placeholder='Nome completo' value={nome} onChange={e=>setNome(e.target.value)} required/>
                </div>
                <div className={styles.field}>
                  <label>CPF</label>
                  <input placeholder='000.000.000-00' value={cpf} onChange={e=>setCpf(e.target.value)}/>
                </div>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Telefone</label>
                  <input placeholder='(00) 00000-0000' value={telefone} onChange={e=>setTelefone(e.target.value)}/>
                </div>
                <div className={styles.field}>
                  <label>Endereço</label>
                  <input placeholder='Rua, número, bairro' value={endereco} onChange={e=>setEndereco(e.target.value)}/>
                </div>
              </div>
              <div className={styles.field} style={{marginTop:10}}>
                <label>Nº de Moradores</label>
                <input type='number' min='0' placeholder='0' value={moradores} onChange={e=>setMoradores(e.target.value)} style={{maxWidth:120}}/>
              </div>
            </div>

            {/* ── 2. Condição da Encosta ── */}
            <div className={styles.section}>
              <h3>2. Condição da Encosta / Área</h3>
              <div className={styles.condGrid}>
                {COND_ENCOSTA.map(c=>(
                  <button type='button' key={c.id}
                    className={`${styles.condBtn} ${condEncosta===c.id ? styles.condBtnAtivo : ''}`}
                    style={condEncosta===c.id ? {borderColor:c.cor, background:c.cor+'22'} : {}}
                    onClick={()=>setCondEncosta(condEncosta===c.id?'':c.id)}
                  >
                    <span className={styles.condIcon}>{c.icon}</span>
                    <span style={{fontWeight:700, color: condEncosta===c.id ? c.cor : '#e2e8f0'}}>{c.label}</span>
                    <span className={styles.condDesc}>{c.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── 3. Situação em Relação à Encosta (ângulos) ── */}
            <div className={styles.section}>
              <h3>3. Situação da Moradia em Relação à Encosta</h3>
              <p className={styles.sectionHint}>Selecione o ângulo que melhor representa a inclinação da encosta próxima à moradia</p>
              <div className={styles.anguloGrid}>
                {ANGULOS_ENCOSTA.map(a=>(
                  <button type='button' key={a.ang}
                    className={`${styles.anguloBtn} ${anguloEncosta===String(a.ang) ? styles.anguloBtnAtivo : ''}`}
                    style={anguloEncosta===String(a.ang) ? {borderColor:a.cor, background:a.cor+'18', boxShadow:`0 0 0 2px ${a.cor}44`} : {}}
                    onClick={()=>setAnguloEncosta(anguloEncosta===String(a.ang)?'':String(a.ang))}
                  >
                    <a.SVG/>
                    <div className={styles.anguloBadge} style={{background:a.cor+'22', borderColor:a.cor+'66', color:a.cor}}>
                      {a.label} &nbsp;<span style={{fontSize:9, opacity:0.8}}>({a.risco})</span>
                    </div>
                    {anguloEncosta===String(a.ang) && <span className={styles.checkMark} style={{color:a.cor}}>✓</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 4. Características da Encosta ── */}
            <div className={styles.section}>
              <h3>4. Características da Encosta / Talude</h3>
              <p className={styles.sectionHint}>Selecione todas que se aplicam ao local vistoriado</p>
              <div className={styles.caractGrid}>
                {CARACT_ENCOSTA.map(c=>(
                  <button type='button' key={c.id}
                    className={`${styles.caractBtn} ${caractsEncosta.includes(c.id) ? styles.caractBtnAtivo : ''}`}
                    onClick={()=>toggleCaract(c.id)}
                  >
                    <c.Icone/>
                    <div className={styles.caractInfo}>
                      <div className={styles.caractLabel}>{c.label}</div>
                      <div className={styles.caractDesc}>{c.desc}</div>
                    </div>
                    {caractsEncosta.includes(c.id) && <FiCheckCircle size={14} color='#38bdf8' style={{marginLeft:'auto', flexShrink:0}}/>}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 5. Tipo de Encosta / Talude ── */}
            <div className={styles.section}>
              <h3>5. Tipo de Encosta / Talude</h3>
              <p className={styles.sectionHint}>Selecione o que melhor representa a situação do local</p>
              <div className={styles.taludeGrid}>
                {TIPOS_TALUDE.map(t=>(
                  <button type='button' key={t.id}
                    className={`${styles.taludeBtn} ${tipoTalude===t.id ? styles.taludeBtnAtivo : ''}`}
                    onClick={()=>setTipoTalude(tipoTalude===t.id?'':t.id)}
                  >
                    <t.Icone/>
                    <span className={styles.taludeLabel}>{t.label}</span>
                    {tipoTalude===t.id && <span className={styles.checkMark}>✓</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 6. Processos Identificados ── */}
            <div className={styles.section}>
              <h3>6. Processos Identificados</h3>
              <p className={styles.sectionHint}>Selecione todos que se aplicam</p>
              <div className={styles.processoGrid}>
                {PROCESSOS.map(p=>(
                  <button type='button' key={p.id}
                    className={`${styles.processoBtn} ${processos.includes(p.id)?styles.processoBtnAtivo:''}`}
                    onClick={()=>toggleProcesso(p.id)}
                  >
                    <span className={styles.processoIcon}>{p.icon}</span>
                    <div>
                      <div className={styles.processoLabel}>{p.label}</div>
                      <div className={styles.processoDesc}>{p.desc}</div>
                    </div>
                    {processos.includes(p.id) && <FiCheckCircle size={14} color='#38bdf8' style={{marginLeft:'auto', flexShrink:0}}/>}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 7. Solo e Imóvel ── */}
            <div className={styles.section}>
              <h3>7. Tipo de Solo</h3>
              <div className={styles.soloGrid}>
                {TIPOS_SOLO.map(s=>(
                  <button type='button' key={s.id}
                    className={`${styles.soloBtn} ${solo===s.id?styles.soloBtnAtivo:''}`}
                    style={solo===s.id?{borderColor:s.cor, background:s.cor+'22'}:{}}
                    onClick={()=>setSolo(solo===s.id?'':s.id)}
                  >
                    <span style={{fontSize:18}}>{s.icon}</span>
                    <span style={{fontSize:12, fontWeight:600, color:solo===s.id?s.cor:'#94a3b8'}}>{s.label}</span>
                  </button>
                ))}
              </div>
              <div className={styles.field} style={{marginTop:14}}>
                <label>Uso do Imóvel</label>
                <div className={styles.usoGrid}>
                  {TIPOS_USO.map(u=>(
                    <button type='button' key={u}
                      className={`${styles.usoBtn} ${tipoUso===u?styles.usoBtnAtivo:''}`}
                      onClick={()=>setTipoUso(tipoUso===u?'':u)}
                    >{u}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── 8. Patologias ── */}
            <div className={styles.section}>
              <h3>8. Patologias Identificadas</h3>
              <div className={styles.patGrid}>
                {PATOLOGIAS.map(p=>(
                  <button type='button' key={p.id}
                    className={`${styles.patBtn} ${patologias.includes(p.id)?styles.patBtnAtivo:''}`}
                    onClick={()=>togglePatologia(p.id)}
                  >
                    <span>{p.icon}</span>
                    <span>{p.label}</span>
                    {patologias.includes(p.id) && <span className={styles.patCheck}>✓</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 9. Grau de Risco ── */}
            <div className={styles.section}>
              <h3>9. Grau de Risco — NBR 11682 / IPT</h3>
              <p className={styles.sectionHint}>Selecione o nível que representa a situação observada</p>
              <div className={styles.riscoGrid}>
                {NIVEIS_RISCO.map(n=>(
                  <button type='button' key={n.value}
                    className={`${styles.riscoBtn} ${risco===n.value?styles.riscoBtnAtivo:''}`}
                    style={risco===n.value?{borderColor:n.color, background:n.color+'18'}:{}}
                    onClick={()=>setRisco(risco===n.value?'':n.value)}
                  >
                    <div className={styles.riscoCasa}><n.Casa/></div>
                    <div style={{textAlign:'center'}}>
                      <div className={styles.riscoBadge} style={{background:n.color}}>{n.value}</div>
                      <div className={styles.riscoLabel}>{n.label}</div>
                      <div className={styles.riscoDesc}>{n.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ── 10. Observações ── */}
            <div className={styles.section}>
              <label className={styles.obsLabel}>10. Observações Técnicas</label>
              <textarea
                placeholder='Condições técnicas, medidas recomendadas, referências de campo...'
                value={observacao}
                onChange={e=>setObservacao(e.target.value)}
                rows={4}
              />
            </div>

            <button type='submit' className={styles.saveBtn}>
              <FiSave/> Salvar Vistoria
            </button>
            {sucesso && (
              <div className={styles.sucesso}>
                <FiCheckCircle size={16}/> Vistoria salva com sucesso!
              </div>
            )}
          </form>
        </div>
      )}

      {/* ── LISTA ── */}
      {abaAtiva === 'lista' && (
        <div className={styles.listaCard}>
          <div style={{display:'flex', gap:10, marginBottom:16, flexWrap:'wrap'}}>
            <button className={styles.exportBtn} onClick={() => exportExcel(vistorias)}><FiDownload size={13}/> Exportar Excel</button>
            <button className={styles.exportBtn} style={{background:'#065f46', borderColor:'#065f46'}} onClick={() => exportKMZ(vistorias)}><FiDownload size={13}/> Exportar KMZ</button>
          </div>
          {carregando ? (
            <div className={styles.vazio}>Carregando...</div>
          ) : vistorias.length === 0 ? (
            <div className={styles.vazio}>Nenhuma vistoria registrada ainda.</div>
          ) : (
            <div className={styles.lista}>
              {[...vistorias].reverse().map(v => (
                <div key={v.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <div className={styles.cardNome}>
                      <span className={styles.riscoBadgeSm} style={{background:getRiscoColor(v.risco)}}>{v.risco}</span>
                      {v.nome}
                    </div>
                    <button className={styles.deleteBtn} onClick={() => remover(v.id)}><FiTrash2 size={14}/></button>
                  </div>
                  <div className={styles.cardGrid}>
                    {v.endereco   && <span><strong>Endereço:</strong> {v.endereco}</span>}
                    {v.solo       && <span><strong>Solo:</strong> {TIPOS_SOLO.find(s=>s.id===v.solo)?.label || v.solo}</span>}
                    {(v.tipoUso||v.tipo_uso) && <span><strong>Uso:</strong> {v.tipoUso||v.tipo_uso}</span>}
                    {v.condEncosta && <span><strong>Encosta:</strong> {COND_ENCOSTA.find(c=>c.id===v.condEncosta)?.label || v.condEncosta}</span>}
                    {v.anguloEncosta && <span><strong>Ângulo:</strong> {v.anguloEncosta}°</span>}
                    {v.tipoTalude && <span><strong>Talude:</strong> {TIPOS_TALUDE.find(t=>t.id===v.tipoTalude)?.label || v.tipoTalude}</span>}
                    {v.moradores  && <span><strong>Moradores:</strong> {v.moradores}</span>}
                    {v.telefone   && <span><strong>Tel:</strong> {v.telefone}</span>}
                  </div>
                  {Array.isArray(v.processos) && v.processos.length > 0 && (
                    <div className={styles.tagRow}>
                      <FiAlertTriangle size={11} color='#f97316'/>
                      {v.processos.map(p=>(
                        <span key={p} className={styles.tagProcesso}>
                          {PROCESSOS.find(x=>x.id===p)?.icon} {PROCESSOS.find(x=>x.id===p)?.label.split('/')[0] || p}
                        </span>
                      ))}
                    </div>
                  )}
                  {Array.isArray(v.patologias) && v.patologias.length > 0 && (
                    <div className={styles.patologiasLista}>
                      {v.patologias.map(p=>(
                        <span key={p} className={styles.patTag}>{PATOLOGIAS.find(x=>x.id===p)?.icon} {PATOLOGIAS.find(x=>x.id===p)?.label || p}</span>
                      ))}
                    </div>
                  )}
                  {v.observacao && <div className={styles.obs}>{v.observacao}</div>}
                  {(v.lat||v.coordenada?.lat) && (
                    <div className={styles.coord}>
                      <FiMapPin size={10}/>
                      {decToGMS(v.lat||v.coordenada?.lat, true)} &nbsp;
                      {decToGMS(v.lng||v.coordenada?.lng, false)}
                    </div>
                  )}
                  <div className={styles.data}>{v.data?new Date(v.data).toLocaleString('pt-BR'):''}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── DASHBOARD ── */}
      {abaAtiva === 'dashboard' && (
        <div className={styles.listaCard}>
          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:20}}>
            <FiBarChart2 size={18} color='#38bdf8'/>
            <span style={{fontWeight:700, fontSize:16, color:'#f0f9ff'}}>Dashboard de Vistorias</span>
          </div>
          <Dashboard vistorias={vistorias}/>
        </div>
      )}
    </div>
  )
}
