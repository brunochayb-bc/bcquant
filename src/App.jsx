import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  RotateCcw, FileSpreadsheet, X, ChevronLeft, ChevronRight,
  GitCompare, Search, AlertCircle, RefreshCw, Database, Clock,
} from 'lucide-react'
import {
  saveSnapshot,
  loadLatestSnapshot,
  listSnapshots,
  loadSnapshot,
} from './lib/firebase.js'

// ============================================================
// FORMATTERS
// ============================================================
const fmtNum = (v, dec = 2) => {
  if (v == null || isNaN(v) || !isFinite(v)) return '—'
  return v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
const fmtPct = (v, dec = 1, withSign = true) => {
  if (v == null || isNaN(v) || !isFinite(v)) return '—'
  const sign = withSign && v > 0 ? '+' : ''
  return sign + v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%'
}
const fmtMoney = (v, abbr = true) => {
  if (v == null || isNaN(v)) return '—'
  if (!abbr) return 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
  if (Math.abs(v) >= 1e9) return 'R$ ' + (v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'B'
  if (Math.abs(v) >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M'
  if (Math.abs(v) >= 1e3) return 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'K'
  return 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}
const fmtAbbr = (v) => {
  if (v == null || isNaN(v)) return '—'
  if (Math.abs(v) >= 1e3) return (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'B'
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + 'M'
}
const fmtVol = (v) => {
  if (v == null || isNaN(v)) return '—'
  if (v >= 1e9) return (v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'B'
  if (v >= 1e6) return (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M'
  if (v >= 1e3) return (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + 'K'
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}
const fmtDate = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ============================================================
// ANALYTICS
// ============================================================
const stdDev = (arr) => {
  const n = arr.length
  if (n < 2) return 0
  const mean = arr.reduce((a, b) => a + b, 0) / n
  return Math.sqrt(arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1))
}

const rankAsc = (arr, key) => {
  const sorted = [...arr].sort((a, b) => a[key] - b[key])
  const ranks = new Map()
  let cur = 1
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i][key] !== sorted[i - 1][key]) cur = i + 1
    ranks.set(sorted[i].s, cur)
  }
  return arr.map(item => ({ ...item, [`rank_${key}`]: ranks.get(item.s) }))
}

const computeIndicators = (data, filters) => {
  const filtered = data.filter(d =>
    d.v > 0 && d.m > 0 && d.l4 > 0 && d.l3 > 0 && d.l2 > 0 && d.l1 > 0 && d.p > 0 &&
    d.b != null && !isNaN(d.b) && d.v > filters.minVolume
  )
  return filtered.map(d => {
    const lucroMedio2y = (d.l4 + d.l3) / 2
    const meanLucro4y  = (d.l1 + d.l2 + d.l3 + d.l4) / 4
    const stdLucro4y   = stdDev([d.l1, d.l2, d.l3, d.l4])
    return {
      ...d,
      pl_medio: d.m / lucroMedio2y,
      pvp:      d.m / d.p,
      graham:   (d.m / lucroMedio2y) * (d.m / d.p),
      roe:      d.lr != null ? (d.lr / d.p) * 100 : (d.l4 / d.p) * 100,
      roe_4y:   (meanLucro4y / d.p) * 100,
      cagr:     (Math.pow(d.l4 / d.l1, 1 / 3) - 1) * 100,
      cv:       meanLucro4y > 0 ? stdLucro4y / meanLucro4y : 999,
    }
  })
}

const applyQualityFilters = (data, q) => data.filter(d => {
  if (q.useRoe  && d.roe   < q.minRoe)  return false
  if (q.useRoe4y && d.roe_4y < q.minRoe4y) return false
  if (q.useCagr && d.cagr  < q.minCagr) return false
  if (q.useCv   && d.cv    > q.maxCv)   return false
  return true
})

const finalRanking = (data, wGraham) => {
  let r = rankAsc(data, 'graham')
  r = rankAsc(r, 'b')
  const wB = 1 - wGraham
  r = r.map(d => ({ ...d, score: d.rank_graham * wGraham + d.rank_b * wB }))
  r.sort((a, b) => a.score - b.score)
  return r.map((d, i) => ({ ...d, rank_final: i + 1 }))
}

const computeGlobalScore = (d, allData) => {
  if (!allData.length) return 50
  const grahamMin   = Math.min(...allData.map(x => x.graham))
  const grahamMax   = Math.max(...allData.map(x => x.graham))
  const grahamScore = grahamMax > grahamMin ? (1 - (d.graham - grahamMin) / (grahamMax - grahamMin)) * 100 : 50
  const roeScore    = Math.min(100, Math.max(0, (d.roe / 30) * 100))
  const cagrScore   = Math.min(100, Math.max(0, ((d.cagr + 20) / 60) * 100))
  const cvScore     = Math.min(100, Math.max(0, (1 - d.cv) * 100))
  return Math.round(grahamScore * 0.4 + roeScore * 0.25 + cagrScore * 0.2 + cvScore * 0.15)
}

// ============================================================
// XLSX PARSER
// ============================================================
const loadXLSXLib = async () => {
  if (window.XLSX) return window.XLSX
  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
  return window.XLSX
}

const COL_MAP = {
  's':  'Symbol', 'n': 'Name', 't': 'Código',
  'v':  'Média Volume Negociado 30 dias',
  'm':  'Valor de Mercado Mais Recente',
  'lr': 'Lucro Líquido Mais Recente',
  'l4': 'Lucro Líquido 2025',
  'l3': 'Lucro Líquido 2024',
  'l2': 'Lucro Líquido 2023',
  'l1': 'Lucro Líquido 2022',
  'p':  'Patrimônio Líquido Mais Recente',
  'b':  'Beta 36 Meses',
}

const parseUploadedXLSX = async (file) => {
  const XLSX = await loadXLSXLib()
  const buffer  = await file.arrayBuffer()
  const wb      = XLSX.read(buffer, { type: 'array' })
  const ws      = wb.Sheets[wb.SheetNames[0]]
  const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  let headerIdx = -1
  for (let i = 0; i < Math.min(allRows.length, 20); i++) {
    if (allRows[i] && allRows[i][0] === 'Symbol') { headerIdx = i; break }
  }
  if (headerIdx === -1) throw new Error("Cabeçalho 'Symbol' não encontrado nas primeiras 20 linhas.")

  const headers = allRows[headerIdx]
  const colIdx  = {}
  Object.entries(COL_MAP).forEach(([key, ec]) => { colIdx[key] = headers.findIndex(h => h === ec) })
  if (colIdx['t'] === -1) colIdx['t'] = headers.findIndex(h => h === 'Exchng Ticker')

  const toNum = (v) => {
    if (typeof v === 'number' && isFinite(v)) return v
    if (v == null) return null
    const s = String(v).trim()
    if (s === '' || s === '--' || s === '-' || s === 'N/A' || s === 'NA') return null
    const n = parseFloat(s.replace(',', '.'))
    return isFinite(n) ? n : null
  }

  const data = []
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const row = allRows[i]
    if (!row || row.every(c => c == null)) continue
    const sym = row[colIdx['s']]
    if (!sym) continue
    data.push({
      s:  String(sym),
      n:  row[colIdx['n']] ? String(row[colIdx['n']]) : '',
      t:  row[colIdx['t']] ? String(row[colIdx['t']]).replace('-BSP', '') : '',
      v:  toNum(row[colIdx['v']]),
      m:  toNum(row[colIdx['m']]),
      lr: toNum(row[colIdx['lr']]),
      l4: toNum(row[colIdx['l4']]),
      l3: toNum(row[colIdx['l3']]),
      l2: toNum(row[colIdx['l2']]),
      l1: toNum(row[colIdx['l1']]),
      p:  toNum(row[colIdx['p']]),
      b:  toNum(row[colIdx['b']]),
    })
  }
  return data
}

// ============================================================
// SHARED COMPONENTS
// ============================================================
const DarkRangeStyle = () => (
  <style>{`
    .darkrange { -webkit-appearance:none; appearance:none; height:2px; background:#27272a; outline:none; border-radius:2px; }
    .darkrange::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:12px; height:12px; background:#3b82f6; border-radius:50%; cursor:pointer; border:2px solid #000; }
    .darkrange::-moz-range-thumb { width:12px; height:12px; background:#3b82f6; border-radius:50%; cursor:pointer; border:2px solid #000; }
  `}</style>
)

const Pill = ({ active, onClick, children }) => (
  <button onClick={onClick}
    className={`px-3 py-1 rounded text-[11px] font-mono transition border ${active ? 'border-blue-500/40 text-blue-400' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'}`}
    style={{ background: active ? 'rgba(59,130,246,0.08)' : undefined }}>
    {active && '⊙ '}{children}
  </button>
)

const ToggleFilter = ({ active, onClick, value, tooltip }) => {
  const [show, setShow] = React.useState(false)
  return (
    <div className="relative" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <button onClick={onClick}
        className={`px-2.5 py-1 rounded text-[11px] font-mono transition border ${active ? 'border-blue-500/40 text-blue-400' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'}`}
        style={{ background: active ? 'rgba(59,130,246,0.08)' : undefined }}>
        {value}
      </button>
      {tooltip && show && (
        <div className="absolute bottom-full left-0 mb-2 z-50 pointer-events-none">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-[10px] font-mono text-zinc-300 whitespace-pre-line shadow-2xl"
            style={{ lineHeight: '1.7', minWidth: '230px' }}>
            {tooltip}
          </div>
          <div className="w-2 h-2 bg-zinc-900 border-r border-b border-zinc-700 rotate-45 ml-4 -mt-1" />
        </div>
      )}
    </div>
  )
}

const SliderField = ({ label, value, children, accent }) => (
  <div className="flex items-center gap-2">
    <span className={`text-[10px] font-mono uppercase tracking-wider ${accent ? 'text-blue-400/80' : 'text-zinc-500'}`}>{label}</span>
    {children}
    <span className="text-[11px] font-mono text-zinc-200 min-w-[3rem]">{value}</span>
  </div>
)

const NumericField = ({ label, children }) => (
  <div className="flex items-center gap-2">
    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</span>
    {children}
  </div>
)

const StatCard = ({ label, value, accent }) => (
  <div className="px-3 py-1 border border-zinc-900 rounded text-center">
    <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">{label}</div>
    <div className={`text-sm font-mono font-semibold ${accent ? 'text-blue-400' : 'text-zinc-200'}`}>{value}</div>
  </div>
)

const Th = ({ children, onClick, active, align = 'right', accent, w }) => (
  <th onClick={onClick} style={{ width: w }}
    className={`px-2 py-3 text-${align} font-medium cursor-pointer select-none transition ${active ? 'text-blue-400' : accent ? 'text-blue-400/70 hover:text-blue-400' : 'hover:text-zinc-300'}`}>
    {children}
  </th>
)

const HeroMetric = ({ label, value, hint, positive, negative }) => {
  let valueColor = 'text-zinc-100'
  if (positive) valueColor = 'text-blue-400'
  if (negative) valueColor = 'text-red-400'
  return (
    <div className="px-5 py-4 border-r last:border-r-0 border-zinc-900">
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-zinc-500 mb-1.5">{label}</div>
      <div className={`text-xl font-bold tracking-tight ${valueColor}`} style={{ fontFamily: 'ui-monospace,monospace' }}>{value}</div>
      {hint && <div className="text-[10px] font-mono text-zinc-600 mt-1">{hint}</div>}
    </div>
  )
}

const DetailRow = ({ label, value, mono, color }) => (
  <div className="flex justify-between items-center py-1 border-b border-zinc-900/40">
    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</span>
    <span className={`${mono ? 'font-mono' : ''} ${color || 'text-zinc-200'}`}>{value}</span>
  </div>
)

// ============================================================
// SCORE GAUGE
// ============================================================
const ScoreGauge = ({ score, size = 'lg' }) => {
  const angle = (Math.min(100, Math.max(0, score)) / 100) * 180 - 90
  const dim   = size === 'sm' ? { w: 140, h: 90, vb: '0 0 200 130' } : { w: 200, h: 130, vb: '0 0 200 130' }
  const r = 60, cx = 100, cy = 100
  const arc = (start, end) => {
    const s = (start - 90) * Math.PI / 180, e = (end - 90) * Math.PI / 180
    return `M ${cx + r * Math.cos(s)} ${cy + r * Math.sin(s)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(e)} ${cy + r * Math.sin(e)}`
  }
  let actionColor = 'text-amber-400 border-amber-400/40 bg-amber-400/5', actionLabel = 'Manter com seleção', scoreColor = 'text-amber-400'
  if (score >= 70) { actionColor = 'text-blue-400 border-blue-500/40 bg-blue-500/5'; actionLabel = 'Forte candidato'; scoreColor = 'text-blue-400' }
  else if (score < 40) { actionColor = 'text-red-400 border-red-400/40 bg-red-400/5'; actionLabel = 'Cautela elevada'; scoreColor = 'text-red-400' }
  return (
    <div className="flex flex-col items-center">
      <svg viewBox={dim.vb} width={dim.w} height={dim.h}>
        <path d={arc(0, 60)}   stroke="#ef4444" strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.7" />
        <path d={arc(65, 115)} stroke="#f59e0b" strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.7" />
        <path d={arc(120,180)} stroke="#3b82f6" strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.7" />
        <g transform={`rotate(${angle} ${cx} ${cy})`}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - r + 2} stroke="#fafafa" strokeWidth="2" strokeLinecap="round" />
          <circle cx={cx} cy={cy} r="5" fill="#0a0a0a" stroke="#fafafa" strokeWidth="2" />
        </g>
      </svg>
      <div className={`text-${size === 'sm' ? '2xl' : '4xl'} font-bold ${scoreColor} -mt-2`} style={{ fontFamily: 'ui-monospace,monospace' }}>{score}</div>
      <div className={`mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded border ${actionColor}`}>
        <AlertCircle size={9} /> {actionLabel}
      </div>
    </div>
  )
}

// ============================================================
// PROFIT CHART
// ============================================================
const ProfitChart = ({ data, height = 160 }) => {
  const points = [
    { label: '2022', value: data.l1 }, { label: '2023', value: data.l2 },
    { label: '2024', value: data.l3 }, { label: '2025', value: data.l4 },
    { label: 'LTM',  value: data.lr  },
  ]
  const validPoints = points.filter(p => p.value != null)
  if (validPoints.length < 2) return null
  const max = Math.max(...validPoints.map(p => p.value))
  const min = Math.min(...validPoints.map(p => p.value))
  const range  = max - min || 1
  const W = 700, H = height, P = 30
  const xStep  = (W - P * 2) / (validPoints.length - 1)
  const yScale = (v) => H - P - ((v - min) / range) * (H - P * 2)
  const pathD  = validPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${P + i * xStep} ${yScale(p.value)}`).join(' ')
  const areaD  = pathD + ` L ${P + (validPoints.length - 1) * xStep} ${H - P} L ${P} ${H - P} Z`
  const gradId = `pgrad-${data.t}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: height + 'px' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#3b82f6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0"   />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map(t => (
        <line key={t} x1={P} x2={W - P} y1={P + t * (H - P * 2)} y2={P + t * (H - P * 2)}
          stroke="#27272a" strokeDasharray="2 4" strokeWidth="1" />
      ))}
      <path d={areaD} fill={`url(#${gradId})`} />
      <path d={pathD} stroke="#3b82f6" strokeWidth="2" fill="none" strokeLinejoin="round" />
      {validPoints.map((p, i) => {
        const x = P + i * xStep, y = yScale(p.value)
        return (
          <g key={p.label}>
            <circle cx={x} cy={y} r="3" fill="#000" stroke="#3b82f6" strokeWidth="2" />
            <text x={x} y={y - 10} fill="#3b82f6" fontSize="10" fontFamily="ui-monospace,monospace" textAnchor="middle" fontWeight="600">
              {p.value >= 1000 ? (p.value / 1000).toFixed(1) + 'B' : p.value.toFixed(0) + 'M'}
            </text>
            <text x={x} y={H - 8} fill="#71717a" fontSize="10" fontFamily="ui-monospace,monospace" textAnchor="middle">{p.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ============================================================
// MODAL: DETALHE
// ============================================================
const DetailModal = ({ item, allRanked, onClose, onPrev, onNext, position, total }) => {
  const score = computeGlobalScore(item, allRanked)
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4 pb-4 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg max-w-3xl w-full shadow-2xl my-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-900">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500">DETALHE · RANK #{item.rank_final}</span>
            <span className="text-[10px] font-mono text-zinc-700">{position}/{total}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onPrev} className="p-1.5 hover:bg-zinc-900 rounded text-zinc-400 hover:text-zinc-100 transition"><ChevronLeft size={14} /></button>
            <button onClick={onNext} className="p-1.5 hover:bg-zinc-900 rounded text-zinc-400 hover:text-zinc-100 transition"><ChevronRight size={14} /></button>
            <div className="w-px h-4 bg-zinc-800 mx-1" />
            <button onClick={onClose} className="p-1.5 hover:bg-zinc-900 rounded text-zinc-400 hover:text-zinc-100 transition"><X size={14} /></button>
          </div>
        </div>
        <div className="relative overflow-hidden">
          <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)' }} />
          <div className="relative px-6 py-5 grid grid-cols-12 gap-6">
            <div className="col-span-12 md:col-span-7">
              <h2 className="text-4xl font-bold tracking-tighter text-zinc-50 leading-none" style={{ fontFamily: 'ui-monospace,monospace' }}>{item.t}</h2>
              <p className="text-sm text-zinc-400 mt-2 mb-3 max-w-md">{item.n}</p>
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
                <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded">B3 / SAO</span>
                <span className="text-zinc-700">·</span>
                <span className="text-zinc-500">SCREENING APROVADO</span>
              </div>
            </div>
            <div className="col-span-12 md:col-span-5 flex flex-col items-center justify-center">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500 mb-1">Score Global</div>
              <ScoreGauge score={score} size="sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 border-t border-zinc-900">
            <HeroMetric label="Valor de Mercado"  value={fmtMoney(item.m * 1e6)} hint={`P/VP ${fmtNum(item.pvp, 2)}`} />
            <HeroMetric label="Patrimônio Líquido" value={fmtMoney(item.p * 1e6)} hint={`ROE ${fmtPct(item.roe, 1)}`} positive={item.roe >= 15} />
            <HeroMetric label="Lucro LTM"          value={fmtMoney(item.lr * 1e6)} hint={`CAGR ${fmtPct(item.cagr, 1)}`} positive={item.cagr >= 0} negative={item.cagr < 0} />
            <HeroMetric label="Indicador Graham"   value={fmtNum(item.graham, 1)} hint={`P/L ${fmtNum(item.pl_medio, 1)}`} positive={item.graham < 22.5} negative={item.graham > 50} />
          </div>
        </div>
        <div className="px-6 py-5 border-t border-zinc-900">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-400">Lucro líquido · 2022 → LTM</h3>
            <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${item.cv < 0.3 ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' : 'bg-amber-400/10 text-amber-400 border-amber-400/30'}`}>
              CV {fmtNum(item.cv, 2)} · {item.cv < 0.3 ? 'estável' : 'volátil'}
            </span>
          </div>
          <ProfitChart data={item} height={170} />
        </div>
        <div className="px-6 py-4 border-t border-zinc-900 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-xs">
          <DetailRow label="Volume médio 30d"       value={fmtVol(item.v)}              mono />
          <DetailRow label="Beta 36m"               value={fmtNum(item.b, 2)}           mono />
          <DetailRow label="Score final"            value={fmtNum(item.score, 1)}       mono />
          <DetailRow label="ROE médio 4y (2022–25)" value={fmtPct(item.roe_4y, 1, false)} mono color={item.roe_4y >= 12 ? 'text-blue-400' : ''} />
          <DetailRow label="Rank Graham"            value={`#${item.rank_graham}`}      mono />
          <DetailRow label="Rank Beta"              value={`#${item.rank_b}`}           mono />
        </div>
      </div>
    </div>
  )
}

// ============================================================
// MODAL: COMPARAÇÃO
// ============================================================
const CompareModal = ({ items, onClose }) => {
  const getCellStyle = (key, value, items) => {
    const values = items.map(i => i[key]).filter(v => v != null && !isNaN(v))
    if (!values.length) return ''
    const min = Math.min(...values), max = Math.max(...values)
    if (min === max) return ''
    const higherIsBetter = ['roe', 'roe_4y', 'cagr']
    const lowerIsBetter  = ['graham', 'pl_medio', 'pvp', 'cv', 'b', 'score', 'rank_final']
    let isBest = false
    if (higherIsBetter.includes(key)) isBest = value === max
    else if (lowerIsBetter.includes(key)) isBest = value === min
    return isBest ? 'text-blue-400 font-semibold' : 'text-zinc-300'
  }
  const rows = [
    { key: 'rank_final', label: 'Rank Final',              fmt: v => `#${v}`, monoLarge: true },
    { key: 'graham',     label: 'Indicador Graham',         fmt: v => fmtNum(v, 2) },
    { key: 'pl_medio',   label: 'P/L (2y)',                 fmt: v => fmtNum(v, 2) },
    { key: 'pvp',        label: 'P/VP',                     fmt: v => fmtNum(v, 2) },
    { key: 'roe',        label: 'ROE LTM',                  fmt: v => fmtPct(v, 1, false) },
    { key: 'roe_4y',     label: 'ROE 4 anos (2022–2025)',   fmt: v => fmtPct(v, 1, false) },
    { key: 'cagr',       label: 'CAGR lucro (2022→2025)',   fmt: v => fmtPct(v, 1) },
    { key: 'cv',         label: 'Consistência (CV)',         fmt: v => fmtNum(v, 2) },
    { key: 'b',          label: 'Beta 36m',                 fmt: v => fmtNum(v, 2) },
    { key: 'm',          label: 'Valor de Mercado',          fmt: v => fmtMoney(v * 1e6), nohighlight: true },
    { key: 'p',          label: 'Patrimônio Líquido',        fmt: v => fmtMoney(v * 1e6), nohighlight: true },
    { key: 'lr',         label: 'Lucro LTM',                fmt: v => fmtMoney(v * 1e6), nohighlight: true },
    { key: 'v',          label: 'Volume 30d',               fmt: v => fmtVol(v),         nohighlight: true },
    { key: 'score',      label: 'Score',                    fmt: v => fmtNum(v, 1) },
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4 pb-4 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg max-w-5xl w-full shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-900">
          <div className="flex items-center gap-2">
            <GitCompare size={14} className="text-blue-400" />
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-100">Comparação · {items.length} empresas</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-900 rounded text-zinc-400 hover:text-zinc-100 transition"><X size={14} /></button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900 border-b border-zinc-800">
              <tr>
                <th className="px-4 py-3 text-left text-[10px] font-mono uppercase tracking-wider text-zinc-500 sticky left-0 bg-zinc-900">Métrica</th>
                {items.map(item => (
                  <th key={item.s} className="px-4 py-3 text-right" style={{ minWidth: '160px' }}>
                    <div className="text-2xl font-bold tracking-tight text-zinc-50" style={{ fontFamily: 'ui-monospace,monospace' }}>{item.t}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5 truncate" title={item.n}>{item.n}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} className="border-b border-zinc-900/50 hover:bg-zinc-900/30 transition">
                  <td className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500 sticky left-0 bg-zinc-950">{row.label}</td>
                  {items.map(item => {
                    const v = item[row.key]
                    const styleClass = row.nohighlight ? 'text-zinc-300' : getCellStyle(row.key, v, items)
                    return (
                      <td key={item.s} className={`px-4 py-2.5 text-right font-mono ${row.monoLarge ? 'text-base font-bold' : ''} ${styleClass}`}>
                        {row.fmt(v)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-zinc-900 p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-400 mb-3">Lucro líquido · 2022–2025 + LTM</div>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
            {items.map(item => (
              <div key={item.s} className="bg-zinc-900/50 border border-zinc-800 rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono font-bold text-zinc-100">{item.t}</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${item.cv < 0.3 ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' : 'bg-amber-400/10 text-amber-400 border-amber-400/30'}`}>CV {fmtNum(item.cv, 2)}</span>
                </div>
                <ProfitChart data={item} height={130} />
              </div>
            ))}
          </div>
        </div>
        <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/50 text-[10px] font-mono uppercase tracking-wider text-zinc-600 flex justify-between">
          <span>Azul = melhor da linha (G/PL/PVP/CV/β: menor é melhor · ROE/CAGR: maior é melhor)</span>
          <span>ESC fecha</span>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// MODAL: HISTÓRICO DE SNAPSHOTS
// ============================================================
const HistoryModal = ({ onClose, onLoad }) => {
  const [snapshots, setSnapshots] = React.useState([])
  const [loadingList, setLoadingList] = React.useState(true)
  const [loadingId, setLoadingId]   = React.useState(null)

  React.useEffect(() => {
    listSnapshots(10)
      .then(setSnapshots)
      .catch(() => setSnapshots([]))
      .finally(() => setLoadingList(false))
  }, [])

  const handleLoad = async (docId) => {
    setLoadingId(docId)
    try {
      const snap = await loadSnapshot(docId)
      if (snap) onLoad(snap)
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 pb-4 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-xl w-full shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Clock size={13} className="text-blue-400" />
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-100">Histórico de bases</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-900 rounded text-zinc-400 hover:text-zinc-100 transition"><X size={14} /></button>
        </div>
        <div className="p-4">
          {loadingList
            ? <p className="text-center text-[11px] font-mono text-zinc-500 py-8 animate-pulse">Carregando...</p>
            : snapshots.length === 0
              ? <p className="text-center text-[11px] font-mono text-zinc-600 py-8">Nenhuma base salva ainda.</p>
              : (
                <div className="space-y-2">
                  {snapshots.map(s => (
                    <div key={s.docId} className="flex items-center justify-between px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg">
                      <div>
                        <div className="text-[11px] font-mono text-zinc-100">{fmtDate(s.updatedAt)}</div>
                        <div className="text-[10px] font-mono text-zinc-500 mt-0.5 truncate max-w-[260px]" title={s.fileName}>{s.fileName}</div>
                        <div className="text-[10px] font-mono text-zinc-600 mt-0.5">{s.totalRows} ativos importados</div>
                      </div>
                      <button
                        onClick={() => handleLoad(s.docId)}
                        disabled={!!loadingId}
                        className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg transition">
                        {loadingId === s.docId ? '...' : 'Carregar'}
                      </button>
                    </div>
                  ))}
                </div>
              )
          }
        </div>
        <div className="px-4 py-2 border-t border-zinc-800 text-[10px] font-mono text-zinc-600">
          Últimas 10 atualizações · cada base salva substitui o snapshot do mesmo dia
        </div>
      </div>
    </div>
  )
}

// ============================================================
// MAIN APP
// ============================================================
export default function ScreeningApp() {
  const [dataset, setDataset]       = React.useState([])
  const [datasetName, setDatasetName] = React.useState('')
  const [updatedAt, setUpdatedAt]   = React.useState(null)
  const [loading, setLoading]       = React.useState(false)
  const [saving, setSaving]         = React.useState(false)
  const [loadingDB, setLoadingDB]   = React.useState(true)
  const [error, setError]           = React.useState('')

  const [minVolume, setMinVolume]   = React.useState(800_000)
  const [volInput, setVolInput]     = React.useState('800,000')
  const [wGraham, setWGraham]       = React.useState(0.8)
  const [topN, setTopN]             = React.useState(25)
  const [sortKey, setSortKey]       = React.useState('rank_final')
  const [sortDir, setSortDir]       = React.useState('asc')
  const [search, setSearch]         = React.useState('')

  const [useRoe,   setUseRoe]   = React.useState(false)
  const [minRoe,   setMinRoe]   = React.useState(12)
  const [useRoe4y, setUseRoe4y] = React.useState(false)
  const [minRoe4y, setMinRoe4y] = React.useState(10)
  const [useCagr,  setUseCagr]  = React.useState(false)
  const [minCagr,  setMinCagr]  = React.useState(0)
  const [useCv,    setUseCv]    = React.useState(false)
  const [maxCv,    setMaxCv]    = React.useState(0.5)

  const [activePreset, setActivePreset]           = React.useState('graham')
  const [selectedForCompare, setSelectedForCompare] = React.useState(new Set())
  const [detailTicker, setDetailTicker]           = React.useState(null)
  const [showCompare, setShowCompare]             = React.useState(false)
  const [showHistory, setShowHistory]             = React.useState(false)

  const fileRef = useRef(null)

  // ── Carrega último snapshot do Firebase ao iniciar ──────────
  useEffect(() => {
    loadXLSXLib().catch(() => {})
    loadLatestSnapshot()
      .then(snap => {
        if (snap) {
          setDataset(snap.rows)
          setDatasetName(snap.fileName)
          setUpdatedAt(snap.updatedAt)
        }
      })
      .catch(() => {}) // Firebase não configurado ainda — ignora silenciosamente
      .finally(() => setLoadingDB(false))
  }, [])

  const indicators    = useMemo(() => computeIndicators(dataset, { minVolume }), [dataset, minVolume])
  const qualityFiltered = useMemo(() => applyQualityFilters(indicators, { useRoe, minRoe, useRoe4y, minRoe4y, useCagr, minCagr, useCv, maxCv }),
    [indicators, useRoe, minRoe, useRoe4y, minRoe4y, useCagr, minCagr, useCv, maxCv])
  const ranked = useMemo(() => finalRanking(qualityFiltered, wGraham), [qualityFiltered, wGraham])

  const filteredView = useMemo(() => {
    let v = ranked
    if (search.trim()) {
      const q = search.toLowerCase()
      v = v.filter(d => (d.t || '').toLowerCase().includes(q) || (d.n || '').toLowerCase().includes(q))
    }
    v = [...v].sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sortDir === 'asc' ? cmp : -cmp
    })
    return v
  }, [ranked, search, sortKey, sortDir])

  const top = filteredView.slice(0, topN)

  const stats = useMemo(() => {
    if (!ranked.length) return null
    const med = arr => { const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
    return { grahamMed: med(ranked.map(d => d.graham)), roeMed: med(ranked.map(d => d.roe)), betaMed: med(ranked.map(d => d.b)) }
  }, [ranked])

  const detailItem = useMemo(() => detailTicker ? ranked.find(d => d.t === detailTicker) || null : null, [detailTicker, ranked])
  const detailIdx  = useMemo(() => detailItem ? filteredView.findIndex(d => d.t === detailItem.t) : -1, [detailItem, filteredView])
  const compareItems = useMemo(() => ranked.filter(d => selectedForCompare.has(d.t)), [ranked, selectedForCompare])

  const handleSort     = key => { if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir('asc') } }
  const toggleCompare  = ticker => { setSelectedForCompare(prev => { const n = new Set(prev); n.has(ticker) ? n.delete(ticker) : n.size < 5 && n.add(ticker); return n }) }
  const navigateDetail = useCallback(dir => {
    if (!filteredView.length || detailIdx === -1) return
    let next = detailIdx + dir
    if (next < 0) next = filteredView.length - 1
    if (next >= filteredView.length) next = 0
    setDetailTicker(filteredView[next].t)
  }, [detailIdx, filteredView])

  useEffect(() => {
    const handleKey = e => {
      if (detailTicker) { if (e.key === 'Escape') setDetailTicker(null); if (e.key === 'ArrowLeft') navigateDetail(-1); if (e.key === 'ArrowRight') navigateDetail(1) }
      else if (showCompare) { if (e.key === 'Escape') setShowCompare(false) }
      else if (showHistory) { if (e.key === 'Escape') setShowHistory(false) }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [detailTicker, showCompare, showHistory, navigateDetail])

  const handleFile = async e => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true); setError('')
    try {
      const newData = await parseUploadedXLSX(file)
      if (newData.length === 0) throw new Error('Arquivo sem registros válidos.')

      // Salva no Firebase
      setSaving(true)
      const now = new Date().toISOString()
      await saveSnapshot(newData, file.name)

      setDataset(newData)
      setDatasetName(file.name)
      setUpdatedAt(now)
      setSelectedForCompare(new Set())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setSaving(false)
      // Limpa o input para permitir re-upload do mesmo arquivo
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleHistoryLoad = snap => {
    setDataset(snap.rows)
    setDatasetName(snap.fileName)
    setUpdatedAt(snap.updatedAt)
    setSelectedForCompare(new Set())
    setShowHistory(false)
  }

  const reset = () => {
    setMinVolume(800_000); setVolInput('800,000'); setWGraham(0.8); setTopN(25)
    setSortKey('rank_final'); setSortDir('asc'); setSearch('')
    setUseRoe(false); setUseRoe4y(false); setUseCagr(false); setUseCv(false)
    setMinRoe(12); setMinRoe4y(10); setMinCagr(0); setMaxCv(0.5)
    setActivePreset('graham'); setSelectedForCompare(new Set())
  }

  const applyPreset = preset => {
    setActivePreset(preset)
    if      (preset === 'graham')     { setUseRoe(false); setUseRoe4y(false); setUseCagr(false); setUseCv(false) }
    else if (preset === 'quality')    { setUseRoe(true); setMinRoe(12); setUseRoe4y(true); setMinRoe4y(10); setUseCagr(true); setMinCagr(0);  setUseCv(true); setMaxCv(0.5) }
    else if (preset === 'aggressive') { setUseRoe(true); setMinRoe(15); setUseRoe4y(true); setMinRoe4y(12); setUseCagr(true); setMinCagr(10); setUseCv(true); setMaxCv(0.4) }
  }

  const sortIcon = k => sortKey !== k ? '' : sortDir === 'asc' ? ' ↑' : ' ↓'

  // ── Splash ─────────────────────────────────────────────────
  if (loadingDB) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mx-auto mb-4" />
          <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">Carregando base...</p>
        </div>
      </div>
    )
  }

  if (dataset.length === 0) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6 font-sans">
        <div className="max-w-lg w-full">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 mb-6">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-[10px] tracking-[0.3em] text-zinc-500 uppercase font-mono">terminal · bc</span>
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-zinc-50" style={{ fontFamily: 'ui-monospace,"Geist Mono",monospace' }}>
              BC<span className="text-blue-500">.</span>QUANT
            </h1>
            <p className="text-xs text-zinc-500 mt-3 tracking-wide">VALUATION · QUALIDADE · RISCO · BRASIL</p>
          </div>
          <div onClick={() => fileRef.current?.click()}
            className="bg-zinc-900 border border-zinc-800 hover:border-blue-500/50 hover:bg-zinc-800/50 rounded-xl p-12 text-center cursor-pointer transition-all group">
            <FileSpreadsheet size={36} className="mx-auto text-zinc-600 group-hover:text-blue-400 transition mb-4" strokeWidth={1.5} />
            <p className="text-sm font-medium text-zinc-200 mb-1">Carregar Base de Dados</p>
            <p className="text-[11px] text-zinc-500 tracking-wide">SCREENING FUNDAMENTALS B3</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
          </div>
          {loading && <p className="text-center text-xs text-zinc-500 mt-4 font-mono animate-pulse">PROCESSANDO...</p>}
          {saving  && <p className="text-center text-xs text-blue-400 mt-2 font-mono animate-pulse">SALVANDO NO FIREBASE...</p>}
          {error   && <p className="text-center text-xs text-red-400 mt-4 font-mono">⚠ {error}</p>}
        </div>
      </div>
    )
  }

  // ── Dashboard ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <DarkRangeStyle />

      {/* TOP BAR */}
      <header className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-sm font-bold tracking-tight" style={{ fontFamily: 'ui-monospace,monospace' }}>
                BC<span className="text-blue-500">.</span>QUANT
              </span>
            </div>
            <div className="hidden md:flex items-center gap-3 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              <span className="truncate max-w-[200px] text-zinc-400">{datasetName}</span>
              <span className="text-zinc-700">·</span>
              <span>{dataset.length} ativos</span>
              <span className="text-zinc-700">·</span>
              <span className="text-blue-400">{ranked.length} aprovados</span>
              {updatedAt && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span className="text-zinc-500">atualizado {fmtDate(updatedAt)}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
            <button onClick={() => setShowHistory(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-zinc-100 rounded-lg transition">
              <Database size={11} /> Histórico
            </button>
            {loading || saving
              ? <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 animate-pulse px-3 py-1.5">
                  {saving ? 'Salvando...' : 'Processando...'}
                </span>
              : (
                <button onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-mono uppercase tracking-wider bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition">
                  <RefreshCw size={11} /> Atualizar base
                </button>
              )
            }
          </div>
        </div>
      </header>

      {/* TOOLBAR */}
      <div className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-[49px] z-20">
        <div className="max-w-[1600px] mx-auto px-6 py-3 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Preset:</span>
            <div className="flex gap-1.5">
              <Pill active={activePreset === 'graham'}     onClick={() => applyPreset('graham')}>Graham puro</Pill>
              <Pill active={activePreset === 'quality'}    onClick={() => applyPreset('quality')}>Qualidade balanceada</Pill>
              <Pill active={activePreset === 'aggressive'} onClick={() => applyPreset('aggressive')}>Qualidade agressiva</Pill>
            </div>
            <div className="w-px h-5 bg-zinc-800" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Qualidade:</span>
            <div className="flex gap-1.5 flex-wrap">
              <ToggleFilter active={useRoe}   onClick={() => setUseRoe(!useRoe)}   value={`ROE > ${minRoe}%`}
                tooltip={`ROE (Retorno sobre PL)\n= Lucro LTM ÷ Patrimônio Líquido × 100\n\nFiltro: elimina empresas com\nROE abaixo de ${minRoe}%`} />
              <ToggleFilter active={useRoe4y} onClick={() => setUseRoe4y(!useRoe4y)} value={`ROE 4y > ${minRoe4y}%`}
                tooltip={`ROE médio 4 anos\n= Média(2022, 2023, 2024, 2025) ÷ PL × 100\n\nFiltro: elimina empresas com\nROE médio abaixo de ${minRoe4y}%`} />
              <ToggleFilter active={useCagr}  onClick={() => setUseCagr(!useCagr)} value={`CAGR > ${minCagr}%`}
                tooltip={`CAGR do Lucro (2022 → 2025)\n= (Lucro 2025 ÷ Lucro 2022)^(1/3) − 1\n\nCrescimento anual composto em 3 anos.\nFiltro: elimina crescimento abaixo de ${minCagr}%`} />
              <ToggleFilter active={useCv}    onClick={() => setUseCv(!useCv)}     value={`CV < ${maxCv.toFixed(2)}`}
                tooltip={`CV — Coeficiente de Variação\n= Desvio Padrão ÷ Média(lucros 2022–2025)\n\nMede consistência: quanto menor, mais\nestável o lucro. Filtro: elimina CV acima de ${maxCv.toFixed(2)}`} />
            </div>
            <div className="ml-auto flex items-center gap-2">
              {selectedForCompare.size >= 2 && (
                <button onClick={() => setShowCompare(true)}
                  className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-mono uppercase tracking-wider font-semibold rounded transition">
                  <GitCompare size={11} /> Comparar ({selectedForCompare.size})
                </button>
              )}
              {selectedForCompare.size > 0 && (
                <button onClick={() => setSelectedForCompare(new Set())}
                  className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition">Limpar</button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-5 flex-wrap">
            <NumericField label="Vol. médio 30d (R$ mil)">
              <input type="text" inputMode="decimal" value={volInput}
                onChange={e => { const raw = e.target.value; setVolInput(raw); const n = parseFloat(raw.replace(/\./g, '').replace(',', '.')); if (isFinite(n) && n >= 0) setMinVolume(n * 1000) }}
                onBlur={() => { const n = minVolume / 1000; setVolInput(n.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })) }}
                className="w-36 px-2 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded font-mono text-zinc-200 focus:border-blue-500/50 focus:outline-none text-right" />
            </NumericField>
            <SliderField label="Pesos G/β" value={`${(wGraham * 100).toFixed(0)}/${((1 - wGraham) * 100).toFixed(0)}`}>
              <input type="range" min={0} max={1} step={0.05} value={wGraham} onChange={e => setWGraham(Number(e.target.value))} className="darkrange w-24" />
            </SliderField>
            <SliderField label="Top N" value={topN}>
              <input type="range" min={5} max={Math.max(50, ranked.length || 50)} step={5} value={topN} onChange={e => setTopN(Number(e.target.value))} className="darkrange w-20" />
            </SliderField>
            {useRoe   && <SliderField label="ROE"   value={`>${minRoe}%`}         accent><input type="range" min={0}   max={50} step={1}    value={minRoe}  onChange={e => setMinRoe(Number(e.target.value))}  className="darkrange w-20" /></SliderField>}
            {useRoe4y && <SliderField label="ROE 4y" value={`>${minRoe4y}%`}      accent><input type="range" min={0}   max={50} step={1}    value={minRoe4y} onChange={e => setMinRoe4y(Number(e.target.value))} className="darkrange w-20" /></SliderField>}
            {useCagr  && <SliderField label="CAGR"  value={`>${minCagr}%`}        accent><input type="range" min={-20} max={50} step={1}    value={minCagr} onChange={e => setMinCagr(Number(e.target.value))} className="darkrange w-20" /></SliderField>}
            {useCv    && <SliderField label="CV"    value={`<${maxCv.toFixed(2)}`} accent><input type="range" min={0.1} max={2}  step={0.05} value={maxCv}   onChange={e => setMaxCv(Number(e.target.value))}  className="darkrange w-20" /></SliderField>}
            <div className="flex-1 min-w-[180px] max-w-[260px] relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input type="text" placeholder="ticker ou empresa..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-800 rounded font-mono text-zinc-200 placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none" />
            </div>
            <button onClick={reset} className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition">
              <RotateCcw size={10} /> Reset
            </button>
          </div>
        </div>
      </div>

      {/* RANKING */}
      <div className="max-w-[1600px] mx-auto px-6 py-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-zinc-100">Ranking de empresas</h2>
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mt-1">
              {ranked.length} APROVADAS · TOP {Math.min(topN, filteredView.length)} EXIBIDAS · CLIQUE NA LINHA P/ DETALHES · CHECKBOX P/ COMPARAR
            </p>
          </div>
          {stats && (
            <div className="flex gap-2">
              <StatCard label="Graham med." value={fmtNum(stats.grahamMed, 1)} accent />
              <StatCard label="ROE med."    value={fmtPct(stats.roeMed, 1, false)} accent />
              <StatCard label="β med."      value={fmtNum(stats.betaMed, 2)} />
            </div>
          )}
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto" style={{ maxHeight: '70vh' }}>
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 sticky top-0 z-10 border-b border-zinc-800">
                <tr className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                  <th className="px-2 py-3 text-center w-10"><span className="text-zinc-600">☐</span></th>
                  <Th onClick={() => handleSort('rank_final')} active={sortKey === 'rank_final'} align="center" w="36px">#{sortIcon('rank_final')}</Th>
                  <Th onClick={() => handleSort('t')}         active={sortKey === 't'}           align="left">Ticker{sortIcon('t')}</Th>
                  <th className="px-2 py-3 text-left font-medium">Empresa</th>
                  <Th onClick={() => handleSort('m')}         active={sortKey === 'm'}>VM{sortIcon('m')}</Th>
                  <Th onClick={() => handleSort('graham')}    active={sortKey === 'graham'}    accent>Graham{sortIcon('graham')}</Th>
                  <Th onClick={() => handleSort('pl_medio')}  active={sortKey === 'pl_medio'}>P/L{sortIcon('pl_medio')}</Th>
                  <Th onClick={() => handleSort('pvp')}       active={sortKey === 'pvp'}>P/VP{sortIcon('pvp')}</Th>
                  <Th onClick={() => handleSort('roe')}       active={sortKey === 'roe'}>ROE{sortIcon('roe')}</Th>
                  <Th onClick={() => handleSort('roe_4y')}    active={sortKey === 'roe_4y'}>ROE 4y{sortIcon('roe_4y')}</Th>
                  <Th onClick={() => handleSort('cagr')}      active={sortKey === 'cagr'}>CAGR{sortIcon('cagr')}</Th>
                  <Th onClick={() => handleSort('cv')}        active={sortKey === 'cv'}>CV{sortIcon('cv')}</Th>
                  <Th onClick={() => handleSort('b')}         active={sortKey === 'b'}>β{sortIcon('b')}</Th>
                  <Th onClick={() => handleSort('score')}     active={sortKey === 'score'}>Score{sortIcon('score')}</Th>
                </tr>
              </thead>
              <tbody>
                {top.map(d => {
                  const isSelected = selectedForCompare.has(d.t)
                  return (
                    <tr key={d.s} onClick={() => setDetailTicker(d.t)}
                      className={`border-b border-zinc-800/50 transition cursor-pointer ${isSelected ? 'bg-blue-500/5' : 'hover:bg-zinc-800/40'}`}>
                      <td className="px-2 py-2 text-center" onClick={e => { e.stopPropagation(); toggleCompare(d.t) }}>
                        <span className={`inline-flex w-3.5 h-3.5 rounded-sm items-center justify-center cursor-pointer transition ${isSelected ? 'bg-blue-500 border-blue-500' : 'border border-zinc-600 hover:border-zinc-400'}`}>
                          {isSelected && <span className="text-white text-[10px] leading-none">✓</span>}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-center font-mono">
                        {d.rank_final <= 3
                          ? <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-600 text-white rounded-sm text-[10px] font-bold">{d.rank_final}</span>
                          : <span className="text-zinc-500">{d.rank_final}</span>}
                      </td>
                      <td className="px-2 py-2 font-mono font-bold text-zinc-100">{d.t}</td>
                      <td className="px-2 py-2 text-zinc-500 max-w-[200px] truncate" title={d.n}>{d.n}</td>
                      <td className="px-2 py-2 text-right font-mono text-zinc-300">{fmtAbbr(d.m)}</td>
                      <td className={`px-2 py-2 text-right font-mono font-semibold ${d.graham < 22.5 ? 'text-blue-400' : d.graham > 50 ? 'text-zinc-600' : 'text-amber-400'}`}>{fmtNum(d.graham, 1)}</td>
                      <td className="px-2 py-2 text-right font-mono text-zinc-400">{fmtNum(d.pl_medio, 1)}</td>
                      <td className="px-2 py-2 text-right font-mono text-zinc-400">{fmtNum(d.pvp, 2)}</td>
                      <td className={`px-2 py-2 text-right font-mono ${d.roe >= 15 ? 'text-blue-400' : 'text-zinc-400'}`}>{fmtPct(d.roe, 1, false)}</td>
                      <td className={`px-2 py-2 text-right font-mono ${d.roe_4y >= 12 ? 'text-blue-400' : 'text-zinc-400'}`}>{fmtPct(d.roe_4y, 1, false)}</td>
                      <td className={`px-2 py-2 text-right font-mono ${d.cagr >= 10 ? 'text-blue-400' : d.cagr < 0 ? 'text-red-400' : 'text-zinc-400'}`}>{fmtPct(d.cagr, 1)}</td>
                      <td className={`px-2 py-2 text-right font-mono ${d.cv < 0.3 ? 'text-blue-400' : d.cv > 0.6 ? 'text-zinc-600' : 'text-zinc-400'}`}>{fmtNum(d.cv, 2)}</td>
                      <td className="px-2 py-2 text-right font-mono text-zinc-400">{fmtNum(d.b, 2)}</td>
                      <td className="px-2 py-2 text-right font-mono font-bold text-zinc-100">{fmtNum(d.score, 1)}</td>
                    </tr>
                  )
                })}
                {top.length === 0 && (
                  <tr><td colSpan={14} className="px-3 py-12 text-center text-zinc-600 text-xs font-mono uppercase tracking-wider">
                    Nenhuma empresa atende aos critérios. Ajuste os filtros.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/40 text-[10px] font-mono uppercase tracking-wider text-zinc-600 flex justify-between">
            <span>Graham &lt; 22.5 atrativo · ROE ≥ 15 bom · CV &lt; 0.3 estável</span>
            <span className="text-blue-400/60">azul = acima da referência</span>
          </div>
        </div>
      </div>

      <footer className="max-w-[1600px] mx-auto px-6 py-4 border-t border-zinc-800">
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-600">
          <span>BC.QUANT · Bruno · {new Date().toLocaleDateString('pt-BR')}</span>
          <span>ESC fecha modal · ←→ navega entre empresas</span>
        </div>
      </footer>

      {detailItem && (
        <DetailModal item={detailItem} allRanked={ranked} onClose={() => setDetailTicker(null)}
          onPrev={() => navigateDetail(-1)} onNext={() => navigateDetail(1)}
          position={detailIdx + 1} total={filteredView.length} />
      )}
      {showCompare && compareItems.length >= 2 && (
        <CompareModal items={compareItems} onClose={() => setShowCompare(false)} />
      )}
      {showHistory && (
        <HistoryModal onClose={() => setShowHistory(false)} onLoad={handleHistoryLoad} />
      )}
    </div>
  )
}
