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

// ── SVGs: Ângulos de Encosta (Seção 3 — Situação da Moradia) ─────
function EncostaSVG10() {
  return (
    <svg viewBox="0 0 160 100" width="150" height="94">
      <rect width="160" height="100" fill="#f0f9ff" rx="4"/>
      <rect width="160" height="68" fill="#dbeafe"/>
      <ellipse cx="128" cy="16" rx="14" ry="6" fill="#fff" opacity="0.8"/>
      <ellipse cx="118" cy="20" rx="10" ry="5" fill="#fff" opacity="0.8"/>
      <ellipse cx="138" cy="21" rx="9" ry="5" fill="#fff" opacity="0.8"/>
      {/* Terreno plano → encosta 10° */}
      <polygon points="0,68 110,68 160,59 160,100 0,100" fill="#c8a97a"/>
      <polygon points="0,68 110,68 160,59 160,63" fill="#a07845"/>
      <line x1="0" y1="68" x2="110" y2="68" stroke="#22c55e" strokeWidth="2"/>
      <line x1="110" y1="68" x2="160" y2="59" stroke="#22c55e" strokeWidth="2"/>
      {[8,24,40,56,72,90].map((x,i)=>(
        <line key={i} x1={x} y1="68" x2={x+3} y2="63" stroke="#16a34a" strokeWidth="1.2" opacity="0.7"/>
      ))}
      <path d="M 110,68 A 22,22 0 0,1 131.7,64.1" fill="none" stroke="#16a34a" strokeWidth="1.5"/>
      <text x="134" y="67" fontSize="9" fill="#16a34a" fontWeight="bold">10°</text>
      {/* Casa estável */}
      <rect x="14" y="47" width="38" height="21" fill="#ffffff" stroke="#16a34a" strokeWidth="2"/>
      <polygon points="11,47 33,32 55,47" fill="#16a34a"/>
      <rect x="20" y="57" width="9" height="11" rx="1" fill="#bae6fd" stroke="#0ea5e9" strokeWidth="0.8"/>
      <rect x="37" y="53" width="10" height="9" rx="1" fill="#bae6fd" stroke="#0ea5e9" strokeWidth="0.8"/>
      <rect x="27" y="57" width="8" height="11" rx="1" fill="#a16207" stroke="#78350f" strokeWidth="0.8"/>
      <line x1="14" y1="68" x2="52" y2="68" stroke="#16a34a" strokeWidth="1.5"/>
      {/* Check de OK */}
      <circle cx="148" cy="24" r="8" fill="#16a34a"/>
      <polyline points="144,24 147,27 152,20" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="4" y="82" width="152" height="14" fill="#dcfce7" rx="3"/>
      <text x="80" y="92" fontSize="8.5" fill="#15803d" textAnchor="middle" fontWeight="700">Encosta suave — R1 — Estável</text>
    </svg>
  )
}

function EncostaSVG17() {
  return (
    <svg viewBox="0 0 160 100" width="150" height="94">
      <rect width="160" height="100" fill="#f0f9ff" rx="4"/>
      <rect width="160" height="68" fill="#d9f0fe"/>
      <ellipse cx="125" cy="14" rx="13" ry="6" fill="#fff" opacity="0.8"/>
      <ellipse cx="115" cy="18" rx="10" ry="5" fill="#fff" opacity="0.8"/>
      {/* Terreno plano → encosta 17° */}
      <polygon points="0,68 100,68 160,51 160,100 0,100" fill="#c8a97a"/>
      <polygon points="0,68 100,68 160,51 160,56" fill="#a07845"/>
      <line x1="0" y1="68" x2="100" y2="68" stroke="#65a30d" strokeWidth="2"/>
      <line x1="100" y1="68" x2="160" y2="51" stroke="#65a30d" strokeWidth="2"/>
      {[8,24,40,56,78].map((x,i)=>(
        <line key={i} x1={x} y1="68" x2={x+3} y2="63" stroke="#65a30d" strokeWidth="1.2" opacity="0.7"/>
      ))}
      <path d="M 100,68 A 22,22 0 0,1 121.1,59.6" fill="none" stroke="#65a30d" strokeWidth="1.5"/>
      <text x="123" y="62" fontSize="9" fill="#65a30d" fontWeight="bold">17°</text>
      <rect x="12" y="47" width="38" height="21" fill="#ffffff" stroke="#65a30d" strokeWidth="2"/>
      <polygon points="9,47 31,32 53,47" fill="#65a30d"/>
      <rect x="18" y="57" width="9" height="11" rx="1" fill="#fef9c3" stroke="#a16207" strokeWidth="0.8"/>
      <rect x="35" y="53" width="10" height="9" rx="1" fill="#fef9c3" stroke="#a16207" strokeWidth="0.8"/>
      <rect x="24" y="57" width="8" height="11" rx="1" fill="#a16207" stroke="#78350f" strokeWidth="0.8"/>
      <line x1="12" y1="68" x2="50" y2="68" stroke="#65a30d" strokeWidth="1.5"/>
      <rect x="4" y="82" width="152" height="14" fill="#ecfccb" rx="3"/>
      <text x="80" y="92" fontSize="8.5" fill="#4d7c0f" textAnchor="middle" fontWeight="700">Inclinação leve — R1–R2 — Monitorar</text>
    </svg>
  )
}

