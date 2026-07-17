import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { FiArrowLeft, FiClipboard, FiSave, FiTrash2, FiMapPin,
         FiDownload, FiBarChart2, FiCheckCircle, FiAlertTriangle, FiNavigation, FiMap, FiEdit2 } from 'react-icons/fi'
import { api, API_BASE } from '../services/api'
import styles from './Vistoria.module.css'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import jsPDF from 'jspdf'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import ModalMapaPoligono from '../components/ModalMapaPoligono'
import Edificio3D from '../components/Edificio3D'
import LocalizacaoEdificacao from '../components/LocalizacaoEdificacao'

const MINI_MAP_LAYERS = {
  ruas: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    maxZoom: 22,
    maxNativeZoom: 19,
  },
  satelite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri',
    maxZoom: 22,
    maxNativeZoom: 19,
  },
}

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

const CARACT_LOCAIS_OPTIONS = [
  { id:'blocos',     label:'Presença de blocos de rocha e matacões', icon:'🪨' },
  { id:'lixo',       label:'Presença de lixo/entulho',              icon:'🗑️' },
  { id:'conc_agua',  label:'Concentração de água de chuva em superfície (enxurrada)', icon:'🌧️' },
  { id:'lanc_agua',  label:'Lançamento de água servida em superfície (a céu aberto ou no quintal)', icon:'💧' },
]

const VEGETACAO_OPTIONS = [
  { id:'arvores',      label:'Presença de árvores' },
  { id:'rasteira',     label:'Vegetação rasteira (arbustos, capim)' },
  { id:'desmatada',    label:'Área desmatada' },
  { id:'cultivo',      label:'Área de cultivo' },
  { id:'solo_exposto', label:'Solo exposto no topo do talude ou aterro' },
]

const SINAIS_MOVIMENTACAO = [
  { id:'trincas',      label:'Trincas nas paredes/piso',             icon:'🧱' },
  { id:'degraus',      label:'Degraus de abatimento',                icon:'↘️' },
  { id:'embarrigados', label:'Muros/paredes "embarrigados"',          icon:'📐' },
  { id:'inc_arvores',  label:'Inclinação de árvores',                 icon:'🌲' },
  { id:'inc_postes',   label:'Inclinação de postes',                  icon:'🔌' },
  { id:'cicatrizes',   label:'Cicatrizes de deslizamento na encosta', icon:'⛰️' },
  { id:'deposito',     label:'Depósito de material acima da moradia', icon:'📦' },
  { id:'sulcos',       label:'Sulcos erosivos no talude',             icon:'〰️' },
]

const FEICOES_INSTABILIDADE = [
  { id:'rastejo', label:'RASTEJO (Creep)', color:'#8b5cf6',
    subs:[
      { id:'ra_planos',  label:'Vários planos de deslocamento (internos)' },
      { id:'ra_veloc',   label:'Velocidades muito baixas (cm/ano), decrescentes c/ profundidade' },
      { id:'ra_const',   label:'Movimentos constantes, sazonais ou intermitentes' },
      { id:'ra_solo',    label:'Solo, depósitos, rocha alterada/fraturada' },
      { id:'ra_geom',    label:'Geometria indefinida' },
    ]
  },
  { id:'escorregamento', label:'ESCORREGAMENTO (Slides)', color:'#f97316',
    subs:[
      { id:'es_planos',   label:'Poucos planos de deslocamento (externos)' },
      { id:'es_veloc',    label:'Velocidades médias (m/h) a altas (m/s)' },
      { id:'es_volume',   label:'Pequenos a grandes volumes de material' },
      { id:'es_geom',     label:'Geometria e materiais variáveis' },
      { id:'es_planar',   label:'— PLANARES: solos poucos espessos, plano de fraqueza' },
      { id:'es_circular', label:'— CIRCULARES: solos espessos homogêneos, rochas fraturadas' },
      { id:'es_cunha',    label:'— EM CUNHA: solos e rochas com dois planos de fraqueza' },
    ]
  },
  { id:'queda', label:'QUEDA / TOMBAMENTO (Falls)', color:'#ef4444',
    subs:[
      { id:'qd_planos',    label:'Sem planos de deslocamento' },
      { id:'qd_livre',     label:'Movimento tipo queda livre ou em plano inclinado' },
      { id:'qd_veloc',     label:'Velocidades muito altas (vários m/s)' },
      { id:'qd_rochoso',   label:'Material rochoso (lascas, placas, blocos)' },
      { id:'qd_volume',    label:'Pequenos a médios volumes' },
      { id:'qd_rolamento', label:'— ROLAMENTO DE MATACÃO' },
      { id:'qd_tombamento',label:'— TOMBAMENTO' },
    ]
  },
  { id:'corrida', label:'CORRIDA DE MASSA (Flows)', color:'#dc2626',
    subs:[
      { id:'co_superficies',label:'Muitas superfícies de deslocamento (internas e externas)' },
      { id:'co_viscoso',    label:'Movimento semelhante ao de um líquido viscoso' },
      { id:'co_drenagens',  label:'Desenvolvimento ao longo das drenagens' },
      { id:'co_veloc',      label:'Velocidades médias a altas' },
      { id:'co_material',   label:'Mobilização de solo, rocha, detritos e água' },
      { id:'co_volume',     label:'Grandes volumes de material' },
      { id:'co_alcance',    label:'Extenso raio de alcance, mesmo em áreas planas' },
    ]
  },
]

const DESLIZAMENTOS_TIPOS = [
  { id:'desliz_natural',   label:'No talude natural' },
  { id:'desliz_corte',     label:'No talude de corte' },
  { id:'desliz_aterro',    label:'No aterro' },
  { id:'desliz_queda',     label:'Queda de blocos' },
  { id:'desliz_rolamento', label:'Rolamento de blocos' },
]

// ── UTM conversion (WGS84 → UTM) ────────────────────────────────
function latLngToUTM(lat, lng) {
  const a = 6378137.0
  const f = 1 / 298.257223563
  const e2 = 2 * f - f * f
  const ePrime2 = e2 / (1 - e2)
  const k0 = 0.9996
  const zone = Math.floor((lng + 180) / 6) + 1
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180
  const latR = lat * Math.PI / 180
  const lngR = lng * Math.PI / 180
  const N = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2)
  const T = Math.tan(latR) ** 2
  const C = ePrime2 * Math.cos(latR) ** 2
  const A = Math.cos(latR) * (lngR - lon0)
  const M = a * (
    (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * latR
    - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * Math.sin(2*latR)
    + (15*e2**2/256 + 45*e2**3/1024) * Math.sin(4*latR)
    - (35*e2**3/3072) * Math.sin(6*latR)
  )
  const easting = k0 * N * (
    A + (1-T+C)*A**3/6 + (5-18*T+T**2+72*C-58*ePrime2)*A**5/120
  ) + 500000
  let northing = k0 * (M + N * Math.tan(latR) * (
    A**2/2 + (5-T+9*C+4*C**2)*A**4/24 + (61-58*T+T**2+600*C-330*ePrime2)*A**6/720
  ))
  if (lat < 0) northing += 10000000
  return { E: Math.round(easting * 100) / 100, N: Math.round(northing * 100) / 100, zona: zone }
}

// ── Export helpers ───────────────────────────────────────────────
function exportExcel(vistorias) {
  // Descobre o número máximo de vértices entre todas as vistorias
  let maxVerts = 0
  vistorias.forEach(v => {
    try {
      const verts = v.area_vertices
        ? (typeof v.area_vertices === 'string' ? JSON.parse(v.area_vertices) : v.area_vertices)
        : []
      if (Array.isArray(verts) && verts.length > maxVerts) maxVerts = verts.length
    } catch (_) {}
  })

  const rows = vistorias.map(v => {
    const base = {
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
    }

    // Colunas UTM dos vértices do polígono da área
    let verts = []
    try {
      verts = v.area_vertices
        ? (typeof v.area_vertices === 'string' ? JSON.parse(v.area_vertices) : v.area_vertices)
        : []
      if (!Array.isArray(verts)) verts = []
    } catch (_) { verts = [] }

    for (let i = 0; i < maxVerts; i++) {
      const pt = verts[i]
      if (pt && pt.lat != null && pt.lng != null) {
        const utm = latLngToUTM(Number(pt.lat), Number(pt.lng))
        base[`Vértice ${i+1} - Zona UTM`] = `${utm.zona}S`
        base[`Vértice ${i+1} - E (m)`]    = utm.E
        base[`Vértice ${i+1} - N (m)`]    = utm.N
      } else {
        base[`Vértice ${i+1} - Zona UTM`] = ''
        base[`Vértice ${i+1} - E (m)`]    = ''
        base[`Vértice ${i+1} - N (m)`]    = ''
      }
    }

    return base
  })

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
function Dashboard({ vistorias, onImport }) {
  const importInputRef = useRef(null)
  const [importStatus, setImportStatus] = useState(null) // null | 'ok' | 'erro'
  const [importMsg,    setImportMsg]    = useState('')

  function handleImportClick() {
    setImportStatus(null)
    setImportMsg('')
    importInputRef.current?.click()
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
      if (!rows.length) { setImportStatus('erro'); setImportMsg('Planilha vazia ou sem dados reconhecíveis.'); return }
      const registros = rows.map((r, idx) => ({
        id:            r['ID']        || `imp_${Date.now()}_${idx}`,
        data:          r['Data']      ? (() => { try { return new Date(r['Data']).toISOString() } catch { return new Date().toISOString() } })() : new Date().toISOString(),
        nome:          String(r['Nome']          || r['Responsável'] || ''),
        cpf:           String(r['CPF']           || ''),
        telefone:      String(r['Telefone']      || ''),
        endereco:      String(r['Endereço']      || r['Endereco'] || ''),
        moradores:     String(r['Moradores']     || ''),
        lat:           r['Latitude']  ? Number(r['Latitude'])  : null,
        lng:           r['Longitude'] ? Number(r['Longitude']) : null,
        condEncosta:   String(r['Condição da Encosta']  || r['Condicao da Encosta']  || ''),
        anguloEncosta: String(r['Ângulo da Encosta']    || r['Angulo da Encosta']    || ''),
        caractsEncosta: r['Características'] ? String(r['Características']).split(';').map(s=>s.trim()).filter(Boolean) : [],
        tipoTalude:    String(r['Tipo de Talude']  || ''),
        processos:     r['Processos']  ? String(r['Processos']).split(';').map(s=>s.trim()).filter(Boolean) : [],
        solo:          String(r['Tipo de Solo']   || ''),
        tipo_uso:      String(r['Uso do Imóvel']  || r['Uso do Imovel'] || ''),
        patologias:    r['Patologias'] ? String(r['Patologias']).split(';').map(s=>s.trim()).filter(Boolean) : [],
        risco:         String(r['Grau de Risco']  || ''),
        observacao:    String(r['Observações']    || r['Observacoes'] || ''),
      }))
      if (onImport) {
        const resultado = await onImport(registros)
        setImportStatus('ok')
        setImportMsg(`${resultado?.importados ?? registros.length} registro(s) importado(s) com sucesso.`)
      }
    } catch (err) {
      setImportStatus('erro')
      setImportMsg(`Erro ao ler planilha: ${err.message}`)
    }
  }

  if (vistorias.length === 0) return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div className={styles.vazio}>Nenhuma vistoria registrada.</div>
      <div style={{display:'flex', gap:12, flexWrap:'wrap', alignItems:'center'}}>
        <input ref={importInputRef} type='file' accept='.xlsx,.xls,.csv' style={{display:'none'}} onChange={handleImportFile}/>
        <button className={styles.exportBtn} style={{background:'#1d4ed8', borderColor:'#1d4ed8'}} onClick={handleImportClick}>
          📥 Importar Planilha de Registros
        </button>
        {importStatus === 'ok'   && <span style={{color:'#22c55e', fontSize:13}}>{importMsg}</span>}
        {importStatus === 'erro' && <span style={{color:'#ef4444', fontSize:13}}>{importMsg}</span>}
      </div>
    </div>
  )

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

      {/* ── Ações: Exportar + Importar ── */}
      <div style={{display:'flex', gap:12, flexWrap:'wrap', alignItems:'center'}}>
        <button className={styles.exportBtn} onClick={() => exportExcel(vistorias)}><FiDownload size={14}/> Exportar Excel</button>
        <button className={styles.exportBtn} style={{background:'#065f46', borderColor:'#065f46'}} onClick={() => exportKMZ(vistorias)}><FiDownload size={14}/> Exportar KMZ</button>

        {/* Importar planilha de registros */}
        <input ref={importInputRef} type='file' accept='.xlsx,.xls,.csv' style={{display:'none'}} onChange={handleImportFile}/>
        <button
          className={styles.exportBtn}
          style={{background:'#1d4ed8', borderColor:'#1d4ed8'}}
          onClick={handleImportClick}
          title='Carregar planilha Excel com registros de vistorias existentes'
        >
          📥 Importar Planilha de Registros
        </button>
        {importStatus === 'ok'   && <span style={{color:'#22c55e', fontSize:13}}>{importMsg}</span>}
        {importStatus === 'erro' && <span style={{color:'#ef4444', fontSize:13}}>{importMsg}</span>}
      </div>
      <p style={{color:'#94a3b8', fontSize:11, margin:0}}>
        A planilha deve seguir o mesmo formato do arquivo exportado (colunas: Nome, Grau de Risco, Endereço, etc.).
      </p>
    </div>
  )
}

// ── Gera planta 2D (vista superior) do imóvel com trincas ────────
function gerarVista3D(v) {
  return new Promise(resolve => {
    let areaVerts = []
    try { areaVerts = v.area_vertices ? (typeof v.area_vertices === 'string' ? JSON.parse(v.area_vertices) : v.area_vertices) : [] } catch (_) {}

    let construcoes = []
    try { construcoes = v.construcoes ? (typeof v.construcoes === 'string' ? JSON.parse(v.construcoes) : v.construcoes) : [] } catch (_) {}

    if (!Array.isArray(areaVerts) || areaVerts.length < 3) { resolve(null); return }

    const altH = Math.max(parseFloat(v.alturaImovel || v.altura_imovel || 3) * 1.1, 2.5)

    const W = 700, H = 480
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')

    // Fundo gradiente azulado (céu)
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, '#dbeafe'); grad.addColorStop(1, '#e8f0f8')
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H)

    // Grade sutil
    ctx.strokeStyle = 'rgba(148,180,220,0.25)'; ctx.lineWidth = 0.7
    for (let i = 0; i <= W; i += 40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke() }
    for (let i = 0; i <= H; i += 40) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke() }

    // ── Sistema de coordenadas locais (idêntico ao Edificio3D) ──
    const ref = areaVerts[0]
    const R = 6371000, cosLat = Math.cos(ref.lat * Math.PI / 180)
    const raw = areaVerts.map(pt => ({
      x: (pt.lng - ref.lng) * cosLat * Math.PI / 180 * R,
      z: -(pt.lat - ref.lat) * Math.PI / 180 * R,
    }))
    const cx0 = raw.reduce((s, p) => s + p.x, 0) / raw.length
    const cz0 = raw.reduce((s, p) => s + p.z, 0) / raw.length
    const centered = raw.map(p => ({ x: p.x - cx0, z: p.z - cz0 }))
    const maxR = Math.max(...centered.map(p => Math.sqrt(p.x * p.x + p.z * p.z)), 0.1)
    const localScale = 12 / maxR
    const bPts = centered.map(p => ({ x: p.x * localScale, z: p.z * localScale }))

    // ── Projeção isométrica top-down ──
    // az = ângulo de azimute (45° → vista diagonal); el = elevação (0.38*π ≈ 68° → quase de cima)
    const az = Math.PI / 4
    const el = Math.PI * 0.38
    const cosAz = Math.cos(az), sinAz = Math.sin(az)
    const cosEl = Math.cos(el), sinEl = Math.sin(el)

    const project = (x, y, z) => {
      const rx = x * cosAz - z * sinAz   // rotação Y pelo azimute
      const rz = x * sinAz + z * cosAz
      return { sx: rx, sy: rz * cosEl - y * sinEl }  // projeção pela elevação
    }

    // Calcular bounding box na tela (piso + topo + anomalias)
    const allPts = []
    bPts.forEach(p => { allPts.push(project(p.x, 0, p.z)); allPts.push(project(p.x, altH, p.z)) })
    if (Array.isArray(construcoes)) {
      construcoes.forEach(a => {
        if (a.startPoint) allPts.push(project(a.startPoint.x, a.startPoint.y || 0, a.startPoint.z))
        if (a.endPoint)   allPts.push(project(a.endPoint.x,   a.endPoint.y   || 0, a.endPoint.z))
      })
    }
    const HEADER = 32, MARGIN = 52
    const minSX = Math.min(...allPts.map(p => p.sx))
    const maxSX = Math.max(...allPts.map(p => p.sx))
    const minSY = Math.min(...allPts.map(p => p.sy))
    const maxSY = Math.max(...allPts.map(p => p.sy))
    const rangeX = (maxSX - minSX) || 1, rangeY = (maxSY - minSY) || 1
    const drawW = W - 2 * MARGIN, drawH = H - HEADER - MARGIN - 20
    const scale = Math.min(drawW / rangeX, drawH / rangeY) * 0.88
    const originX = MARGIN + (drawW - rangeX * scale) / 2
    const originY = HEADER + MARGIN / 2 + (drawH - rangeY * scale) / 2

    const toScreen = (x, y, z) => {
      const { sx, sy } = project(x, y, z)
      return { cx: originX + (sx - minSX) * scale, cy: originY + (sy - minSY) * scale }
    }

    // ── Sombra no chão (elipse) ──
    ctx.save()
    ctx.globalAlpha = 0.12
    const floorCenter = toScreen(0, 0, 0)
    const ellW = (maxSX - minSX) * scale * 0.6, ellH = ellW * 0.22
    ctx.fillStyle = '#1e3a8a'
    ctx.beginPath(); ctx.ellipse(floorCenter.cx, floorCenter.cy + altH * scale * sinEl * 0.4, ellW, ellH, 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()

    // ── Piso (polígono) ──
    ctx.beginPath()
    bPts.forEach((p, i) => { const sc = toScreen(p.x, 0, p.z); i === 0 ? ctx.moveTo(sc.cx, sc.cy) : ctx.lineTo(sc.cx, sc.cy) })
    ctx.closePath()
    const floorGrad = ctx.createLinearGradient(0, H * 0.6, 0, H)
    floorGrad.addColorStop(0, '#d4a76a'); floorGrad.addColorStop(1, '#b8864e')
    ctx.fillStyle = floorGrad; ctx.fill()
    ctx.strokeStyle = '#2a4060'; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.stroke()

    // ── Paredes visíveis (voltadas para o observador) ──
    // Direção de visão projetada no plano XZ
    const viewDX = sinAz, viewDZ = cosAz
    const wallColors = [
      { fill: '#dceaf8', stroke: '#2a4060' },
      { fill: '#cce0f5', stroke: '#2a4060' },
      { fill: '#d5e8f8', stroke: '#2a4060' },
      { fill: '#c8dcf0', stroke: '#2a4060' },
    ]

    // Coletar e ordenar paredes por profundidade (painter's algorithm)
    const walls = []
    for (let i = 0; i < bPts.length; i++) {
      const a = bPts[i], b = bPts[(i + 1) % bPts.length]
      const dx = b.x - a.x, dz = b.z - a.z
      // Normal outward (perpendicular à aresta, girando 90° no sentido horário)
      const nx = dz, nz = -dx
      const dot = nx * viewDX + nz * viewDZ
      if (dot <= 0) continue   // parede traseira — ignorar
      const midZ = (project(a.x, altH / 2, a.z).sy + project(b.x, altH / 2, b.z).sy) / 2
      walls.push({ i, a, b, midZ, color: wallColors[i % wallColors.length] })
    }
    // Ordenar do mais longe ao mais perto (painter's algorithm)
    walls.sort((wa, wb) => wb.midZ - wa.midZ)

    walls.forEach(({ a, b, color }) => {
      const bl = toScreen(a.x, 0, a.z), br = toScreen(b.x, 0, b.z)
      const tr = toScreen(b.x, altH, b.z), tl = toScreen(a.x, altH, a.z)
      // Gradiente da parede (claro em cima, um pouco mais escuro embaixo)
      const wg = ctx.createLinearGradient(tl.cx, tl.cy, bl.cx, bl.cy)
      wg.addColorStop(0, color.fill); wg.addColorStop(1, adjustColor(color.fill, -18))
      ctx.beginPath()
      ctx.moveTo(bl.cx, bl.cy); ctx.lineTo(br.cx, br.cy); ctx.lineTo(tr.cx, tr.cy); ctx.lineTo(tl.cx, tl.cy)
      ctx.closePath()
      ctx.fillStyle = wg; ctx.fill()
      ctx.strokeStyle = color.stroke; ctx.lineWidth = 1.5; ctx.stroke()
    })

    // ── Telhado (contorno superior) ──
    ctx.beginPath()
    bPts.forEach((p, i) => { const sc = toScreen(p.x, altH, p.z); i === 0 ? ctx.moveTo(sc.cx, sc.cy) : ctx.lineTo(sc.cx, sc.cy) })
    ctx.closePath()
    ctx.fillStyle = 'rgba(200,220,245,0.55)'; ctx.fill()
    ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.stroke()

    // ── Arestas verticais ──
    ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = 1.5
    bPts.forEach(p => {
      const bot = toScreen(p.x, 0, p.z), top = toScreen(p.x, altH, p.z)
      ctx.beginPath(); ctx.moveTo(bot.cx, bot.cy); ctx.lineTo(top.cx, top.cy); ctx.stroke()
    })

    // ── Vértices no topo com numeração ──
    bPts.forEach((p, i) => {
      const sc = toScreen(p.x, altH, p.z)
      ctx.beginPath(); ctx.arc(sc.cx, sc.cy, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#fbbf24'; ctx.fill()
      ctx.strokeStyle = '#92400e'; ctx.lineWidth = 1.2; ctx.stroke()
      ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = '#1e3a8a'
      ctx.fillText(`V${i + 1}`, sc.cx, sc.cy - 9)
    })

    // ── Cotas de distância nos lados do piso ──
    for (let i = 0; i < bPts.length; i++) {
      const a = bPts[i], b = bPts[(i + 1) % bPts.length]
      const scA = toScreen(a.x, 0, a.z), scB = toScreen(b.x, 0, b.z)
      const lat1 = areaVerts[i].lat, lng1 = areaVerts[i].lng
      const lat2 = areaVerts[(i + 1) % areaVerts.length].lat, lng2 = areaVerts[(i + 1) % areaVerts.length].lng
      const dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180
      const a2 = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
      const distM = R * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2))
      const mx = (scA.cx + scB.cx) / 2, my = (scA.cy + scB.cy) / 2 + 3
      const lbl = `${distM.toFixed(1)}m`
      ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center'
      const tw = ctx.measureText(lbl).width
      ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillRect(mx - tw / 2 - 3, my - 12, tw + 6, 13)
      ctx.fillStyle = '#1e40af'; ctx.fillText(lbl, mx, my - 2)
    }

    // ── Anomalias / Trincas em 3D ──
    if (Array.isArray(construcoes)) {
      construcoes.forEach((a, idx) => {
        if (!a.startPoint || !a.endPoint) return
        const sp = toScreen(a.startPoint.x, a.startPoint.y || 0, a.startPoint.z)
        const ep = toScreen(a.endPoint.x,   a.endPoint.y   || 0, a.endPoint.z)

        // Linha da trinca
        ctx.save()
        ctx.shadowColor = 'rgba(220,38,38,0.4)'; ctx.shadowBlur = 6
        ctx.beginPath(); ctx.moveTo(sp.cx, sp.cy); ctx.lineTo(ep.cx, ep.cy)
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3.5; ctx.setLineDash([9, 5]); ctx.stroke()
        ctx.restore()
        ctx.setLineDash([])

        // Pontas da trinca
        ;[sp, ep].forEach(pt => {
          ctx.beginPath(); ctx.arc(pt.cx, pt.cy, 6, 0, Math.PI * 2)
          ctx.fillStyle = '#ef4444'; ctx.fill()
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke()
        })

        // Etiqueta
        const mx = (sp.cx + ep.cx) / 2, my = Math.min(sp.cy, ep.cy) - 14
        const lbl = a.nome || `T${idx + 1}`
        ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'
        const tw = ctx.measureText(lbl).width
        ctx.fillStyle = '#ef4444'; ctx.fillRect(mx - tw / 2 - 5, my - 13, tw + 10, 16)
        ctx.fillStyle = '#ffffff'; ctx.fillText(lbl, mx, my)
      })
    }

    // ── Cota de altura ──
    const vtxFirst = toScreen(bPts[0].x, 0, bPts[0].z)
    const vtxTop   = toScreen(bPts[0].x, altH, bPts[0].z)
    ctx.save()
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3])
    ctx.beginPath(); ctx.moveTo(vtxFirst.cx + 18, vtxFirst.cy); ctx.lineTo(vtxTop.cx + 18, vtxTop.cy); ctx.stroke()
    ctx.setLineDash([])
    ;[vtxFirst.cy, vtxTop.cy].forEach(cy => {
      ctx.beginPath(); ctx.moveTo(vtxFirst.cx + 12, cy); ctx.lineTo(vtxFirst.cx + 24, cy); ctx.stroke()
    })
    ctx.fillStyle = '#374151'; ctx.font = '10px Arial'; ctx.textAlign = 'left'
    ctx.fillText(`h=${altH.toFixed(1)}m`, vtxFirst.cx + 27, (vtxFirst.cy + vtxTop.cy) / 2 + 4)
    ctx.restore()

    // ── Barra de título ──
    ctx.fillStyle = 'rgba(15,23,42,0.88)'; ctx.fillRect(0, 0, W, HEADER)
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'
    ctx.fillText('MODELO 3D DO IMÓVEL — VISTA SUPERIOR COM TRINCAS', W / 2, 20)

    // ── Borda ──
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.strokeRect(2, 2, W - 4, H - 4)

    // ── Legenda compacta (canto inferior direito) ──
    const lgX = W - 170, lgY = H - 85
    ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillRect(lgX - 8, lgY - 14, 168, 82)
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1; ctx.strokeRect(lgX - 8, lgY - 14, 168, 82)
    ctx.font = 'bold 10px Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#0f172a'
    ctx.fillText('LEGENDA', lgX, lgY)
    // Piso
    ctx.fillStyle = '#d4a76a'; ctx.fillRect(lgX, lgY + 8, 22, 10)
    ctx.strokeStyle = '#2a4060'; ctx.lineWidth = 1; ctx.strokeRect(lgX, lgY + 8, 22, 10)
    ctx.fillStyle = '#0f172a'; ctx.font = '9px Arial'; ctx.fillText('Piso do imóvel', lgX + 27, lgY + 17)
    // Parede
    ctx.fillStyle = '#dceaf8'; ctx.fillRect(lgX, lgY + 24, 22, 10)
    ctx.strokeStyle = '#2a4060'; ctx.strokeRect(lgX, lgY + 24, 22, 10)
    ctx.fillStyle = '#0f172a'; ctx.fillText('Paredes', lgX + 27, lgY + 33)
    // Trinca
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.5; ctx.setLineDash([7, 4])
    ctx.beginPath(); ctx.moveTo(lgX, lgY + 46); ctx.lineTo(lgX + 22, lgY + 46); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#0f172a'; ctx.fillText('Trinca / anomalia', lgX + 27, lgY + 50)
    // Vértice
    ctx.beginPath(); ctx.arc(lgX + 11, lgY + 62, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#fbbf24'; ctx.fill(); ctx.strokeStyle = '#92400e'; ctx.lineWidth = 1.2; ctx.stroke()
    ctx.fillStyle = '#0f172a'; ctx.fillText(`Vértice (V1…V${bPts.length})`, lgX + 27, lgY + 66)

    resolve(canvas.toDataURL('image/png'))
  })
}