function EncostaSVG30() {
  return (
    <svg viewBox="0 0 160 100" width="150" height="94">
      <rect width="160" height="100" fill="#fefce8" rx="4"/>
      <rect width="160" height="68" fill="#fef3c7"/>
      {/* Terreno plano → encosta 30° */}
      <polygon points="0,68 95,68 160,34 160,100 0,100" fill="#c8a97a"/>
      <polygon points="0,68 95,68 160,34 160,39" fill="#a07845"/>
      <line x1="0" y1="68" x2="95" y2="68" stroke="#ca8a04" strokeWidth="2"/>
      <line x1="95" y1="68" x2="160" y2="34" stroke="#ca8a04" strokeWidth="2.5"/>
      {[8,24,42,62,80].map((x,i)=>(
        <line key={i} x1={x} y1="68" x2={x+3} y2="63" stroke="#a16207" strokeWidth="1.2" opacity="0.6"/>
      ))}
      <path d="M 95,68 A 20,20 0 0,1 112.3,58" fill="none" stroke="#ca8a04" strokeWidth="1.5"/>
      <text x="114" y="61" fontSize="9" fill="#ca8a04" fontWeight="bold">30°</text>
      {/* Triângulo de atenção */}
      <polygon points="148,40 156,26 156,54" fill="#ca8a04" opacity="0.85"/>
      <text x="153" y="44" fontSize="9" fill="#fff" textAnchor="middle" fontWeight="bold">!</text>
      <rect x="12" y="47" width="38" height="21" fill="#ffffff" stroke="#ca8a04" strokeWidth="2"/>
      <polygon points="9,47 31,31 53,47" fill="#ca8a04"/>
      <rect x="18" y="57" width="9" height="11" rx="1" fill="#fef08a" stroke="#a16207" strokeWidth="0.8"/>
      <rect x="35" y="53" width="10" height="9" rx="1" fill="#fef08a" stroke="#a16207" strokeWidth="0.8"/>
      <rect x="24" y="57" width="8" height="11" rx="1" fill="#a16207" stroke="#78350f" strokeWidth="0.8"/>
      <line x1="12" y1="68" x2="50" y2="68" stroke="#ca8a04" strokeWidth="1.5"/>
      <rect x="4" y="82" width="152" height="14" fill="#fef9c3" rx="3"/>
      <text x="80" y="92" fontSize="8.5" fill="#a16207" textAnchor="middle" fontWeight="700">Inclinação moderada — R2 — Atenção</text>
    </svg>
  )
}

function EncostaSVG60() {
  return (
    <svg viewBox="0 0 160 100" width="150" height="94">
      <rect width="160" height="100" fill="#fff7ed" rx="4"/>
      <rect width="160" height="68" fill="#ffedd5"/>
      {/* Terreno plano → encosta 60° → platô */}
      <polygon points="0,68 100,68 135,10 160,10 160,100 0,100" fill="#c8a97a"/>
      <polygon points="100,68 135,10 160,10 160,15" fill="#a07845"/>
      <line x1="0" y1="68" x2="100" y2="68" stroke="#ea580c" strokeWidth="2"/>
      <line x1="100" y1="68" x2="135" y2="10" stroke="#ea580c" strokeWidth="2.5"/>
      <line x1="135" y1="10" x2="160" y2="10" stroke="#ea580c" strokeWidth="1.5" opacity="0.5"/>
      <path d="M 100,68 A 17,17 0 0,1 108.5,53.3" fill="none" stroke="#ea580c" strokeWidth="1.5"/>
      <text x="110" y="56" fontSize="9" fill="#ea580c" fontWeight="bold">60°</text>
      {/* Ícone de perigo */}
      <polygon points="148,16 156,6 156,26" fill="#ea580c" opacity="0.9"/>
      <text x="152" y="22" fontSize="9" fill="#fff" textAnchor="middle" fontWeight="bold">!</text>
      <rect x="12" y="47" width="36" height="21" fill="#fff7ed" stroke="#ea580c" strokeWidth="2"/>
      <polygon points="9,47 30,31 51,47" fill="#ea580c"/>
      <rect x="18" y="57" width="8" height="11" rx="1" fill="#fed7aa" stroke="#c2410c" strokeWidth="0.8"/>
      <rect x="33" y="53" width="10" height="9" rx="1" fill="#fed7aa" stroke="#c2410c" strokeWidth="0.8"/>
      <rect x="22" y="57" width="7" height="11" rx="1" fill="#c2410c" stroke="#9a3412" strokeWidth="0.8"/>
      <line x1="12" y1="68" x2="48" y2="68" stroke="#ea580c" strokeWidth="1.5"/>
      <rect x="4" y="82" width="152" height="14" fill="#ffedd5" rx="3"/>
      <text x="80" y="92" fontSize="8.5" fill="#c2410c" textAnchor="middle" fontWeight="700">Encosta acentuada — R3–R4 — Risco</text>
    </svg>
  )
}