// Escurece uma cor hex por 'amount' (0–255)
function adjustColor(hex, amount) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.min(255, ((n >> 16) & 0xff) + amount))
  const g = Math.max(0, Math.min(255, ((n >> 8)  & 0xff) + amount))
  const b = Math.max(0, Math.min(255, ( n        & 0xff) + amount))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

// ── PDF export — Relatório individual de vistoria ────────────────
async function exportarPDFVistoria(v) {
  // Gerar vista 3D isométrica antes de criar o PDF
  const plantaDataURL = await gerarVista3D(v)

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, PL = 14, PR = 14, TW = W - PL - PR
  let y = 0, pg = 1

  const riscoObj = NIVEIS_RISCO.find(r => r.value === v.risco) || {}
  const riscoCor = riscoObj.color || '#374151'
  const hexToRgb = hex => [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
  const [rR,rG,rB] = hexToRgb(riscoCor)

  const cabecalho = () => {
    doc.setFillColor(15,23,42); doc.rect(0, 0, W, 22, 'F')
    doc.setFillColor(rR,rG,rB); doc.rect(0, 22, W, 2, 'F'); doc.rect(0, 0, 3, 22, 'F')
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255)
    doc.text('DEFESA CIVIL — GEOVISTORIAS', 6, 9)
    doc.setFontSize(7); doc.setFont('helvetica','normal')
    doc.text('Ouro Branco & Congonhas — MG  ·  Relatório de Vistoria Residencial  ·  NBR 11682 / IPT-Defesa Civil', 6, 15)
    doc.setFontSize(6.5); doc.setTextColor(148,163,184)
    doc.text(`Emitido: ${new Date().toLocaleString('pt-BR')}`, 6, 20)
    doc.text(`ID ${v.id || 'S/N'}  ·  Pág. ${pg}`, W - PR, 9, { align: 'right' })
  }

  const rodape = () => {
    doc.setFillColor(248,250,252); doc.rect(0, 283, W, 14, 'F')
    doc.setFillColor(rR,rG,rB); doc.rect(0, 283, W, 0.7, 'F')
    doc.setFontSize(6.5); doc.setFont('helvetica','italic'); doc.setTextColor(148,163,184)
    doc.text('Geovistorias — Sistema WebGIS Defesa Civil · Ouro Branco & Congonhas MG', PL, 290)
    doc.text(`Documento técnico oficial · ${new Date().toLocaleDateString('pt-BR')}`, W - PR, 290, { align: 'right' })
  }

  const novaPag = () => { rodape(); doc.addPage(); pg++; cabecalho(); y = 28 }
  const chkPag = (needed = 15) => { if (y + needed > 278) novaPag() }

  cabecalho(); y = 27

  // Badge de risco + nome
  doc.setFillColor(rR,rG,rB); doc.roundedRect(PL, y, 48, 11, 2.5, 2.5, 'F')
  doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255)
  doc.text(`${v.risco || '—'}  ${riscoObj.label || ''}`, PL + 3.5, y + 7.5)
  doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(15,23,42)
  doc.text(v.nome || 'Sem nome', PL + 53, y + 7.5)
  y += 15

  // Linha divisória
  doc.setFillColor(rR,rG,rB); doc.rect(PL, y, TW, 0.5, 'F'); y += 6

  // ── Helpers ──
  const secao = (titulo) => {
    chkPag(14)
    doc.setFillColor(15,23,42); doc.rect(PL, y, TW, 7, 'F')
    doc.setFillColor(rR,rG,rB); doc.rect(PL, y, 2.5, 7, 'F')
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255)
    doc.text(titulo.toUpperCase(), PL + 5, y + 5)
    y += 9
  }

  const campo = (label, valor, maxW = TW, xBase = PL) => {
    if (!valor) return
    chkPag(7)
    doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(100,116,139)
    doc.text(label + ':', xBase, y)
    doc.setFont('helvetica','normal'); doc.setTextColor(15,23,42)
    const lines = doc.splitTextToSize(String(valor), maxW - 32)
    doc.text(lines, xBase + 32, y)
    y += lines.length * 4.8 + 1
  }

  const campo2col = (pares) => {
    const half = Math.ceil(pares.length / 2)
    const colW = TW / 2 - 4
    let yL = y, yR = y
    pares.slice(0, half).forEach(([lbl, val]) => {
      if (!val) return
      doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(100,116,139)
      doc.text(lbl + ':', PL, yL)
      doc.setFont('helvetica','normal'); doc.setTextColor(15,23,42)
      const ls = doc.splitTextToSize(String(val), colW - 26)
      doc.text(ls, PL + 26, yL); yL += ls.length * 4.8 + 1
    })
    pares.slice(half).forEach(([lbl, val]) => {
      if (!val) return
      const xR = PL + TW / 2 + 4
      doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(100,116,139)
      doc.text(lbl + ':', xR, yR)
      doc.setFont('helvetica','normal'); doc.setTextColor(15,23,42)
      const ls = doc.splitTextToSize(String(val), colW - 26)
      doc.text(ls, xR + 26, yR); yR += ls.length * 4.8 + 1
    })
    y = Math.max(yL, yR) + 3
  }

  // ── 1. Identificação ──
  secao('1. Identificação do Imóvel e Morador')
  campo2col([
    ['Responsável', v.nome],
    ['CPF / RG', v.cpf],
    ['Telefone', v.telefone],
    ['Nº de Moradores', v.moradores ? `${v.moradores} pessoa(s)` : null],
    ['Cidade', v.cidade === 'congonhas' ? 'Congonhas - MG' : 'Ouro Branco - MG'],
    ['Data da Vistoria', v.data ? new Date(v.data).toLocaleString('pt-BR') : null],
  ])
  campo('Endereço', v.endereco)
  if (v.lat || v.coordenada?.lat) {
    const lat = v.lat || v.coordenada?.lat, lng = v.lng || v.coordenada?.lng
    campo('Coordenadas GPS', `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`)
  }
  if (v.area_m2) campo('Área do Terreno', `${Number(v.area_m2).toFixed(1)} m²`)
  if (v.alturaImovel || v.altura_imovel) campo('Altura do Imóvel', `${v.alturaImovel || v.altura_imovel} m`)
  y += 2

  // ── 2. Encosta e Talude ──
  secao('2. Condição da Encosta e Talude')
  campo2col([
    ['Condição da Encosta', COND_ENCOSTA.find(c=>c.id===v.condEncosta)?.label || v.condEncosta],
    ['Tipo de Talude', TIPOS_TALUDE.find(t=>t.id===v.tipoTalude)?.label || v.tipoTalude],
    ['Ângulo da Encosta', v.anguloEncosta ? `${v.anguloEncosta}°` : null],
    ['Dist. à Base', v.distanciaBase ? `${v.distanciaBase} m` : null],
    ['Dist. ao Topo', v.distanciaTopo ? `${v.distanciaTopo} m` : null],
    ['Parede Rochosa', v.paredeRochosaAng ? `${v.paredeRochosaAng}°` : null],
  ])
  const caractsEnc = (() => { try { const a = typeof v.caractsEncosta === 'string' ? JSON.parse(v.caractsEncosta) : v.caractsEncosta; return Array.isArray(a) ? a.join(', ') : null } catch { return null } })()
  if (caractsEnc) campo('Características da Encosta', caractsEnc)
  y += 2

  // ── 3. Solo e Cobertura ──
  secao('3. Solo, Uso e Cobertura Vegetal')
  campo2col([
    ['Tipo de Solo', TIPOS_SOLO.find(s=>s.id===v.solo)?.label || v.solo],
    ['Uso do Imóvel', v.tipoUso || v.tipo_uso],
  ])
  const veg = (() => { try { const a = typeof v.vegetacao === 'string' ? JSON.parse(v.vegetacao) : v.vegetacao; return Array.isArray(a) && a.length ? a.join(', ') : null } catch { return null } })()
  if (veg) campo('Cobertura Vegetal', veg)
  y += 2

  // ── 4. Água e Drenagem ──
  if (v.aguaDrenagem || v.aguaOndeVai || v.aguaOrigemAbast || v.aguaVazamento) {
    secao('4. Condições Hídricas e Drenagem')
    campo2col([
      ['Drenagem', v.aguaDrenagem],
      ['Destino das Águas', v.aguaOndeVai],
      ['Abastecimento', v.aguaOrigemAbast],
      ['Vazamentos', v.aguaVazamento],
    ])
    y += 2
  }

  // ── 5. Processos e Feições ──
  const procsArr = (() => { try { const a = Array.isArray(v.processos) ? v.processos : JSON.parse(v.processos||'[]'); return a } catch { return [] } })()
  if (procsArr.length > 0) {
    secao('5. Processos e Feições Geológico-Geotécnicas')
    const lista = procsArr.map(p => PROCESSOS.find(x=>x.id===p)?.label || p).join(' • ')
    campo('Processos Identificados', lista)
    const sinais = (() => { try { const a = typeof v.sinaisMovimentacao === 'string' ? JSON.parse(v.sinaisMovimentacao) : v.sinaisMovimentacao; return Array.isArray(a) && a.length ? a.join(', ') : null } catch { return null } })()
    if (sinais) campo('Sinais de Movimentação', sinais)
    y += 2
  }

  // ── 6. Patologias ──
  const patArr = (() => { try { const a = Array.isArray(v.patologias) ? v.patologias : JSON.parse(v.patologias||'[]'); return a } catch { return [] } })()
  if (patArr.length > 0) {
    chkPag(20)
    secao('6. Patologias Identificadas')
    const COLS = 2, colW2 = TW / COLS
    for (let i = 0; i < patArr.length; i += COLS) {
      chkPag(7)
      const row = patArr.slice(i, i + COLS)
      row.forEach((p, ci) => {
        const xOff = PL + ci * colW2, lbl = PATOLOGIAS.find(x=>x.id===p)?.label || p
        doc.setFillColor(241,245,249); doc.roundedRect(xOff, y - 1, colW2 - 3, 6, 1, 1, 'F')
        doc.setFillColor(rR,rG,rB); doc.rect(xOff, y - 1, 2, 6, 'F')
        doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(15,23,42)
        doc.text(`  ${lbl}`, xOff + 4, y + 3.5)
      })
      y += 7
    }
    y += 2
  }

  // ── 7. Observações Técnicas ──
  if (v.observacao) {
    chkPag(22)
    secao('7. Observações e Recomendações Técnicas')
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(15,23,42)
    const lines = doc.splitTextToSize(v.observacao, TW)
    if (y + lines.length * 5 > 278) novaPag()
    doc.text(lines, PL, y); y += lines.length * 5 + 3
    y += 2
  }

  // ── 8. Anomalias e Trincas (Construções 3D) ──
  let construcoes = []
  try { construcoes = v.construcoes ? (typeof v.construcoes === 'string' ? JSON.parse(v.construcoes) : v.construcoes) : [] } catch (_) {}
  if (Array.isArray(construcoes) && construcoes.length > 0) {
    chkPag(24)
    secao('8. Anomalias e Trincas Registradas no Modelo 3D')
    // Cabeçalho da tabela
    const colWs = [22, 72, 34, TW - 128]
    const headers = ['Código', 'Tipo / Localização', 'Pavimento', 'Observação']
    doc.setFillColor(30,58,138); doc.rect(PL, y, TW, 6.5, 'F')
    doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255)
    let xc = PL
    headers.forEach((h, i) => { doc.text(h, xc + 2, y + 4.5); xc += colWs[i] })
    y += 7
    construcoes.forEach((a, idx) => {
      chkPag(7)
      const bg = idx % 2 === 0 ? [248,250,252] : [255,255,255]
      doc.setFillColor(...bg); doc.rect(PL, y, TW, 6.5, 'F')
      doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(15,23,42)
      xc = PL
      const cells = [
        a.nome || `T${idx+1}`,
        a.localNome || (a.type === 'parede-anomalia' ? 'Parede com anomalia' : a.type || '—'),
        a.floor ? `Pav. ${a.floor}` : '—',
        a.linhasTrinca?.length ? `${a.linhasTrinca.length} trinca(s)` : '—',
      ]
      cells.forEach((c, i) => { doc.text(String(c).substring(0, 35), xc + 2, y + 4.5); xc += colWs[i] })
      y += 6.5
    })
    y += 4
  }

  rodape()

  // ── Página final: Modelo 3D do imóvel (isométrico top-down) ──
  if (plantaDataURL) {
    doc.addPage(); pg++; cabecalho(); y = 28
    secao('Modelo 3D do Imóvel — Vista Superior com Trincas')
    y += 3
    doc.setFontSize(7.5); doc.setFont('helvetica','italic'); doc.setTextColor(100,116,139)
    doc.text('Vista isométrica gerada a partir das coordenadas GPS dos vértices e do modelo 3D cadastrado.', PL, y)
    doc.text('Trincas e anomalias marcadas em vermelho com identificação. Cotas de paredes em metros.', PL, y + 5); y += 12
    // Imagem panorâmica (700×480 → proporção ~1.46:1 → 182×125 mm em A4)
    const imgW = TW, imgH = Math.round(TW * 480 / 700)
    doc.addImage(plantaDataURL, 'PNG', PL, y, imgW, imgH); y += imgH + 6
    // Nota de rodapé técnica
    doc.setFontSize(7); doc.setFont('helvetica','italic'); doc.setTextColor(100,116,139)
    doc.text('* A vista 3D é gerada automaticamente a partir dos dados do modelo digital — não substitui levantamento estrutural.', PL, y)
    rodape()
  }

  const nomeArq = `vistoria_${(v.nome||'sem_nome').replace(/\s+/g,'_')}_${(v.risco||'')}_${new Date().toISOString().slice(0,10)}.pdf`
  doc.save(nomeArq)
}

// ── Helpers: cálculo geométrico de área/perímetro ───────────────
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
function calcPerimetroM(verts) {
  if (verts.length < 2) return 0
  let total = 0
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]; const b = verts[(i + 1) % verts.length]
    total += haversineM(a.lat, a.lng, b.lat, b.lng)
  }
  return total
}
function calcAreaM2(verts) {
  if (verts.length < 3) return 0
  const ref = verts[0]; const R = 6371000
  const pts = verts.map(v => ({
    x: (v.lng - ref.lng) * Math.cos(ref.lat * Math.PI / 180) * Math.PI / 180 * R,
    y: (v.lat - ref.lat) * Math.PI / 180 * R,
  }))
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(area / 2)
}

// ── Main Component ───────────────────────────────────────────────
export default function Vistoria() {
  const [abaAtiva, setAbaAtiva] = useState('form')
  const [toast, setToast] = useState(null)

  const [nome,      setNome]      = useState('')
  const [cpf,       setCpf]       = useState('')
  const [telefone,  setTelefone]  = useState('')
  const [cidadeVistoria, setCidadeVistoria] = useState('ouro_branco')
  const [endereco,  setEndereco]  = useState('')
  const [moradores,    setMoradores]    = useState('')
  const [alturaImovel, setAlturaImovel] = useState('')
  const [anomalias3D,  setAnomalias3D]  = useState([])
  const [emMonitoramento, setEmMonitoramento] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('vistoria_monitoramento_enrolled') || '[]')) }
    catch { return new Set() }
  })

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

  // ── Passo 2: Distâncias ──
  const [distanciaBase,  setDistanciaBase]  = useState('')
  const [distanciaTopo,  setDistanciaTopo]  = useState('')

  // ── Passo 3: Características do local ──
  const [caractsLocais,  setCaractsLocais]  = useState([])
  const [paredeRochosaAng, setParedeRochosaAng] = useState('')

  // ── Passo 4: Água ──
  const [aguaCaracts,       setAguaCaracts]       = useState([])
  const [aguaDrenagem,      setAguaDrenagem]       = useState('')
  const [aguaOndeVai,       setAguaOndeVai]        = useState('')
  const [aguaOrigemAbast,   setAguaOrigemAbast]    = useState('')
  const [aguaVazamento,     setAguaVazamento]      = useState('')
  const [aguaMinas,         setAguaMinas]          = useState('')

  // ── Passo 5a: Vegetação no topo ──
  const [vegetacao,          setVegetacao]          = useState([])

  // ── Passo 5b: Sinais de movimentação ──
  const [sinaisMovimentacao, setSinaisMovimentacao] = useState([])

  // ── Feições de instabilidade (subtipos) ──
  const [feicoes,            setFeicoes]            = useState([])
  const [deslizTipos,        setDeslizTipos]        = useState([])

  const [vistorias,     setVistorias]     = useState([])
  const [coordAtual,    setCoordAtual]    = useState(null)
  const [sucesso,       setSucesso]       = useState(false)
  const [monitorAnomalias3D, setMonitorAnomalias3D] = useState([])
  const [carregando,    setCarregando]    = useState(false)
  const [gpsLoading,    setGpsLoading]    = useState(false)
  const [gpsErro,       setGpsErro]       = useState('')
  const [showGMSModal,  setShowGMSModal]  = useState(false)
  const [gmsLat,        setGmsLat]        = useState('')
  const [gmsLng,        setGmsLng]        = useState('')
  const [gmsErroModal,  setGmsErroModal]  = useState('')
  const [showMiniMap,   setShowMiniMap]   = useState(false)
  const [miniMapCamada, setMiniMapCamada] = useState('satelite')

  const [editandoId,      setEditandoId]      = useState(null)

  // ── Localização da Edificação (planta schematic) ──
  const [edificacaoPlanta, setEdificacaoPlanta] = useState({ vertices: [], anomalias: [] })
  const [showEdifLoc,     setShowEdifLoc]     = useState(false)
  const [edificacaoSalva3D, setEdificacaoSalva3D] = useState(null)

  // ── Localização da Área (polígono GPS) ──
  const [areaVertices,    setAreaVertices]    = useState([])
  const [showAreaLoc,     setShowAreaLoc]     = useState(false)
  const [areaGpsLoading,  setAreaGpsLoading]  = useState(null) // índice do ponto capturando
  const [editingVertexIdx, setEditingVertexIdx] = useState(null)
  const [editLatInput,     setEditLatInput]     = useState('')
  const [editLngInput,     setEditLngInput]     = useState('')
  const [showModalMapaPoligono, setShowModalMapaPoligono] = useState(false)

  const miniMapRef     = useRef(null)
  const miniLeafletRef = useRef(null)
  const miniMarkerRef  = useRef(null)
  const miniTileRef    = useRef(null)
  const miniMapCamadaRef = useRef('satelite')
  const miniPolyLayerRef = useRef(null)
  const showAreaLocRef   = useRef(false)

  useEffect(() => {
    carregar()
    const coord = localStorage.getItem('ultimaCoordenada')
    if (coord) setCoordAtual(JSON.parse(coord))

    // Modo edição: carregado do painel do mapa
    const editRaw = sessionStorage.getItem('editar_vistoria')
    if (editRaw) {
      sessionStorage.removeItem('editar_vistoria')
      try {
        const ev = JSON.parse(editRaw)
        carregarParaEdicao(ev)
      } catch (_) {}
    }
  }, [])

  const carregarParaEdicao = (ev) => {
    const parseArr = (val) => Array.isArray(val) ? val : (val && typeof val === 'string' ? JSON.parse(val) : [])
    if (ev.id) setEditandoId(ev.id)
    setNome(ev.nome || '')
    setCpf(ev.cpf || '')
    setTelefone(ev.telefone || '')
    setCidadeVistoria(ev.cidade || 'ouro_branco')
    setEndereco(ev.endereco || '')
    setMoradores(ev.moradores || '')
    setAlturaImovel(ev.alturaImovel || ev.altura_imovel || '')
    setAnomalias3D(Array.isArray(ev.construcoes) ? ev.construcoes : [])
    setCondEncosta(ev.condEncosta || ev.cond_encosta || '')
    setAnguloEncosta(ev.anguloEncosta || ev.angulo_encosta || '')
    setCaractsEncosta(parseArr(ev.caractsEncosta ?? ev.caract_encosta))
    setTipoTalude(ev.tipoTalude || ev.tipo_talude || '')
    setProcessos(parseArr(ev.processos))
    setSolo(ev.solo || '')
    setTipoUso(ev.tipo_uso || '')
    setPatologias(parseArr(ev.patologias))
    setRisco(ev.risco || '')
    setObservacao(ev.observacao || '')
    const verts = ev.area_vertices ? parseArr(ev.area_vertices) : []
    setAreaVertices(verts.length ? verts : [])
    if (verts.length) setShowAreaLoc(true)
    try {
      const edif = ev.edificacao_planta ? (typeof ev.edificacao_planta === 'string' ? JSON.parse(ev.edificacao_planta) : ev.edificacao_planta) : null
      if (edif?.gpsVerts?.length) {
        setEdificacaoSalva3D(edif)
      } else if (edif?.vertices?.length) {
        setEdificacaoPlanta(edif); setShowEdifLoc(true)
      }
    } catch (_) {}
    setAbaAtiva('form')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => {
    if (!showMiniMap) {
      if (miniLeafletRef.current) {
        miniLeafletRef.current.remove()
        miniLeafletRef.current = null
        miniMarkerRef.current = null
        miniTileRef.current = null
        miniPolyLayerRef.current = null
      }
      return
    }
    const timeout = setTimeout(() => {
      if (!miniMapRef.current || miniLeafletRef.current) return
      const center = coordAtual ? [coordAtual.lat, coordAtual.lng] : [-20.5236, -43.6919]
      const map = L.map(miniMapRef.current, { center, zoom: 17, zoomControl: true })
      miniLeafletRef.current = map
      const lay = MINI_MAP_LAYERS[miniMapCamadaRef.current]
      miniTileRef.current = L.tileLayer(lay.url, { attribution: lay.attribution, maxZoom: lay.maxZoom, maxNativeZoom: lay.maxNativeZoom }).addTo(map)
      miniPolyLayerRef.current = L.layerGroup().addTo(map)
      if (coordAtual) {
        miniMarkerRef.current = L.marker([coordAtual.lat, coordAtual.lng]).addTo(map)
      }
      map.on('click', e => {
        const coord = { lat: e.latlng.lat, lng: e.latlng.lng }
        setCoordAtual(coord)
        localStorage.setItem('ultimaCoordenada', JSON.stringify(coord))
        if (miniMarkerRef.current) miniMarkerRef.current.setLatLng(e.latlng)
        else miniMarkerRef.current = L.marker(e.latlng).addTo(map)
        if (showAreaLocRef.current) {
          setAreaVertices(prev => {
            const nullIdx = prev.findIndex(v => v == null || v.lat == null)
            if (nullIdx >= 0) {
              const next = [...prev]; next[nullIdx] = { lat: coord.lat, lng: coord.lng }; return next
            }
            return [...prev, { lat: coord.lat, lng: coord.lng }]
          })
        }
      })
    }, 80)
    return () => clearTimeout(timeout)
  }, [showMiniMap])

  useEffect(() => {
    if (!miniLeafletRef.current || !coordAtual) return
    const ll = L.latLng(coordAtual.lat, coordAtual.lng)
    if (miniMarkerRef.current) miniMarkerRef.current.setLatLng(ll)
    else miniMarkerRef.current = L.marker(ll).addTo(miniLeafletRef.current)
    const z = miniLeafletRef.current.getZoom()
    miniLeafletRef.current.setView(ll, Math.max(z, 17))
  }, [coordAtual])

  useEffect(() => { showAreaLocRef.current = showAreaLoc }, [showAreaLoc])

  // ── Busca trincas do Monitoramento para exibir como referência no 3D ──
  useEffect(() => {
    if (!nome) return
    fetch(`${API_BASE}/monitoramento`)
      .then(r => r.ok ? r.json() : [])
      .then(imoveis => {
        const match = imoveis.find(im =>
          (im.proprietario || '').toLowerCase().trim() === nome.toLowerCase().trim()
        )
        if (!match) { setMonitorAnomalias3D([]); return }
        const relats = match.relatoriosSalvos || []
        const all = relats.flatMap(r => Array.isArray(r.anomalias3D) ? r.anomalias3D : [])
        setMonitorAnomalias3D(all)
      })
      .catch(() => setMonitorAnomalias3D([]))
  }, [nome])

  useEffect(() => {
    if (!miniLeafletRef.current || !miniPolyLayerRef.current) return
    miniPolyLayerRef.current.clearLayers()
    const validos = areaVertices.filter(v => v?.lat != null && v?.lng != null)
    if (validos.length === 0) return
    const cor = '#2563eb'
    if (validos.length === 1) {
      L.circleMarker([validos[0].lat, validos[0].lng], {
        radius: 7, color: '#fff', weight: 2, fillColor: cor, fillOpacity: 1,
      }).bindTooltip('V1', { permanent: true, direction: 'top', offset: [0, -8] })
        .addTo(miniPolyLayerRef.current)
    } else if (validos.length === 2) {
      L.polyline(validos.map(v => [v.lat, v.lng]), { color: cor, weight: 3, opacity: 0.9 })
        .addTo(miniPolyLayerRef.current)
      validos.forEach((v, i) =>
        L.circleMarker([v.lat, v.lng], { radius: 5, color: '#fff', weight: 2, fillColor: cor, fillOpacity: 1 })
          .bindTooltip(`V${i + 1}`, { permanent: true, direction: 'top', offset: [0, -6] })
          .addTo(miniPolyLayerRef.current)
      )
    } else {
      L.polygon(validos.map(v => [v.lat, v.lng]), {
        color: '#fff', fillColor: 'transparent', fillOpacity: 0, weight: 5, opacity: 0.4, interactive: false,
      }).addTo(miniPolyLayerRef.current)
      L.polygon(validos.map(v => [v.lat, v.lng]), {
        color: cor, fillColor: cor, fillOpacity: 0.18, weight: 2.5,
      }).addTo(miniPolyLayerRef.current)
      validos.forEach((v, i) =>
        L.circleMarker([v.lat, v.lng], { radius: 5, color: '#fff', weight: 2, fillColor: cor, fillOpacity: 1 })
          .bindTooltip(`V${i + 1}`, { permanent: true, direction: 'top', offset: [0, -6] })
          .addTo(miniPolyLayerRef.current)
      )
    }
    try {
      const bounds = L.latLngBounds(validos.map(v => [v.lat, v.lng]))
      miniLeafletRef.current.fitBounds(bounds, { padding: [28, 28], maxZoom: 18 })
    } catch (_) {}
  }, [areaVertices, showMiniMap])

  function trocarCamadaMini(nova) {
    miniMapCamadaRef.current = nova
    setMiniMapCamada(nova)
    if (!miniLeafletRef.current) return
    if (miniTileRef.current) { miniTileRef.current.remove(); miniTileRef.current = null }
    const lay = MINI_MAP_LAYERS[nova]
    miniTileRef.current = L.tileLayer(lay.url, { attribution: lay.attribution, maxZoom: lay.maxZoom, maxNativeZoom: lay.maxNativeZoom }).addTo(miniLeafletRef.current)
  }

  async function carregar() {
    setCarregando(true)
    try {
      const dados = await api.getVistorias()
      // Limpa localStorage ao carregar com sucesso da API
      localStorage.removeItem('vistorias')
      setVistorias(dados)
    } catch {
      setVistorias(JSON.parse(localStorage.getItem('vistorias') || '[]'))
    } finally {
      setCarregando(false)
    }
  }

  function confirmEditVertex() {
    const lat = parseFloat(editLatInput.replace(',', '.'))
    const lng = parseFloat(editLngInput.replace(',', '.'))
    if (isNaN(lat) || isNaN(lng)) { alert('Coordenadas inválidas. Use formato decimal, ex: -20.523600'); return }
    if (lat < -35 || lat > 6 || lng < -75 || lng > -28) { alert('Coordenadas fora do território brasileiro.'); return }
    setAreaVertices(prev => { const next = [...prev]; next[editingVertexIdx] = { lat, lng }; return next })
    setEditingVertexIdx(null)
  }

  function captureGPSForArea(idx) {
    if (!navigator.geolocation) { alert('GPS não disponível neste navegador.'); return }
    setAreaGpsLoading(idx)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setAreaVertices(prev => {
          const next = [...prev]
          next[idx] = { lat, lng }
          return next
        })
        setAreaGpsLoading(null)
      },
      () => { alert('Não foi possível obter GPS.'); setAreaGpsLoading(null) },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
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
  function toggleCaractLocal(id) { setCaractsLocais(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]) }
  function toggleAguaCaract(id) { setAguaCaracts(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]) }
  function toggleVegetacao(id) { setVegetacao(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]) }
  function toggleSinal(id) { setSinaisMovimentacao(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]) }
  function toggleFeicao(id) { setFeicoes(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]) }
  function toggleDeslizTipo(id) { setDeslizTipos(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]) }

  async function participarMonitoramento(v) {
    const cidadeLabel = { ouro_branco: 'Ouro Branco - MG', congonhas: 'Congonhas - MG' }
    let verts = null
    try { verts = v.area_vertices ? (typeof v.area_vertices === 'string' ? JSON.parse(v.area_vertices) : v.area_vertices) : null } catch (_) {}
    let construcoes = null
    try { construcoes = v.construcoes ? (typeof v.construcoes === 'string' ? JSON.parse(v.construcoes) : v.construcoes) : null } catch (_) {}
    const payload = {
      proprietario: v.nome || 'Sem nome',
      endereco:     v.endereco || '',
      cidade:       cidadeLabel[v.cidade] || v.cidade || 'Ouro Branco - MG',
      celular:      v.telefone || '',
      verticesCasa: verts,
      alturaCasa:   v.alturaImovel ? parseFloat(v.alturaImovel) : null,
      trincasCasa:  construcoes,
      edificacaoPlanta: (() => {
        try {
          const ep = v.edificacao_planta
          if (!ep) return null
          const parsed = typeof ep === 'string' ? JSON.parse(ep) : ep
          if (parsed?.gpsVerts?.length) return parsed
          if (parsed?.vertices?.length) return parsed
          return null
        } catch { return null }
      })(),
    }
    try {
      const res = await fetch(`${(await import('../services/api.js')).API_BASE}/monitoramento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error()
      const updated = new Set([...emMonitoramento, String(v.id)])
      setEmMonitoramento(updated)
      localStorage.setItem('vistoria_monitoramento_enrolled', JSON.stringify([...updated]))
      alert(`✅ "${v.nome}" adicionado ao Monitoramento com sucesso!`)
    } catch {
      alert('Erro ao adicionar ao Monitoramento. Tente novamente.')
    }
  }

  async function salvar(e) {
    e.preventDefault()
    if (!nome || !risco) return alert('Preencha o responsável e o grau de risco.')
    const vertsValidos = areaVertices.filter(v => v && v.lat != null && v.lng != null)
    let derivedLat = null, derivedLng = null
    if (vertsValidos.length >= 1) {
      derivedLat = vertsValidos.reduce((s, v) => s + v.lat, 0) / vertsValidos.length
      derivedLng = vertsValidos.reduce((s, v) => s + v.lng, 0) / vertsValidos.length
    }
    const payload = {
      nome, cpf, telefone, endereco, moradores, alturaImovel,
      construcoes: anomalias3D.length ? anomalias3D : null,
      condEncosta, anguloEncosta, caractsEncosta,
      tipoTalude,
      distanciaBase, distanciaTopo,
      caractsLocais, paredeRochosaAng,
      aguaCaracts, aguaDrenagem, aguaOndeVai, aguaOrigemAbast, aguaVazamento, aguaMinas,
      vegetacao, sinaisMovimentacao,
      feicoes, deslizTipos,
      processos,
      solo, tipo_uso: tipoUso,
      risco, patologias, observacao,
      cidade: cidadeVistoria || 'ouro_branco',
      lat: derivedLat,
      lng: derivedLng,
      area_vertices: vertsValidos.length >= 1 ? JSON.stringify(vertsValidos) : null,
      area_m2: vertsValidos.length >= 3 ? calcAreaM2(vertsValidos) : null,
      edificacao_planta: (() => {
        if (edificacaoSalva3D?.gpsVerts?.length) return JSON.stringify(edificacaoSalva3D)
        if (edificacaoPlanta?.vertices?.length) return JSON.stringify(edificacaoPlanta)
        return null
      })(),
      data: new Date().toISOString(),
    }
    try {
      if (editandoId) {
        await api.updateVistoria(editandoId, payload)
      } else {
        await api.createVistoria(payload)
      }
    } catch (err) {
      alert(`Erro ao salvar vistoria: ${err.message}`)
      return
    }
    setEditandoId(null)
    setNome(''); setCpf(''); setTelefone(''); setCidadeVistoria('ouro_branco'); setEndereco(''); setMoradores(''); setAlturaImovel(''); setAnomalias3D([])
    setCondEncosta(''); setAnguloEncosta(''); setCaractsEncosta([]); setTipoTalude(''); setProcessos([])
    setDistanciaBase(''); setDistanciaTopo('')
    setCaractsLocais([]); setParedeRochosaAng('')
    setAguaCaracts([]); setAguaDrenagem(''); setAguaOndeVai(''); setAguaOrigemAbast(''); setAguaVazamento(''); setAguaMinas('')
    setVegetacao([]); setSinaisMovimentacao([])
    setFeicoes([]); setDeslizTipos([])
    setSolo(''); setTipoUso(''); setRisco(''); setPatologias([]); setObservacao('')
    setAreaVertices([]); setShowAreaLoc(false)
    setEdificacaoPlanta({ vertices: [], anomalias: [] }); setShowEdifLoc(false)
    setEdificacaoSalva3D(null)
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

  // ── Importar planilha de registros ───────────────────────────────
  async function importarPlanilha(registros) {
    let importados = 0
    const erros = []
    for (const reg of registros) {
      try {
        await api.createVistoria(reg)
        importados++
      } catch {
        // fallback: salva no localStorage
        try {
          const lista = JSON.parse(localStorage.getItem('vistorias') || '[]')
          lista.push(reg)
          localStorage.setItem('vistorias', JSON.stringify(lista))
          importados++
        } catch (e2) {
          erros.push(reg.nome || reg.id)
        }
      }
    }
    await carregar()
    return { importados, erros }
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


          {/* ── Localização da Área (polígono GPS) ── */}
          <div style={{ marginTop: 10, border: '1px solid #bfdbfe', borderRadius: 10, overflow: 'hidden', background: '#eff6ff' }}>
            <button
              type='button'
              onClick={() => setShowAreaLoc(v => !v)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 8, padding: '10px 14px', background: 'transparent', border: 'none',
                cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#1d4ed8',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <FiMap size={15} />
                Localização da Área
                {areaVertices.filter(v => v?.lat != null).length >= 1 && (
                  <span style={{ fontSize: 11, background: '#2563eb', color: '#fff', borderRadius: 12, padding: '1px 8px', fontWeight: 600 }}>
                    {areaVertices.filter(v => v?.lat != null).length} {areaVertices.filter(v => v?.lat != null).length === 1 ? 'ponto ✓' : 'pts ✓'}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 16, lineHeight: 1 }}>{showAreaLoc ? '▲' : '▼'}</span>
            </button>

            {showAreaLoc && (
              <div style={{ padding: '0 14px 14px', borderTop: '1px solid #bfdbfe' }}>
                <p style={{ fontSize: 12, color: '#3b82f6', margin: '10px 0 10px', lineHeight: 1.5 }}>
                  Adicione um ponto único para marcar o local da vistoria, ou múltiplos pontos (mínimo 3) para delimitar a área vistoriada como polígono.
                </p>

                {/* Botão principal: desenhar no mapa */}
                <button
                  type='button'
                  onClick={() => setShowModalMapaPoligono(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    background: '#1d4ed8', color: '#fff', border: 'none',
                    borderRadius: 9, padding: '11px 14px', fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', marginBottom: 12, boxShadow: '0 2px 8px rgba(29,78,216,0.25)',
                  }}
                >
                  <FiMap size={15} />
                  {areaVertices.filter(v => v?.lat != null).length >= 1
                    ? '✏️ Redesenhar Área no Mapa'
                    : '🗺️ Desenhar Área no Mapa'}
                  <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.8, fontWeight: 400 }}>
                    Clique nos pontos do terreno
                  </span>
                </button>

                {areaVertices.map((pt, i) => (
                  <div key={i} style={{
                    marginBottom: 8, background: '#fff',
                    border: `1px solid ${editingVertexIdx === i ? '#93c5fd' : '#dbeafe'}`,
                    borderRadius: 8, overflow: 'hidden',
                  }}>
                    {/* ── Cabeçalho do vértice ── */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px' }}>
                      <span style={{
                        minWidth: 24, height: 24, borderRadius: '50%', background: '#2563eb', color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
                      }}>{i + 1}</span>

                      {/* Coordenadas ou modo de edição inline */}
                      {editingVertexIdx === i ? (
                        <div style={{ flex: 1, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <input
                            type='number' step='any' value={editLatInput}
                            onChange={e => setEditLatInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') confirmEditVertex(); if (e.key === 'Escape') setEditingVertexIdx(null) }}
                            placeholder='Latitude (ex: -20.523600)'
                            style={{ flex: 1, minWidth: 120, fontSize: 11, padding: '3px 7px', border: '1px solid #93c5fd', borderRadius: 5, fontFamily: 'monospace' }}
                            autoFocus
                          />
                          <input
                            type='number' step='any' value={editLngInput}
                            onChange={e => setEditLngInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') confirmEditVertex(); if (e.key === 'Escape') setEditingVertexIdx(null) }}
                            placeholder='Longitude (ex: -43.691900)'
                            style={{ flex: 1, minWidth: 120, fontSize: 11, padding: '3px 7px', border: '1px solid #93c5fd', borderRadius: 5, fontFamily: 'monospace' }}
                          />
                          <button type='button' onClick={confirmEditVertex}
                            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 5, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            ✓
                          </button>
                          <button type='button' onClick={() => setEditingVertexIdx(null)}
                            style={{ background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 5, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div style={{ flex: 1, fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                          {pt?.lat != null
                            ? <><b style={{ color: '#2563eb' }}>Lat:</b> {pt.lat.toFixed(6)} &nbsp; <b style={{ color: '#2563eb' }}>Lng:</b> {pt.lng.toFixed(6)}</>
                            : <span style={{ color: '#94a3b8', fontFamily: 'sans-serif' }}>Sem coordenada</span>
                          }
                        </div>
                      )}

                      {/* Botões de ação (só no modo normal) */}
                      {editingVertexIdx !== i && (
                        <>
                          {/* Lápis — editar manualmente */}
                          <button
                            type='button'
                            title='Editar coordenadas manualmente'
                            onClick={() => {
                              setEditingVertexIdx(i)
                              setEditLatInput(pt?.lat?.toFixed(6) ?? '')
                              setEditLngInput(pt?.lng?.toFixed(6) ?? '')
                            }}
                            style={{
                              background: '#f8fafc', border: '1px solid #e2e8f0', color: '#2563eb',
                              borderRadius: 6, padding: '3px 7px', cursor: 'pointer', flexShrink: 0,
                              display: 'flex', alignItems: 'center',
                            }}
                          >
                            <FiEdit2 size={12} />
                          </button>

                          {/* GPS */}
                          <button
                            type='button'
                            disabled={areaGpsLoading === i}
                            onClick={() => captureGPSForArea(i)}
                            style={{
                              background: pt?.lat != null ? '#dcfce7' : '#eff6ff',
                              border: `1px solid ${pt?.lat != null ? '#86efac' : '#93c5fd'}`,
                              color: pt?.lat != null ? '#16a34a' : '#2563eb',
                              borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                              display: 'flex', alignItems: 'center', gap: 3,
                            }}
                          >
                            <FiNavigation size={10} />
                            {areaGpsLoading === i ? 'Aguardando…' : pt?.lat != null ? '↻' : 'GPS'}
                          </button>

                          {/* Remover */}
                          <button
                            type='button'
                            onClick={() => { setAreaVertices(prev => prev.filter((_, j) => j !== i)); if (editingVertexIdx === i) setEditingVertexIdx(null) }}
                            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, padding: '0 4px', flexShrink: 0 }}
                            title='Remover ponto'
                          >×</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}

                <button
                  type='button'
                  onClick={() => setAreaVertices(prev => [...prev, null])}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    background: '#fff', border: '1.5px dashed #93c5fd', color: '#2563eb',
                    borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginTop: 4,
                  }}
                >
                  <FiMapPin size={13} /> + Adicionar Ponto
                </button>

                {(() => {
                  const validos = areaVertices.filter(v => v?.lat != null && v?.lng != null)
                  const area = calcAreaM2(validos)
                  const perim = calcPerimetroM(validos)
                  if (validos.length < 3) return null
                  return (
                    <div style={{
                      marginTop: 12, display: 'flex', gap: 10, background: '#fff',
                      border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px',
                    }}>
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, marginBottom: 2 }}>ÁREA</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#1d4ed8' }}>
                          {area >= 10000 ? (area / 10000).toFixed(2) : area.toFixed(1)}
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginLeft: 3 }}>
                            {area >= 10000 ? 'ha' : 'm²'}
                          </span>
                        </div>
                      </div>
                      <div style={{ width: 1, background: '#dbeafe' }} />
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, marginBottom: 2 }}>PERÍMETRO</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#1d4ed8' }}>
                          {perim >= 1000 ? (perim / 1000).toFixed(2) : perim.toFixed(1)}
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginLeft: 3 }}>
                            {perim >= 1000 ? 'km' : 'm'}
                          </span>
                        </div>
                      </div>
                      <div style={{ width: 1, background: '#dbeafe' }} />
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, marginBottom: 2 }}>VÉRTICES</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#1d4ed8' }}>
                          {validos.length}
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginLeft: 3 }}>pts</span>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* Preview SVG do polígono */}
                {(() => {
                  const validos = areaVertices.filter(v => v?.lat != null && v?.lng != null)
                  if (validos.length < 2) return null
                  const lats = validos.map(v => v.lat), lngs = validos.map(v => v.lng)
                  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
                  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
                  const W = 260, H = 120, pad = 18
                  const toX = lng => pad + ((lng - minLng) / (maxLng - minLng || 0.001)) * (W - 2 * pad)
                  const toY = lat => H - pad - ((lat - minLat) / (maxLat - minLat || 0.001)) * (H - 2 * pad)
                  const pts = validos.map(v => `${toX(v.lng)},${toY(v.lat)}`).join(' ')
                  return (
                    <div style={{ marginTop: 10, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Prévia do polígono</div>
                      <svg width={W} height={H} style={{ border: '1px solid #dbeafe', borderRadius: 8, background: '#f0f9ff' }}>
                        <polygon points={pts} fill='#bfdbfe' fillOpacity={0.5} stroke='#2563eb' strokeWidth={2} />
                        {validos.map((v, i) => (
                          <g key={i}>
                            <circle cx={toX(v.lng)} cy={toY(v.lat)} r={5} fill='#2563eb' />
                            <text x={toX(v.lng) + 7} y={toY(v.lat) + 4} fontSize={9} fill='#1e40af' fontWeight='700'>{i + 1}</text>
                          </g>
                        ))}
                      </svg>
                    </div>
                  )
                })()}

                {/* ── Altura do Imóvel ── */}
                <div style={{ marginTop: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', display: 'block', marginBottom: 5 }}>
                    Altura do Imóvel (m)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type='number' min='0' step='0.1' placeholder='Ex: 3.5'
                      value={alturaImovel}
                      onChange={e => setAlturaImovel(e.target.value)}
                      style={{
                        width: 130, padding: '7px 10px', border: '1px solid #bfdbfe',
                        borderRadius: 7, fontSize: 13, background: '#fff', outline: 'none',
                      }}
                    />
                    <span style={{ fontSize: 11, color: '#64748b' }}>
                      {areaVertices.filter(v => v?.lat != null).length >= 3 && !alturaImovel
                        ? 'Preencha para gerar o modelo 3D'
                        : alturaImovel
                        ? `${alturaImovel} m de altura`
                        : 'Informe a altura para gerar o modelo 3D'}
                    </span>
                  </div>
                </div>

                {/* ── Modelo 3D + Anomalias ── */}
                {(() => {
                  const validos = areaVertices.filter(v => v?.lat != null && v?.lng != null)
                  if (validos.length >= 3 && parseFloat(alturaImovel) > 0) {
                    return (
                      <Edificio3D
                        vertices={validos}
                        altura={parseFloat(alturaImovel)}
                        anomalias={anomalias3D}
                        onAddAnomalia={a => setAnomalias3D(prev => [...prev, a])}
                        onRemoveAnomalia={id => setAnomalias3D(prev => prev.filter(a => a.id !== id))}
                        showPontoButton={false}
                        showTrincaButton={false}
                        monitoramentoAnomalias={monitorAnomalias3D}
                        onSaveEdificacao={async data => {
                          setEdificacaoSalva3D(data)
                          const showT = (msg, tipo) => {
                            setToast({ msg, tipo })
                            setTimeout(() => setToast(null), 4000)
                          }
                          if (editandoId) {
                            try {
                              await api.patchEdificacao(editandoId, data)
                              showT('🏗️ Edificação salva no banco!', 'sucesso')
                            } catch (err) {
                              showT(`Erro ao salvar edificação: ${err.message}`, 'erro')
                            }
                          } else {
                            showT('🏗️ Edificação registrada. Clique em "Salvar Vistoria" para persistir.', 'info')
                          }
                        }}
                        edificacaoSalva={edificacaoSalva3D}
                      />
                    )
                  }
                  if (validos.length >= 3 && !alturaImovel) {
                    return (
                      <div style={{
                        marginTop: 10, padding: '10px 14px',
                        background: '#fff', border: '1px dashed #bfdbfe',
                        borderRadius: 8, fontSize: 12, color: '#3b82f6', textAlign: 'center',
                      }}>
                        ℹ️ Preencha a <strong>Altura do Imóvel</strong> acima para visualizar o modelo 3D
                      </div>
                    )
                  }
                  return null
                })()}
              </div>
            )}
          </div>



          <form onSubmit={salvar} className={styles.form}>

            {/* ── 1. Dados do Responsável ── */}
            <div className={styles.section}>
              <h3>1. Dados do Responsável / Morador</h3>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Proprietário *</label>
                  <input placeholder='Nome completo' value={nome} onChange={e=>setNome(e.target.value)} required/>
                </div>
                <div className={styles.field}>
                  <label>CPF</label>
                  <input placeholder='000.000.000-00' value={cpf} onChange={e=>setCpf(e.target.value)}/>
                </div>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Celular (com DDD)</label>
                  <input placeholder='(00) 00000-0000' value={telefone} onChange={e=>setTelefone(e.target.value)}/>
                </div>
                <div className={styles.field}>
                  <label>Cidade</label>
                  <select value={cidadeVistoria} onChange={e=>setCidadeVistoria(e.target.value)}
                    style={{width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid #cbd5e1', fontSize:14, background:'#fff'}}>
                    <option value='ouro_branco'>Ouro Branco - MG</option>
                    <option value='congonhas'>Congonhas - MG</option>
                  </select>
                </div>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Endereço</label>
                  <input placeholder='Rua, número, bairro' value={endereco} onChange={e=>setEndereco(e.target.value)}/>
                </div>
                <div className={styles.field}>
                  <label>Nº de Moradores</label>
                  <input type='number' min='0' placeholder='0' value={moradores} onChange={e=>setMoradores(e.target.value)}/>
                </div>
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

            {/* ══ PASSO 1 ══ Tipo de Encosta / Talude + Ângulo de Inclinação ── */}
            <div className={styles.section}>
              <div className={styles.stepBadge}>Passo 1</div>
              <h3>3. Tipo de Encosta / Talude e Inclinação</h3>
              <p className={styles.sectionHint}>
                Descreva o terreno onde está a moradia. Antes de preencher, dê um passeio em volta da casa.
              </p>

              <p style={{fontSize:13, fontWeight:600, color:'#475569', marginBottom:8}}>Tipo de Talude / Encosta</p>
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

              <p style={{fontSize:13, fontWeight:600, color:'#475569', margin:'18px 0 8px'}}>
                Ângulo de Inclinação (marque com um X a condição mais parecida com a situação)
              </p>
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

            {/* ══ PASSO 2 ══ Distâncias da Moradia à Encosta ── */}
            <div className={styles.section}>
              <div className={styles.stepBadge}>Passo 2</div>
              <h3>4. Distâncias da Moradia à Encosta / Talude</h3>
              <p className={styles.sectionHint}>Meça (em metros) a distância entre a moradia e a encosta/talude mais próximo(a).</p>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Distância à base da encosta / talude (m)</label>
                  <input
                    type='number' min='0' step='0.5'
                    placeholder='Ex: 5'
                    value={distanciaBase}
                    onChange={e=>setDistanciaBase(e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label>Distância ao topo da encosta / talude (m)</label>
                  <input
                    type='number' min='0' step='0.5'
                    placeholder='Ex: 12'
                    value={distanciaTopo}
                    onChange={e=>setDistanciaTopo(e.target.value)}
                  />
                </div>
              </div>
              <p style={{fontSize:12, color:'#94a3b8', marginTop:6}}>
                Para talude de corte: meça do pé da parede cortada. Para talude natural: meça do sopé da encosta. Para aterro: meça do topo do aterro.
              </p>
            </div>

            {/* ══ PASSO 3 ══ Características do Local ── */}
            <div className={styles.section}>
              <div className={styles.stepBadge}>Passo 3</div>
              <h3>5. Características do Local</h3>
              <p className={styles.sectionHint}>Selecione todas as condições observadas no terreno ao redor da moradia.</p>

              {/* Parede Rochosa — com ângulo */}
              <div style={{marginBottom:14}}>
                <p style={{fontSize:13, fontWeight:600, color:'#475569', marginBottom:8}}>
                  Presença de parede rochosa? Se sim, indique o ângulo aproximado:
                </p>
                <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                  {[{v:'',l:'Não'},
                    {v:'90',l:'90° (vertical)'},
                    {v:'60',l:'60°'},
                    {v:'30',l:'30°'},
                    {v:'17',l:'17°'},
                  ].map(op=>(
                    <button type='button' key={op.v}
                      onClick={()=>setParedeRochosaAng(paredeRochosaAng===op.v?'':op.v)}
                      style={{
                        padding:'6px 14px', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer',
                        border: paredeRochosaAng===op.v ? '2px solid #6b7280' : '1.5px solid #e2e8f0',
                        background: paredeRochosaAng===op.v ? '#f1f5f9' : '#fff',
                        color: paredeRochosaAng===op.v ? '#1e293b' : '#64748b',
                      }}
                    >{op.l}</button>
                  ))}
                </div>
              </div>

              {/* Demais características locais */}
              <div className={styles.checkList}>
                {CARACT_LOCAIS_OPTIONS.map(c=>(
                  <button type='button' key={c.id}
                    className={`${styles.checkItem} ${caractsLocais.includes(c.id)?styles.checkItemAtivo:''}`}
                    onClick={()=>toggleCaractLocal(c.id)}
                  >
                    <span style={{fontSize:18}}>{c.icon}</span>
                    <span style={{flex:1, textAlign:'left'}}>{c.label}</span>
                    {caractsLocais.includes(c.id) && <FiCheckCircle size={15} color='#2563eb'/>}
                  </button>
                ))}
              </div>

              {/* Características da Encosta (Seção 4 anterior) */}
              <p style={{fontSize:13, fontWeight:600, color:'#475569', margin:'16px 0 8px'}}>Outras características da encosta / talude:</p>
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

            {/* ══ PASSO 4 ══ Água ── */}
            <div className={styles.section}>
              <div className={styles.stepBadge}>Passo 4</div>
              <h3>6. Água</h3>
              <p className={styles.sectionHint}>Avalie as condições de água no local da vistoria.</p>

              {/* Checkboxes de condições de água */}
              <div className={styles.checkList}>
                {[
                  {id:'conc_chuva', label:'Concentração de água de chuva em superfície (enxurrada)', icon:'🌧️'},
                  {id:'agua_servida', label:'Lançamento de água servida a céu aberto (no quintal ou encosta)', icon:'💧'},
                ].map(c=>(
                  <button type='button' key={c.id}
                    className={`${styles.checkItem} ${aguaCaracts.includes(c.id)?styles.checkItemAtivo:''}`}
                    onClick={()=>toggleAguaCaract(c.id)}
                  >
                    <span style={{fontSize:18}}>{c.icon}</span>
                    <span style={{flex:1, textAlign:'left'}}>{c.label}</span>
                    {aguaCaracts.includes(c.id) && <FiCheckCircle size={15} color='#2563eb'/>}
                  </button>
                ))}
              </div>

              <div className={styles.row} style={{marginTop:14}}>
                {/* Sistema de drenagem superficial */}
                <div className={styles.field}>
                  <label>Sistema de drenagem superficial</label>
                  <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                    {['Inexistente','Precário','Adequado'].map(op=>(
                      <button type='button' key={op}
                        onClick={()=>setAguaDrenagem(aguaDrenagem===op?'':op)}
                        style={{
                          padding:'6px 14px', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer',
                          border: aguaDrenagem===op ? '2px solid #2563eb' : '1.5px solid #e2e8f0',
                          background: aguaDrenagem===op ? '#eff6ff' : '#fff',
                          color: aguaDrenagem===op ? '#1d4ed8' : '#64748b',
                        }}
                      >{op}</button>
                    ))}
                  </div>
                </div>

                {/* Para onde vai a água */}
                <div className={styles.field}>
                  <label>Para onde vai a água (escoamento)</label>
                  <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                    {['Céu aberto / encosta','Sarjeta / via pública','Terreno vizinho','Rede pluvial'].map(op=>(
                      <button type='button' key={op}
                        onClick={()=>setAguaOndeVai(aguaOndeVai===op?'':op)}
                        style={{
                          padding:'6px 12px', borderRadius:20, fontSize:11, fontWeight:600, cursor:'pointer',
                          border: aguaOndeVai===op ? '2px solid #2563eb' : '1.5px solid #e2e8f0',
                          background: aguaOndeVai===op ? '#eff6ff' : '#fff',
                          color: aguaOndeVai===op ? '#1d4ed8' : '#64748b',
                        }}
                      >{op}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className={styles.row} style={{marginTop:10}}>
                {/* De onde vem a água */}
                <div className={styles.field}>
                  <label>De onde vem a água para uso na moradia</label>
                  <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                    {['Rede pública','Poço / cisterna','Mina d\'água','Outro'].map(op=>(
                      <button type='button' key={op}
                        onClick={()=>setAguaOrigemAbast(aguaOrigemAbast===op?'':op)}
                        style={{
                          padding:'6px 12px', borderRadius:20, fontSize:11, fontWeight:600, cursor:'pointer',
                          border: aguaOrigemAbast===op ? '2px solid #2563eb' : '1.5px solid #e2e8f0',
                          background: aguaOrigemAbast===op ? '#eff6ff' : '#fff',
                          color: aguaOrigemAbast===op ? '#1d4ed8' : '#64748b',
                        }}
                      >{op}</button>
                    ))}
                  </div>
                </div>

                {/* Vazamento na tubulação */}
                <div className={styles.field}>
                  <label>Existe vazamento na tubulação?</label>
                  <div style={{display:'flex', gap:6}}>
                    {['Sim','Não'].map(op=>(
                      <button type='button' key={op}
                        onClick={()=>setAguaVazamento(aguaVazamento===op?'':op)}
                        style={{
                          padding:'6px 22px', borderRadius:20, fontSize:13, fontWeight:700, cursor:'pointer',
                          border: aguaVazamento===op ? '2px solid #dc2626' : '1.5px solid #e2e8f0',
                          background: aguaVazamento===op ? '#fef2f2' : '#fff',
                          color: aguaVazamento===op ? '#dc2626' : '#64748b',
                        }}
                      >{op}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Minas d'água */}
              <div style={{marginTop:10}}>
                <label style={{fontSize:13, fontWeight:600, color:'#475569', display:'block', marginBottom:6}}>
                  Minas d'água (nascentes) no barranco / talude?
                </label>
                <div style={{display:'flex', gap:6}}>
                  {['Sim','Não'].map(op=>(
                    <button type='button' key={op}
                      onClick={()=>setAguaMinas(aguaMinas===op?'':op)}
                      style={{
                        padding:'6px 22px', borderRadius:20, fontSize:13, fontWeight:700, cursor:'pointer',
                        border: aguaMinas===op ? '2px solid #0284c7' : '1.5px solid #e2e8f0',
                        background: aguaMinas===op ? '#f0f9ff' : '#fff',
                        color: aguaMinas===op ? '#0284c7' : '#64748b',
                      }}
                    >{op}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* ══ PASSO 5a ══ Vegetação no Topo do Talude / Aterro ── */}
            <div className={styles.section}>
              <div className={styles.stepBadge}>Passo 5a</div>
              <h3>7. Vegetação no Topo do Talude / Aterro</h3>
              <p className={styles.sectionHint}>Selecione todas as condições de vegetação observadas no topo da encosta / talude / aterro.</p>
              <div className={styles.checkList}>
                {VEGETACAO_OPTIONS.map(v=>(
                  <button type='button' key={v.id}
                    className={`${styles.checkItem} ${vegetacao.includes(v.id)?styles.checkItemAtivo:''}`}
                    onClick={()=>toggleVegetacao(v.id)}
                  >
                    <span style={{fontSize:18}}>🌿</span>
                    <span style={{flex:1, textAlign:'left'}}>{v.label}</span>
                    {vegetacao.includes(v.id) && <FiCheckCircle size={15} color='#16a34a'/>}
                  </button>
                ))}
              </div>
            </div>

            {/* ══ PASSO 5b ══ Sinais de Movimentação ── */}
            <div className={styles.section}>
              <div className={styles.stepBadge}>Passo 5b</div>
              <h3>8. Sinais de Movimentação</h3>
              <p className={styles.sectionHint}>Selecione todos os sinais de movimentação de solo ou instabilidade observados no local.</p>
              <div className={styles.checkList}>
                {SINAIS_MOVIMENTACAO.map(s=>(
                  <button type='button' key={s.id}
                    className={`${styles.checkItem} ${sinaisMovimentacao.includes(s.id)?styles.checkItemAtivo:''}`}
                    onClick={()=>toggleSinal(s.id)}
                  >
                    <span style={{fontSize:18}}>{s.icon}</span>
                    <span style={{flex:1, textAlign:'left'}}>{s.label}</span>
                    {sinaisMovimentacao.includes(s.id) && <FiCheckCircle size={15} color='#dc2626'/>}
                  </button>
                ))}
              </div>
            </div>

            {/* ══ 9. Processos / Feições de Instabilidade ══ */}
            <div className={styles.section}>
              <h3>9. Processos / Feições de Instabilidade Identificados</h3>
              <p className={styles.sectionHint}>Selecione o(s) processo(s) e os subtipos observados no local.</p>

              {FEICOES_INSTABILIDADE.map(f=>(
                <div key={f.id} style={{marginBottom:16, border:`1.5px solid ${f.color}33`, borderRadius:10, overflow:'hidden'}}>
                  <div style={{
                    padding:'9px 14px', background:f.color+'18',
                    borderBottom:`1px solid ${f.color}33`,
                    display:'flex', alignItems:'center', gap:10, cursor:'pointer'
                  }}
                    onClick={()=>toggleProcesso(f.id)}
                  >
                    <div style={{
                      width:14, height:14, borderRadius:3,
                      border:`2px solid ${f.color}`,
                      background: processos.includes(f.id) ? f.color : 'transparent',
                      flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                    }}>
                      {processos.includes(f.id) && <span style={{color:'#fff', fontSize:10, lineHeight:1}}>✓</span>}
                    </div>
                    <span style={{fontWeight:700, fontSize:13, color:f.color}}>{f.label}</span>
                  </div>
                  {f.subs.map(s=>(
                    <div key={s.id}
                      style={{
                        display:'flex', alignItems:'center', gap:10,
                        padding:'7px 14px 7px 28px',
                        borderBottom:`1px solid ${f.color}18`,
                        cursor:'pointer',
                        background: feicoes.includes(s.id) ? f.color+'0C' : '#fff',
                      }}
                      onClick={()=>toggleFeicao(s.id)}
                    >
                      <div style={{
                        width:13, height:13, borderRadius:3,
                        border:`1.5px solid ${f.color}88`,
                        background: feicoes.includes(s.id) ? f.color+'88' : 'transparent',
                        flexShrink:0,
                      }}/>
                      <span style={{fontSize:12, color:'#475569'}}>{s.label}</span>
                    </div>
                  ))}
                </div>
              ))}

              <p style={{fontSize:13, fontWeight:600, color:'#475569', margin:'12px 0 8px'}}>Tipo de deslizamento observado:</p>
              <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                {DESLIZAMENTOS_TIPOS.map(d=>(
                  <button type='button' key={d.id}
                    onClick={()=>toggleDeslizTipo(d.id)}
                    style={{
                      padding:'7px 16px', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer',
                      border: deslizTipos.includes(d.id) ? '2px solid #dc2626' : '1.5px solid #e2e8f0',
                      background: deslizTipos.includes(d.id) ? '#fef2f2' : '#fff',
                      color: deslizTipos.includes(d.id) ? '#dc2626' : '#64748b',
                      display:'flex', alignItems:'center', gap:6,
                    }}
                  >
                    {deslizTipos.includes(d.id) && <FiCheckCircle size={13} color='#dc2626'/>}
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 10. Tipo de Solo e Uso do Imóvel ── */}
            <div className={styles.section}>
              <h3>10. Tipo de Solo e Uso do Imóvel</h3>
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

            {/* ── 11. Patologias ── */}
            <div className={styles.section}>
              <h3>11. Patologias Identificadas</h3>
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

            {/* ── 12. Grau de Risco ── */}
            <div className={styles.section}>
              <h3>12. Grau de Risco — NBR 11682 / IPT</h3>
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

            {/* ── 13. Observações ── */}
            <div className={styles.section}>
              <label className={styles.obsLabel}>13. Observações Técnicas</label>
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
                    <div style={{display:'flex', gap:4, alignItems:'center'}}>
                      <button
                        title="Exportar PDF"
                        onClick={() => exportarPDFVistoria(v)}
                        style={{
                          background:'#7c3aed', border:'1px solid #7c3aed',
                          color:'#fff', borderRadius:6, padding:'4px 7px',
                          cursor:'pointer', display:'flex', alignItems:'center',
                          fontSize:11, fontWeight:600, gap:3,
                        }}
                      >
                        <FiDownload size={12}/> PDF
                      </button>
                      <button
                        className={styles.editBtn}
                        title="Editar vistoria"
                        onClick={() => carregarParaEdicao(v)}
                      >
                        <FiEdit2 size={14}/>
                      </button>
                      <button className={styles.deleteBtn} onClick={() => remover(v.id)}><FiTrash2 size={14}/></button>
                    </div>
                  </div>
                  <div className={styles.cardGrid}>
                    {v.endereco   && <span><strong>Endereço:</strong> {v.endereco}</span>}
                    {v.solo       && <span><strong>Solo:</strong> {TIPOS_SOLO.find(s=>s.id===v.solo)?.label || v.solo}</span>}
                    {(v.tipoUso||v.tipo_uso) && <span><strong>Uso:</strong> {v.tipoUso||v.tipo_uso}</span>}
                    {v.condEncosta && <span><strong>Encosta:</strong> {COND_ENCOSTA.find(c=>c.id===v.condEncosta)?.label || v.condEncosta}</span>}
                    {v.anguloEncosta && <span><strong>Ângulo:</strong> {v.anguloEncosta}°</span>}
                    {v.tipoTalude && <span><strong>Talude:</strong> {TIPOS_TALUDE.find(t=>t.id===v.tipoTalude)?.label || v.tipoTalude}</span>}
                    {v.moradores    && <span><strong>Moradores:</strong> {v.moradores}</span>}
                    {v.alturaImovel && <span><strong>Altura imóvel:</strong> {v.alturaImovel} m</span>}
                    {v.telefone     && <span><strong>Tel:</strong> {v.telefone}</span>}
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
                  {emMonitoramento.has(String(v.id)) ? (
                    <div style={{
                      marginTop: 10, padding: '7px 12px',
                      background: '#064e3b', color: '#34d399', borderRadius: 6,
                      fontWeight: 600, fontSize: 12, textAlign: 'center',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}>
                      <FiCheckCircle size={13}/> Cadastrado no Monitoramento
                    </div>
                  ) : (
                    <button
                      onClick={() => participarMonitoramento(v)}
                      style={{
                        marginTop: 10, width: '100%', padding: '7px 12px',
                        background: 'linear-gradient(90deg,#0ea5e9,#0284c7)',
                        color: '#fff', border: 'none', borderRadius: 6,
                        fontWeight: 600, fontSize: 12, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      📊 Participar do Monitoramento
                    </button>
                  )}
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
          <Dashboard vistorias={vistorias} onImport={importarPlanilha}/>
        </div>
      )}

      {/* ── Modal: Desenhar área no mapa ── */}
      {showModalMapaPoligono && (
        <ModalMapaPoligono
          coordAtual={coordAtual}
          onConfirm={({ vertices, areaM2, edificacaoVertices }) => {
            setAreaVertices(vertices)
            setShowAreaLoc(true)
            setShowModalMapaPoligono(false)
            if (edificacaoVertices && edificacaoVertices.length >= 3) {
              const lats = vertices.map(v => v.lat)
              const lngs = vertices.map(v => v.lng)
              const minLat = Math.min(...lats), maxLat = Math.max(...lats)
              const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
              const dLat = maxLat - minLat || 0.001
              const dLng = maxLng - minLng || 0.001
              const normVerts = edificacaoVertices.map(v => ({
                x: Math.min(1, Math.max(0, (v.lng - minLng) / dLng)),
                y: Math.min(1, Math.max(0, 1 - (v.lat - minLat) / dLat)),
              }))
              setEdificacaoPlanta({ vertices: normVerts, anomalias: [] })
            }
          }}
          onClose={() => setShowModalMapaPoligono(false)}
        />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, padding: '10px 20px', borderRadius: 8, fontWeight: 600,
          fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          background: toast.tipo === 'erro' ? '#ef4444' : toast.tipo === 'sucesso' ? '#22c55e' : '#3b82f6',
          color: '#fff', maxWidth: '90vw', textAlign: 'center',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