function EncostaSVG90() {
  return (
    <svg viewBox="0 0 160 100" width="150" height="94">
      <rect width="160" height="100" fill="#fff1f2" rx="4"/>
      <rect width="160" height="68" fill="#ffe4e6"/>
      {/* Paredão vertical a x=95 */}
      <polygon points="0,68 95,68 95,8 160,8 160,100 0,100" fill="#c8a97a"/>
      <rect x="95" y="8" width="65" height="60" fill="#b8956a"/>
      {/* Listras de camadas na parede */}
      {[18,28,38,48,58].map((y,i)=>(
        <line key={i} x1="95" y1={y} x2="160" y2={y} stroke="#8b6340" strokeWidth="0.8" opacity="0.5"/>
      ))}
      <line x1="0" y1="68" x2="95" y2="68" stroke="#dc2626" strokeWidth="2"/>
      <line x1="95" y1="8" x2="95" y2="68" stroke="#dc2626" strokeWidth="3"/>
      {/* Ângulo reto indicador */}
      <rect x="95" y="60" width="9" height="8" fill="none" stroke="#dc2626" strokeWidth="2"/>
      <text x="107" y="70" fontSize="9" fill="#dc2626" fontWeight="bold">90°</text>
      {/* Ícone de perigo */}
      <polygon points="135,14 143,28 127,28" fill="#dc2626"/>
      <text x="135" y="25" fontSize="9" fill="#fff" textAnchor="middle" fontWeight="bold">!</text>
      <rect x="12" y="46" width="36" height="22" fill="#ffe4e6" stroke="#dc2626" strokeWidth="2"/>
      <polygon points="9,46 30,31 51,46" fill="#dc2626"/>
      <rect x="18" y="57" width="8" height="11" rx="1" fill="#fecaca" stroke="#b91c1c" strokeWidth="0.8"/>
      <rect x="33" y="52" width="10" height="9" rx="1" fill="#fecaca" stroke="#b91c1c" strokeWidth="0.8"/>
      <rect x="22" y="57" width="7" height="11" rx="1" fill="#b91c1c" stroke="#7f1d1d" strokeWidth="0.8"/>
      <line x1="12" y1="68" x2="48" y2="68" stroke="#dc2626" strokeWidth="1.5"/>
      <rect x="4" y="82" width="152" height="14" fill="#ffe4e6" rx="3"/>
      <text x="80" y="92" fontSize="8.5" fill="#b91c1c" textAnchor="middle" fontWeight="700">Paredão vertical — R4 CRÍTICO</text>
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

// ── SVGs: Características da Encosta / Talude (Seção 4) ─────────
function TaludeCorteIlus() {
  return (
    <svg viewBox="0 0 110 80" width="100" height="72">
      <rect width="110" height="80" fill="#f0f9ff" rx="3"/>
      <rect width="110" height="50" fill="#dbeafe"/>
      <ellipse cx="88" cy="12" rx="12" ry="5" fill="#fff" opacity="0.8"/>
      {/* Perfil: plano esq → face de corte → platô */}
      <polygon points="0,50 50,50 50,20 110,20 110,80 0,80" fill="#c8a97a"/>
      <polygon points="50,50 50,20 110,20 110,25" fill="#a07845"/>
      {/* Camadas de solo na face */}
      {[26,32,38,44].map((y,i)=>(
        <line key={i} x1="50" y1={y} x2="110" y2={y} stroke="#8b6340" strokeWidth="0.9" opacity="0.5"/>
      ))}
      <line x1="2" y1="50" x2="50" y2="50" stroke="#eab308" strokeWidth="2"/>
      <line x1="50" y1="50" x2="50" y2="20" stroke="#eab308" strokeWidth="2.5"/>
      <line x1="50" y1="20" x2="108" y2="20" stroke="#eab308" strokeWidth="2"/>
      <text x="54" y="36" fontSize="7" fill="#92400e" fontWeight="600">face de</text>
      <text x="54" y="45" fontSize="7" fill="#92400e" fontWeight="600">corte</text>
      {/* Casa */}
      <rect x="6" y="34" width="26" height="16" fill="#fff" stroke="#ca8a04" strokeWidth="1.2"/>
      <polygon points="4,34 19,24 34,34" fill="#ca8a04"/>
      <rect x="12" y="42" width="6" height="8" rx="1" fill="#bae6fd"/>
      <rect x="66" y="67" width="110" height="13" fill="#fef9c3"/>
      <rect x="0" y="67" width="110" height="13" fill="#fef9c3" rx="3"/>
      <text x="55" y="77" fontSize="8" fill="#92400e" textAnchor="middle" fontWeight="700">Talude de Corte</text>
    </svg>
  )
}

function DistMoradiaProxIlus() {
  return (
    <svg viewBox="0 0 110 80" width="100" height="72">
      <rect width="110" height="80" fill="#fff1f2" rx="3"/>
      <rect width="110" height="50" fill="#ffe4e6"/>
      {/* Encosta à direita */}
      <polygon points="0,50 72,50 72,14 110,14 110,80 0,80" fill="#c8a97a"/>
      <polygon points="72,50 72,14 110,14 110,19" fill="#a07845"/>
      <line x1="2" y1="50" x2="72" y2="50" stroke="#ef4444" strokeWidth="2"/>
      <line x1="72" y1="50" x2="72" y2="14" stroke="#ef4444" strokeWidth="2.5"/>
      {/* Casa muito próxima */}
      <rect x="40" y="34" width="26" height="16" fill="#ffe4e6" stroke="#dc2626" strokeWidth="1.5"/>
      <polygon points="38,34 53,22 66,34" fill="#dc2626"/>
      <rect x="48" y="43" width="6" height="7" rx="1" fill="#fecaca"/>
      {/* Dimensão < 2m com seta dupla */}
      <line x1="66" y1="46" x2="72" y2="46" stroke="#dc2626" strokeWidth="1.5"/>
      <line x1="66" y1="43" x2="66" y2="49" stroke="#dc2626" strokeWidth="1.5"/>
      <line x1="72" y1="43" x2="72" y2="49" stroke="#dc2626" strokeWidth="1.5"/>
      <text x="69" y="42" fontSize="7" fill="#dc2626" textAnchor="middle" fontWeight="700">{'<'}2m</text>
      {/* Triângulo de perigo */}
      <polygon points="90,20 98,34 82,34" fill="#dc2626"/>
      <text x="90" y="31" fontSize="9" fill="#fff" textAnchor="middle" fontWeight="bold">!</text>
      <rect x="0" y="67" width="110" height="13" fill="#ffe4e6" rx="3"/>
      <text x="55" y="77" fontSize="8" fill="#b91c1c" textAnchor="middle" fontWeight="700">Dist. {'<'} 2 m — Perigo</text>
    </svg>
  )
}

function DistMoradiaMedIlus() {
  return (
    <svg viewBox="0 0 110 80" width="100" height="72">
      <rect width="110" height="80" fill="#fefce8" rx="3"/>
      <rect width="110" height="50" fill="#fef3c7"/>
      {/* Encosta à direita */}
      <polygon points="0,50 80,50 80,14 110,14 110,80 0,80" fill="#c8a97a"/>
      <polygon points="80,50 80,14 110,14 110,19" fill="#a07845"/>
      <line x1="2" y1="50" x2="80" y2="50" stroke="#ca8a04" strokeWidth="2"/>
      <line x1="80" y1="50" x2="80" y2="14" stroke="#ca8a04" strokeWidth="2.5"/>
      {/* Casa com distância moderada */}
      <rect x="30" y="34" width="26" height="16" fill="#fff" stroke="#ca8a04" strokeWidth="1.5"/>
      <polygon points="28,34 43,22 56,34" fill="#ca8a04"/>
      <rect x="38" y="43" width="6" height="7" rx="1" fill="#fef9c3"/>
      {/* Dimensão 2-5m */}
      <line x1="56" y1="46" x2="80" y2="46" stroke="#ca8a04" strokeWidth="1.5"/>
      <line x1="56" y1="43" x2="56" y2="49" stroke="#ca8a04" strokeWidth="1.5"/>
      <line x1="80" y1="43" x2="80" y2="49" stroke="#ca8a04" strokeWidth="1.5"/>
      <text x="68" y="42" fontSize="7" fill="#ca8a04" textAnchor="middle" fontWeight="700">2–5m</text>
      {/* Símbolo de atenção */}
      <polygon points="96,20 104,34 88,34" fill="#ca8a04"/>
      <text x="96" y="31" fontSize="9" fill="#fff" textAnchor="middle" fontWeight="bold">!</text>
      <rect x="0" y="67" width="110" height="13" fill="#fef9c3" rx="3"/>
      <text x="55" y="77" fontSize="8" fill="#a16207" textAnchor="middle" fontWeight="700">Dist. 2–5 m — Atenção</text>
    </svg>
  )
}

function AterroLancadoIlus() {
  return (
    <svg viewBox="0 0 110 80" width="100" height="72">
      <rect width="110" height="80" fill="#fff7ed" rx="3"/>
      <rect width="110" height="50" fill="#ffedd5"/>
      {/* Superfície irregular do aterro */}
      <polygon points="0,50 14,44 26,48 40,36 56,44 70,34 86,42 110,36 110,80 0,80" fill="#c49a58"/>
      <polygon points="0,50 14,44 26,48 40,36 56,44 70,34 86,42 110,36 110,42 86,48 70,40 56,50 40,42 26,54 14,50 0,55" fill="#a07845"/>
      {/* Solo original pontilhado */}
      <line x1="0" y1="50" x2="110" y2="50" stroke="#92400e" strokeWidth="1.5" strokeDasharray="5,3" opacity="0.7"/>
      {/* Setas de material caindo */}
      {[18,38,58,82].map((x,i)=>(
        <g key={i}>
          <line x1={x} y1={[28,22,26,24][i]} x2={x} y2={[38,32,36,34][i]} stroke="#f97316" strokeWidth="1.5"/>
          <polygon points={`${x-3},${[36,30,34,32][i]} ${x+3},${[36,30,34,32][i]} ${x},${[42,36,40,38][i]}`} fill="#f97316"/>
        </g>
      ))}
      {/* Casa */}
      <rect x="5" y="36" width="22" height="14" fill="#fff" stroke="#f97316" strokeWidth="1.2"/>
      <polygon points="3,36 16,26 29,36" fill="#f97316" opacity="0.7"/>
      <rect x="11" y="43" width="5" height="7" rx="1" fill="#fed7aa"/>
      <rect x="0" y="67" width="110" height="13" fill="#ffedd5" rx="3"/>
      <text x="55" y="77" fontSize="8" fill="#c2410c" textAnchor="middle" fontWeight="700">Aterro Lançado — Risco</text>
    </svg>
  )
}

function ParedeRochosaIlus() {
  return (
    <svg viewBox="0 0 110 80" width="100" height="72">
      <rect width="110" height="80" fill="#f8fafc" rx="3"/>
      <rect width="110" height="50" fill="#f1f5f9"/>
      {/* Parede de rocha */}
      <rect x="60" y="8" width="50" height="42" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="1.2"/>
      {/* Blocos de rocha */}
      {[[60,8,24,14],[84,8,26,14],[60,22,20,14],[80,22,30,14],[60,36,22,12],[82,36,28,12]].map(([x,y,w,h],i)=>(
        <rect key={i} x={x} y={y} width={w} height={h} fill="none" stroke="#6b7280" strokeWidth="0.8"/>
      ))}
      {[22,36].map((y,i)=>(
        <line key={i} x1="60" y1={y} x2="110" y2={y} stroke="#6b7280" strokeWidth="1" opacity="0.6"/>
      ))}
      <polygon points="0,50 60,50 110,50 110,80 0,80" fill="#c8a97a"/>
      <line x1="0" y1="50" x2="110" y2="50" stroke="#6b7280" strokeWidth="2"/>
      <line x1="60" y1="8" x2="60" y2="50" stroke="#94a3b8" strokeWidth="2.5"/>
      {/* Casa */}
      <rect x="8" y="34" width="26" height="16" fill="#fff" stroke="#6b7280" strokeWidth="1.2"/>
      <polygon points="6,34 21,24 36,34" fill="#94a3b8"/>
      <rect x="14" y="42" width="6" height="8" rx="1" fill="#dbeafe"/>
      <rect x="0" y="67" width="110" height="13" fill="#f1f5f9" rx="3"/>
      <text x="55" y="77" fontSize="8" fill="#475569" textAnchor="middle" fontWeight="700">Parede Rochosa</text>
    </svg>
  )
}

function DeslizamentoIlus() {
  return (
    <svg viewBox="0 0 110 80" width="100" height="72">
      <rect width="110" height="80" fill="#fff1f2" rx="3"/>
      <rect width="110" height="50" fill="#ffe4e6"/>
      {/* Encosta com cicatriz de deslizamento */}
      <polygon points="50,50 50,8 110,8 110,80 50,80" fill="#c8a97a"/>
      {/* Cicatriz côncava */}
      <path d="M 50,26 Q 68,14 82,20 Q 90,26 88,50" fill="#fecaca" stroke="#dc2626" strokeWidth="1.8" strokeDasharray="4,2" fillOpacity="0.5"/>
      <line x1="50" y1="8" x2="50" y2="50" stroke="#ef4444" strokeWidth="2.5"/>
      {/* Massa deslizada na base */}
      <polygon points="50,50 76,50 90,62 110,58 110,80 50,80" fill="#d4956b"/>
      <path d="M 50,50 Q 70,53 90,62 Q 102,65 110,58" fill="none" stroke="#ef4444" strokeWidth="1.5"/>
      {/* Solo plano esquerdo */}
      <polygon points="0,50 50,50 50,80 0,80" fill="#c8a97a"/>
      <line x1="0" y1="50" x2="110" y2="50" stroke="#ef4444" strokeWidth="2"/>
      {/* Casa tombada */}
      <g transform="rotate(-14,22,46)">
        <rect x="8" y="36" width="26" height="16" fill="#ffe4e6" stroke="#dc2626" strokeWidth="1.5"/>
        <polygon points="6,36 21,25 36,36" fill="#dc2626" opacity="0.8"/>
        <line x1="8" y1="44" x2="34" y2="44" stroke="#dc2626" strokeWidth="0.8" strokeDasharray="2,2"/>
      </g>
      <rect x="0" y="67" width="110" height="13" fill="#ffe4e6" rx="3"/>
      <text x="55" y="77" fontSize="8" fill="#b91c1c" textAnchor="middle" fontWeight="700">Deslizamentos</text>
    </svg>
  )
}

// ── SVG: Casas R1–R4 (Seção 9 — Grau de Risco NBR 11682 / IPT) ──
function CasaR1() {
  return (
    <svg viewBox="0 0 100 80" width="80" height="72">
      <rect width="100" height="80" fill="#f0fdf4" rx="4"/>
      <rect width="100" height="63" fill="#dcfce7"/>
      {/* Céu com nuvem */}
      <ellipse cx="78" cy="14" rx="11" ry="5" fill="#fff" opacity="0.8"/>
      <ellipse cx="68" cy="17" rx="8" ry="4" fill="#fff" opacity="0.8"/>
      {/* Terreno levemente inclinado ~10-15° */}
      <polygon points="0,63 100,59 100,80 0,80" fill="#c8a97a"/>
      <polygon points="0,63 100,59 100,63" fill="#a07845"/>
      <line x1="0" y1="63" x2="100" y2="59" stroke="#22c55e" strokeWidth="2"/>
      {/* Casa estável e upright */}
      <rect x="18" y="40" width="64" height="23" rx="2" fill="#ffffff" stroke="#16a34a" strokeWidth="2"/>
      <polygon points="14,40 50,18 86,40" fill="#16a34a"/>
      <rect x="26" y="50" width="13" height="13" rx="1" fill="#bae6fd" stroke="#0ea5e9" strokeWidth="1"/>
      <rect x="61" y="50" width="13" height="13" rx="1" fill="#bae6fd" stroke="#0ea5e9" strokeWidth="1"/>
      <rect x="43" y="53" width="11" height="10" rx="1" fill="#a16207" stroke="#78350f" strokeWidth="1"/>
      <line x1="18" y1="63" x2="82" y2="61" stroke="#16a34a" strokeWidth="2"/>
      {/* Check verde */}
      <circle cx="88" cy="26" r="8" fill="#16a34a"/>
      <polyline points="84,26 87,29 92,22" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <text x="50" y="77" fontSize="8" fill="#15803d" textAnchor="middle" fontWeight="700">~10–15° — Monitoramento</text>
    </svg>
  )
}

function CasaR2() {
  return (
    <svg viewBox="0 0 100 80" width="80" height="72">
      <rect width="100" height="80" fill="#fefce8" rx="4"/>
      <rect width="100" height="63" fill="#fef9c3"/>
      {/* Terreno inclinado ~25-30° */}
      <polygon points="0,63 100,54 100,80 0,80" fill="#c8a97a"/>
      <polygon points="0,63 100,54 100,59" fill="#a07845"/>
      <line x1="0" y1="63" x2="100" y2="54" stroke="#ca8a04" strokeWidth="2"/>
      {/* Casa levemente inclinada */}
      <g transform="rotate(-7,50,54)">
        <rect x="18" y="40" width="64" height="23" rx="2" fill="#ffffff" stroke="#ca8a04" strokeWidth="2"/>
        <polygon points="14,40 50,18 86,40" fill="#ca8a04"/>
        <rect x="26" y="50" width="13" height="13" rx="1" fill="#fef9c3" stroke="#a16207" strokeWidth="1"/>
        <rect x="61" y="50" width="13" height="13" rx="1" fill="#fef9c3" stroke="#a16207" strokeWidth="1"/>
        <rect x="43" y="53" width="11" height="10" rx="1" fill="#a16207" stroke="#78350f" strokeWidth="1"/>
        {/* Trinca leve */}
        <line x1="34" y1="40" x2="36" y2="52" stroke="#ca8a04" strokeWidth="1.2" strokeDasharray="2,2" opacity="0.8"/>
      </g>
      {/* Triângulo de atenção */}
      <polygon points="88,18 96,32 80,32" fill="#ca8a04"/>
      <text x="88" y="29" fontSize="9" fill="#fff" textAnchor="middle" fontWeight="bold">!</text>
      <text x="50" y="77" fontSize="8" fill="#a16207" textAnchor="middle" fontWeight="700">~25–30° — Investigação</text>
    </svg>
  )
}

function CasaR3() {
  return (
    <svg viewBox="0 0 100 82" width="80" height="72">
      <rect width="100" height="82" fill="#fff7ed" rx="4"/>
      <rect width="100" height="65" fill="#ffedd5"/>
      {/* Terreno bastante inclinado ~40-45° */}
      <polygon points="0,65 100,50 100,82 0,82" fill="#c8a97a"/>
      <polygon points="0,65 100,50 100,56" fill="#a07845"/>
      <line x1="0" y1="65" x2="100" y2="50" stroke="#ea580c" strokeWidth="2"/>
      {/* Casa bastante inclinada */}
      <g transform="rotate(-18,50,56)">
        <rect x="20" y="42" width="60" height="23" rx="2" fill="#fff7ed" stroke="#ea580c" strokeWidth="2"/>
        <polygon points="16,42 50,20 84,42" fill="#ea580c"/>
        <rect x="28" y="52" width="12" height="13" rx="1" fill="#fed7aa" stroke="#c2410c" strokeWidth="1"/>
        <rect x="60" y="52" width="12" height="13" rx="1" fill="#fed7aa" stroke="#c2410c" strokeWidth="1"/>
        <rect x="43" y="55" width="10" height="10" rx="1" fill="#c2410c" stroke="#9a3412" strokeWidth="1"/>
        {/* Trincas visíveis */}
        <line x1="32" y1="42" x2="35" y2="55" stroke="#ea580c" strokeWidth="1.5" strokeDasharray="3,2"/>
        <line x1="68" y1="42" x2="65" y2="55" stroke="#ea580c" strokeWidth="1.5" strokeDasharray="3,2"/>
      </g>
      {/* Setas de escorregamento */}
      {[10,28,72,90].map((x,i)=>(
        <g key={i}>
          <line x1={x} y1={[48,42,44,46][i]} x2={x+5} y2={[56,50,52,54][i]} stroke="#ea580c" strokeWidth="1.5"/>
          <polygon points={`${x+2},${[54,48,50,52][i]} ${x+8},${[54,48,50,52][i]} ${x+5},${[59,53,55,57][i]}`} fill="#ea580c"/>
        </g>
      ))}
      <text x="50" y="80" fontSize="8" fill="#c2410c" textAnchor="middle" fontWeight="700">~40–45° — Contenção urgente</text>
    </svg>
  )
}

function CasaR4() {
  return (
    <svg viewBox="0 0 100 82" width="80" height="72">
      <rect width="100" height="82" fill="#fff1f2" rx="4"/>
      <rect width="100" height="65" fill="#ffe4e6"/>
      {/* Terreno muito íngreme >45° */}
      <polygon points="0,65 100,44 100,82 0,82" fill="#c8a97a"/>
      <polygon points="0,65 100,44 100,50" fill="#a07845"/>
      <line x1="0" y1="65" x2="100" y2="44" stroke="#dc2626" strokeWidth="2"/>
      {/* Casa destruída/tombada */}
      <g transform="rotate(-28,50,57)">
        <polygon points="16,65 84,65 88,44 20,42" fill="#fecaca" stroke="#dc2626" strokeWidth="1.5"/>
        <polygon points="12,44 50,20 88,42 50,28" fill="#dc2626" opacity="0.85"/>
        <line x1="20" y1="42" x2="26" y2="55" stroke="#dc2626" strokeWidth="1.5"/>
        <line x1="74" y1="42" x2="68" y2="55" stroke="#dc2626" strokeWidth="1.5"/>
        <line x1="38" y1="55" x2="45" y2="65" stroke="#dc2626" strokeWidth="1" strokeDasharray="3,2"/>
      </g>
      {/* Detritos na base */}
      {[[8,64,8],[20,68,5],[34,63,7],[48,69,5]].map(([x,y,s],i)=>(
        <ellipse key={i} cx={x} cy={y} rx={s} ry={3} fill="#fca5a5" stroke="#dc2626" strokeWidth="0.8"/>
      ))}
      {/* X de perigo */}
      <line x1="84" y1="20" x2="95" y2="32" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="95" y1="20" x2="84" y2="32" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round"/>
      <text x="50" y="80" fontSize="7.5" fill="#b91c1c" textAnchor="middle" fontWeight="700">&gt;45° — EVACUAÇÃO IMEDIATA</text>
    </svg>
  )
}

// ── SVG: Tipos de Encosta / Talude (Seção 5) ──────────────────
function TaludeNatural() {
  return (
    <svg viewBox="0 0 100 70" width="90" height="62">
      <rect width="100" height="70" fill="#f0fdf4" rx="3"/>
      <rect width="100" height="46" fill="#dcfce7"/>
      {/* Perfil natural curvo */}
      <path d="M 0,46 Q 30,36 55,22 Q 72,10 100,14 L 100,70 L 0,70 Z" fill="#c8a97a"/>
      <path d="M 0,46 Q 30,34 55,20 Q 72,8 100,12" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round"/>
      {/* Árvores estilizadas ao longo da encosta */}
      {[[8,42],[20,35],[34,26],[50,18],[66,13],[80,13],[94,14]].map(([x,y],i)=>(
        <g key={i} transform={`translate(${x},${y})`}>
          <line x1="0" y1="0" x2="0" y2="5" stroke="#166534" strokeWidth="1.5"/>
          <ellipse cx="0" cy="-4" rx="5" ry="5" fill="#16a34a" opacity="0.9"/>
        </g>
      ))}
      <line x1="0" y1="46" x2="100" y2="46" stroke="#22c55e" strokeWidth="1.5" opacity="0.4"/>
      <rect x="0" y="57" width="100" height="13" fill="#dcfce7" rx="3"/>
      <text x="50" y="67" fontSize="8" fill="#15803d" textAnchor="middle" fontWeight="700">Natural / Vegetado</text>
    </svg>
  )
}

function TaludeCorte() {
  return (
    <svg viewBox="0 0 100 70" width="90" height="62">
      <rect width="100" height="70" fill="#fefce8" rx="3"/>
      <rect width="100" height="46" fill="#fef3c7"/>
      {/* Talude de corte: plano esq, face, platô dir */}
      <polygon points="0,46 46,46 46,14 100,14 100,70 0,70" fill="#c8a97a"/>
      <polygon points="46,46 46,14 100,14 100,19" fill="#a07845"/>
      {/* Camadas de solo na face */}
      {[20,26,32,38,42].map((y,i)=>(
        <line key={i} x1="46" y1={y} x2="100" y2={y} stroke="#8b6340" strokeWidth="0.8" opacity="0.5"/>
      ))}
      <line x1="2" y1="46" x2="46" y2="46" stroke="#eab308" strokeWidth="2"/>
      <line x1="46" y1="46" x2="46" y2="14" stroke="#eab308" strokeWidth="2.5"/>
      <line x1="46" y1="14" x2="98" y2="14" stroke="#eab308" strokeWidth="2"/>
      <text x="22" y="34" fontSize="7" fill="#a16207" textAnchor="middle">solo</text>
      <text x="73" y="11" fontSize="7" fill="#a16207" textAnchor="middle">topo</text>
      <rect x="0" y="57" width="100" height="13" fill="#fef9c3" rx="3"/>
      <text x="50" y="67" fontSize="8" fill="#a16207" textAnchor="middle" fontWeight="700">Talude de Corte</text>
    </svg>
  )
}

function AlertaLancado() {
  return (
    <svg viewBox="0 0 100 70" width="90" height="62">
      <rect width="100" height="70" fill="#fff7ed" rx="3"/>
      <rect width="100" height="46" fill="#ffedd5"/>
      {/* Perfil irregular de aterro */}
      <polygon points="0,46 12,40 24,44 38,32 54,40 68,30 82,38 100,32 100,70 0,70" fill="#c49a58"/>
      <polygon points="0,46 12,40 24,44 38,32 54,40 68,30 82,38 100,32 100,38 82,44 68,36 54,46 38,38 24,50 12,46 0,51" fill="#a07845"/>
      {/* Linha de solo original pontilhada */}
      <line x1="0" y1="46" x2="100" y2="46" stroke="#92400e" strokeWidth="1.5" strokeDasharray="5,3" opacity="0.7"/>
      {/* Setas de material lançado */}
      {[16,38,60,84].map((x,i)=>(
        <g key={i}>
          <line x1={x} y1={[26,20,24,22][i]} x2={x} y2={[36,30,34,32][i]} stroke="#f97316" strokeWidth="1.5"/>
          <polygon points={`${x-3},${[34,28,32,30][i]} ${x+3},${[34,28,32,30][i]} ${x},${[39,33,37,35][i]}`} fill="#f97316"/>
        </g>
      ))}
      <rect x="0" y="57" width="100" height="13" fill="#ffedd5" rx="3"/>
      <text x="50" y="67" fontSize="8" fill="#c2410c" textAnchor="middle" fontWeight="700">Aterro Lançado</text>
    </svg>
  )
}

function ParedRochosa() {
  return (
    <svg viewBox="0 0 100 70" width="90" height="62">
      <rect width="100" height="70" fill="#f8fafc" rx="3"/>
      <rect width="100" height="46" fill="#f1f5f9"/>
      {/* Parede de rocha central */}
      <rect x="24" y="6" width="52" height="40" rx="2" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="1.5"/>
      {/* Padrão de blocos de rocha */}
      {[[24,6,26,14],[50,6,26,14],[24,20,20,14],[44,20,32,14],[24,34,22,12],[46,34,30,12]].map(([x,y,w,h],i)=>(
        <rect key={i} x={x} y={y} width={w} height={h} fill="none" stroke="#6b7280" strokeWidth="0.8"/>
      ))}
      {[20,34].map((y,i)=>(
        <line key={i} x1="24" y1={y} x2="76" y2={y} stroke="#6b7280" strokeWidth="1.2" opacity="0.7"/>
      ))}
      {/* Laterais de solo */}
      <polygon points="0,46 24,46 24,6 0,6" fill="#d0bfa0" stroke="#94a3b8" strokeWidth="1"/>
      <polygon points="76,6 76,46 100,46 100,6" fill="#d0bfa0" stroke="#94a3b8" strokeWidth="1"/>
      <polygon points="0,46 100,46 100,70 0,70" fill="#c8a97a"/>
      <line x1="0" y1="46" x2="100" y2="46" stroke="#6b7280" strokeWidth="2"/>
      <rect x="0" y="57" width="100" height="13" fill="#f1f5f9" rx="3"/>
      <text x="50" y="67" fontSize="8" fill="#475569" textAnchor="middle" fontWeight="700">Parede Rochosa</text>
    </svg>
  )
}

function BlocosRocha() {
  return (
    <svg viewBox="0 0 100 70" width="90" height="62">
      <rect width="100" height="70" fill="#f8fafc" rx="3"/>
      <rect width="100" height="46" fill="#f1f5f9"/>
      {/* Encosta suave */}
      <polygon points="0,46 100,46 100,70 0,70" fill="#c8a97a"/>
      <path d="M 2,46 Q 50,44 98,46" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"/>
      {/* Blocos de rocha de tamanhos variados */}
      {[
        [7,40,14,9],[24,31,18,11],[42,40,13,8],
        [56,29,20,12],[72,37,14,9],[86,32,12,9],
        [16,22,11,8],[48,18,15,10],[74,23,12,9]
      ].map(([x,y,w,h],i)=>(
        <g key={i}>
          <polygon points={`${x},${y+h} ${x+w*0.3},${y} ${x+w},${y} ${x+w},${y+h}`} fill="#94a3b8" stroke="#64748b" strokeWidth="1"/>
          <ellipse cx={x+w*0.5} cy={y+h+1} rx={w*0.38} ry={3} fill="#7a8a9a" stroke="#64748b" strokeWidth="0.8"/>
        </g>
      ))}
      <line x1="0" y1="46" x2="100" y2="46" stroke="#6b7280" strokeWidth="1.5"/>
      <rect x="0" y="57" width="100" height="13" fill="#f1f5f9" rx="3"/>
      <text x="50" y="67" fontSize="8" fill="#475569" textAnchor="middle" fontWeight="700">Blocos / Matacões</text>
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
