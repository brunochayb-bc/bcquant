import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  RotateCcw, FileSpreadsheet, X, ChevronLeft, ChevronRight,
  GitCompare, Search, AlertCircle, RefreshCw, Database, Clock,
  BarChart2, TrendingUp, TrendingDown, Home, Edit2, Check, Wifi, WifiOff,
} from 'lucide-react'
import {
  saveSnapshot,
  loadLatestSnapshot,
  listSnapshots,
  loadSnapshot,
  signInWithGoogle,
  signOutUser,
  onAuthChange,
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
const fmtMoneyFull = (v) => {
  if (v == null || isNaN(v)) return '—'
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
// ANALYTICS (Screening)
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
    d.v > 0 && d.m > 0 && d.p > 0 &&
    d.l1 > 0 && d.l2 > 0 && d.l3 > 0 && d.l4 > 0 && // todos os anos fixos positivos
    (d.lr > 0 || d.l4 > 0) && // lucro mais recente ou 2025 positivo
    d.b != null && !isNaN(d.b) && d.v > filters.minVolume
  )
  return filtered.map(d => {
    // Usa lr (mais recente) + l4 (2025); se lr=0, usa l4+l3
    const lucroMedio2y = d.lr > 0 ? (d.lr + d.l4) / 2 : (d.l4 + d.l3) / 2
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
// AUTH HOOK
// ============================================================
const ALLOWED_EMAILS = ['brunochayb@gmail.com', 'bruno.chayb@gmail.com']

function useAuth() {
  const [user, setUser]       = React.useState(undefined) // undefined = carregando
  const [authLoading, setAuthLoading] = React.useState(false)
  const [authError, setAuthError]     = React.useState('')

  useEffect(() => {
    const unsub = onAuthChange(u => setUser(u ?? null))
    return unsub
  }, [])

  const login = async () => {
    setAuthLoading(true); setAuthError('')
    try {
      const u = await signInWithGoogle()
      if (!ALLOWED_EMAILS.includes(u.email)) {
        await signOutUser()
        setAuthError('Acesso não autorizado para este e-mail.')
      }
    }
    catch (e) {
      if (e.code !== 'auth/popup-closed-by-user') setAuthError('Erro ao entrar com Google. Tente novamente.')
    }
    finally { setAuthLoading(false) }
  }

  const logout = async () => { await signOutUser() }

  return { user, authLoading, authError, login, logout }
}

// ============================================================
// TELA DE LOGIN
// ============================================================
function LoginScreen({ onLogin, loading, error }) {
  const today = new Date()
  const dd   = String(today.getDate()).padStart(2, '0')
  const mm   = String(today.getMonth() + 1).padStart(2, '0')
  const aaaa = today.getFullYear()
  const dataFormatada = `${dd}/${mm}/${aaaa}`

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-zinc-950">
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-blue-500 mb-2">• Terminal · BC</p>
      <h1 className="text-5xl font-bold font-mono text-white mb-2 tracking-tight">
        BC<span className="text-blue-500">.</span>QUANT
      </h1>
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-4">
        Valuation · Qualidade · Risco · Brasil
      </p>
      <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-zinc-700 mb-8">
        BC.QUANT · Bruno Chayb · {dataFormatada}
      </p>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center w-full max-w-sm">
        <button
          onClick={onLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 hover:border-zinc-500 rounded-xl text-sm font-mono text-zinc-200 transition-all"
        >
          {loading ? (
            <RefreshCw size={15} className="animate-spin text-zinc-400" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 18 18" className="shrink-0">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
              <path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
          )}
          {loading ? 'Entrando...' : 'Entrar com Google'}
        </button>
        {error && (
          <p className="mt-4 text-[11px] font-mono text-red-400 flex items-center justify-center gap-1.5">
            <AlertCircle size={11} /> {error}
          </p>
        )}
      </div>
    </div>
  )
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
// BRAPI — cotações B3
// ============================================================
const BRAPI_TOKEN = 'hsFUdwdsYC7VQQQUhoQ9fc'

async function fetchQuotes(tickers) {
  if (!tickers.length) return {}
  const result = {}
  await Promise.all(tickers.map(async (ticker) => {
    try {
      const url = `https://brapi.dev/api/quote/${ticker}?token=${BRAPI_TOKEN}`
      const res  = await fetch(url)
      if (!res.ok) return
      const json = await res.json()
      const q = (json.results || [])[0]
      if (q) {
        result[q.symbol] = {
          price:     q.regularMarketPrice,
          change:    q.regularMarketChangePercent,
          changeAbs: q.regularMarketChange,
        }
      }
    } catch {}
  }))
  return result
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
      <div className={`text-xl font-bold font-mono ${valueColor}`}>{value}</div>
      {hint && <div className="text-[10px] font-mono text-zinc-600 mt-1">{hint}</div>}
    </div>
  )
}
const DetailRow = ({ label, value, mono, color }) => (
  <div className="flex items-center justify-between py-1.5 border-b border-zinc-900/50 last:border-0">
    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</span>
    <span className={`text-xs ${mono ? 'font-mono' : ''} ${color || 'text-zinc-200'}`}>{value}</span>
  </div>
)

// ============================================================
// SCORE GAUGE
// ============================================================
const ScoreGauge = ({ score, size = 'md' }) => {
  const r = size === 'sm' ? 28 : 36
  const cx = r + 8, cy = r + 8
  const circumference = Math.PI * r
  const offset = circumference * (1 - score / 100)
  const color = score >= 70 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444'
  const dim = (r + 8) * 2
  return (
    <svg width={dim} height={r + 16} viewBox={`0 0 ${dim} ${r + 16}`}>
      <path d={`M 8 ${cy} A ${r} ${r} 0 0 1 ${dim - 8} ${cy}`} fill="none" stroke="#27272a" strokeWidth="4" strokeLinecap="round" />
      <path d={`M 8 ${cy} A ${r} ${r} 0 0 1 ${dim - 8} ${cy}`} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize={size === 'sm' ? 16 : 20} fontWeight="700" fontFamily="ui-monospace,monospace">{score}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="#52525b" fontSize="9" fontFamily="ui-monospace,monospace">SCORE</text>
    </svg>
  )
}

// ============================================================
// PROFIT CHART
// ============================================================
const ProfitChart = ({ data, height = 140 }) => {
  const points = [
    { label: '2022', value: data.l1 },
    { label: '2023', value: data.l2 },
    { label: '2024', value: data.l3 },
    { label: '2025', value: data.l4 },
    { label: 'LTM',  value: data.lr },
  ].filter(p => p.value != null && !isNaN(p.value))
  if (points.length < 2) return <div className="text-center text-zinc-700 text-xs py-4 font-mono">dados insuficientes</div>
  const W = 480, H = height, P = 40
  const values = points.map(p => p.value)
  const minV = Math.min(...values), maxV = Math.max(...values)
  const range = maxV - minV || 1
  const xStep = (W - P * 2) / (points.length - 1)
  const yScale = v => P / 2 + (H - P) * (1 - (v - minV) / range)
  const validPoints = points
  const pathD = validPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${P + i * xStep} ${yScale(p.value)}`).join(' ')
  const areaD = pathD + ` L ${P + (validPoints.length - 1) * xStep} ${H} L ${P} ${H} Z`
  const gradId = `grad_${data.s || 'x'}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
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
// MODAL: HISTÓRICO
// ============================================================
const HistoryModal = ({ onClose, onLoad }) => {
  const [snapshots, setSnapshots] = React.useState([])
  const [loadingList, setLoadingList] = React.useState(true)
  const [loadingId, setLoadingId]   = React.useState(null)
  React.useEffect(() => {
    listSnapshots(10).then(setSnapshots).catch(() => setSnapshots([])).finally(() => setLoadingList(false))
  }, [])
  const handleLoad = async (docId) => {
    setLoadingId(docId)
    try { const snap = await loadSnapshot(docId); if (snap) onLoad(snap) }
    finally { setLoadingId(null) }
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
              : <div className="space-y-2">
                  {snapshots.map(s => (
                    <div key={s.docId} className="flex items-center justify-between px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg">
                      <div>
                        <div className="text-[11px] font-mono text-zinc-100">{fmtDate(s.updatedAt)}</div>
                        <div className="text-[10px] font-mono text-zinc-500 mt-0.5 truncate max-w-[260px]">{s.fileName}</div>
                        <div className="text-[10px] font-mono text-zinc-600 mt-0.5">{s.totalRows} ativos</div>
                      </div>
                      <button onClick={() => handleLoad(s.docId)} disabled={!!loadingId}
                        className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg transition">
                        {loadingId === s.docId ? '...' : 'Carregar'}
                      </button>
                    </div>
                  ))}
                </div>
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
// PAGE: SCREENING GRAHAM
// ============================================================
function ScreeningPage() {
  const [dataset, setDataset]         = React.useState([])
  const [datasetName, setDatasetName] = React.useState('')
  const [updatedAt, setUpdatedAt]     = React.useState(null)
  const [loading, setLoading]         = React.useState(false)
  const [saving, setSaving]           = React.useState(false)
  const [loadingDB, setLoadingDB]     = React.useState(true)
  const [error, setError]             = React.useState('')
  const [minVolume, setMinVolume]     = React.useState(800_000)
  const [volInput, setVolInput]       = React.useState('800,000')
  const [wGraham, setWGraham]         = React.useState(0.8)
  const [topN, setTopN]               = React.useState(25)
  const [sortKey, setSortKey]         = React.useState('rank_final')
  const [sortDir, setSortDir]         = React.useState('asc')
  const [search, setSearch]           = React.useState('')
  const [useRoe,   setUseRoe]         = React.useState(false)
  const [minRoe,   setMinRoe]         = React.useState(12)
  const [useRoe4y, setUseRoe4y]       = React.useState(false)
  const [minRoe4y, setMinRoe4y]       = React.useState(10)
  const [useCagr,  setUseCagr]        = React.useState(false)
  const [minCagr,  setMinCagr]        = React.useState(0)
  const [useCv,    setUseCv]          = React.useState(false)
  const [maxCv,    setMaxCv]          = React.useState(0.5)
  const [activePreset, setActivePreset]             = React.useState('graham')
  const [selectedForCompare, setSelectedForCompare] = React.useState(new Set())
  const [detailTicker, setDetailTicker]             = React.useState(null)
  const [showCompare, setShowCompare]               = React.useState(false)
  const [showHistory, setShowHistory]               = React.useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    loadXLSXLib().catch(() => {})
    loadLatestSnapshot()
      .then(snap => { if (snap) { setDataset(snap.rows); setDatasetName(snap.fileName); setUpdatedAt(snap.updatedAt) } })
      .catch(() => {})
      .finally(() => setLoadingDB(false))
  }, [])

  const indicators      = useMemo(() => computeIndicators(dataset, { minVolume }), [dataset, minVolume])
  const qualityFiltered = useMemo(() => applyQualityFilters(indicators, { useRoe, minRoe, useRoe4y, minRoe4y, useCagr, minCagr, useCv, maxCv }),
    [indicators, useRoe, minRoe, useRoe4y, minRoe4y, useCagr, minCagr, useCv, maxCv])
  const ranked = useMemo(() => finalRanking(qualityFiltered, wGraham), [qualityFiltered, wGraham])
  const filteredView = useMemo(() => {
    let v = ranked
    if (search.trim()) { const q = search.toLowerCase(); v = v.filter(d => (d.t || '').toLowerCase().includes(q) || (d.n || '').toLowerCase().includes(q)) }
    v = [...v].sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sortDir === 'asc' ? cmp : -cmp
    })
    return v
  }, [ranked, search, sortKey, sortDir])
  const top    = filteredView.slice(0, topN)
  const stats  = useMemo(() => {
    if (!ranked.length) return null
    const med = arr => { const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
    return { grahamMed: med(ranked.map(d => d.graham)), roeMed: med(ranked.map(d => d.roe)), betaMed: med(ranked.map(d => d.b)) }
  }, [ranked])
  const detailItem  = useMemo(() => detailTicker ? ranked.find(d => d.t === detailTicker) || null : null, [detailTicker, ranked])
  const detailIdx   = useMemo(() => detailItem ? filteredView.findIndex(d => d.t === detailItem.t) : -1, [detailItem, filteredView])
  const compareItems = useMemo(() => ranked.filter(d => selectedForCompare.has(d.t)), [ranked, selectedForCompare])
  const handleSort      = key => { if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir('asc') } }
  const toggleCompare   = ticker => { setSelectedForCompare(prev => { const n = new Set(prev); n.has(ticker) ? n.delete(ticker) : n.size < 5 && n.add(ticker); return n }) }
  const navigateDetail  = useCallback(dir => {
    if (!filteredView.length || detailIdx === -1) return
    let next = detailIdx + dir
    if (next < 0) next = filteredView.length - 1
    if (next >= filteredView.length) next = 0
    setDetailTicker(filteredView[next].t)
  }, [detailIdx, filteredView])

  useEffect(() => {
    const handleKey = e => {
      if (detailTicker) { if (e.key === 'Escape') setDetailTicker(null); if (e.key === 'ArrowLeft') navigateDetail(-1); if (e.key === 'ArrowRight') navigateDetail(1) }
      else if (showCompare && e.key === 'Escape') setShowCompare(false)
      else if (showHistory && e.key === 'Escape') setShowHistory(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [detailTicker, showCompare, showHistory, navigateDetail])

  const handleFile = async e => {
    const file = e.target.files?.[0]; if (!file) return
    setLoading(true); setError('')
    try {
      const newData = await parseUploadedXLSX(file)
      if (newData.length === 0) throw new Error('Arquivo sem registros válidos.')
      setSaving(true)
      const now = new Date().toISOString()
      await saveSnapshot(newData, file.name)
      setDataset(newData); setDatasetName(file.name); setUpdatedAt(now); setSelectedForCompare(new Set())
    } catch (err) { setError(err.message) }
    finally { setLoading(false); setSaving(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const handleHistoryLoad = snap => { setDataset(snap.rows); setDatasetName(snap.fileName); setUpdatedAt(snap.updatedAt); setSelectedForCompare(new Set()); setShowHistory(false) }
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

  if (loadingDB) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mx-auto mb-4" />
        <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">Carregando base...</p>
      </div>
    </div>
  )

  if (dataset.length === 0) return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-lg w-full">
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

  return (
    <div className="flex-1 overflow-auto">
      <DarkRangeStyle />
      {/* TOP BAR */}
      <div className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-30">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="hidden md:flex items-center gap-3 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
            <span className="truncate max-w-[200px] text-zinc-400">{datasetName}</span>
            <span className="text-zinc-700">·</span>
            <span>{dataset.length} ativos</span>
            <span className="text-zinc-700">·</span>
            <span className="text-blue-400">{ranked.length} aprovados</span>
            {updatedAt && <><span className="text-zinc-700">·</span><span>atualizado {fmtDate(updatedAt)}</span></>}
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
            <button onClick={() => setShowHistory(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-zinc-100 rounded-lg transition">
              <Database size={11} /> Histórico
            </button>
            {loading || saving
              ? <span className="text-[11px] font-mono uppercase text-zinc-500 animate-pulse px-3 py-1.5">{saving ? 'Salvando...' : 'Processando...'}</span>
              : <button onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-mono uppercase tracking-wider bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition">
                  <RefreshCw size={11} /> Atualizar base
                </button>
            }
          </div>
        </div>
      </div>
      {/* TOOLBAR */}
      <div className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-[49px] z-20">
        <div className="px-6 py-3 space-y-3">
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
              <ToggleFilter active={useRoe}   onClick={() => setUseRoe(!useRoe)}   value={`ROE > ${minRoe}%`}         tooltip={`ROE (Retorno sobre PL)\n= Lucro LTM ÷ Patrimônio Líquido × 100\n\nFiltro: elimina empresas com\nROE abaixo de ${minRoe}%`} />
              <ToggleFilter active={useRoe4y} onClick={() => setUseRoe4y(!useRoe4y)} value={`ROE 4y > ${minRoe4y}%`}  tooltip={`ROE médio 4 anos\n= Média(2022, 2023, 2024, 2025) ÷ PL × 100\n\nFiltro: elimina empresas com\nROE médio abaixo de ${minRoe4y}%`} />
              <ToggleFilter active={useCagr}  onClick={() => setUseCagr(!useCagr)} value={`CAGR > ${minCagr}%`}       tooltip={`CAGR do Lucro (2022 → 2025)\n= (Lucro 2025 ÷ Lucro 2022)^(1/3) − 1\n\nCrescimento anual composto em 3 anos.\nFiltro: elimina crescimento abaixo de ${minCagr}%`} />
              <ToggleFilter active={useCv}    onClick={() => setUseCv(!useCv)}     value={`CV < ${maxCv.toFixed(2)}`}  tooltip={`CV — Coeficiente de Variação\n= Desvio Padrão ÷ Média(lucros 2022–2025)\n\nMede consistência: quanto menor, mais\nestável o lucro. Filtro: elimina CV acima de ${maxCv.toFixed(2)}`} />
            </div>
            <div className="ml-auto flex items-center gap-2">
              {selectedForCompare.size >= 2 && (
                <button onClick={() => setShowCompare(true)}
                  className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-mono uppercase tracking-wider font-semibold rounded transition">
                  <GitCompare size={11} /> Comparar ({selectedForCompare.size})
                </button>
              )}
              {selectedForCompare.size > 0 && (
                <button onClick={() => setSelectedForCompare(new Set())} className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition">Limpar</button>
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
      {/* RANKING TABLE */}
      <div className="px-6 py-5">
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
      <footer className="px-6 py-4 border-t border-zinc-800">
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-600">
          <span>BC.QUANT · Bruno · {new Date().toLocaleDateString('pt-BR')}</span>
          <span>ESC fecha modal · ←→ navega entre empresas</span>
        </div>
      </footer>
      {detailItem && <DetailModal item={detailItem} allRanked={ranked} onClose={() => setDetailTicker(null)} onPrev={() => navigateDetail(-1)} onNext={() => navigateDetail(1)} position={detailIdx + 1} total={filteredView.length} />}
      {showCompare && compareItems.length >= 2 && <CompareModal items={compareItems} onClose={() => setShowCompare(false)} />}
      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} onLoad={handleHistoryLoad} />}
    </div>
  )
}

// ============================================================
// PAGE: PORTFOLIO
// ============================================================
const PORTFOLIO_STORAGE_KEY = 'bcquant_carteiras_v2'

const defaultCarteiras = [
  {
    id: 'bcgusma',
    nome: 'BCGusma',
    ativos: [
      { ticker: 'COGN3', quantidade: 17100, custoMedio: 3.53 },
      { ticker: 'CEAB3', quantidade: 5000,  custoMedio: 14.98 },
      { ticker: 'AUGO3', quantidade: 333,   custoMedio: 36.12 },
      { ticker: 'MDNE3', quantidade: 2100,  custoMedio: 25.21 },
      { ticker: 'MOVI3', quantidade: 6000,  custoMedio: 8.26 },
      { ticker: 'EMBJ3', quantidade: 700,   custoMedio: 86.36 },
      { ticker: 'TFCO4', quantidade: 3500,  custoMedio: 17.16 },
      { ticker: 'LWSA3', quantidade: 16000, custoMedio: 3.79 },
      { ticker: 'PINE4', quantidade: 3000,  custoMedio: 15.94 },
      { ticker: 'LAVV3', quantidade: 4000,  custoMedio: 13.38 },
    ],
  },
  {
    id: 'bcsmdez25',
    nome: 'BC SM dez25',
    ativos: [
      { ticker: 'ABCB4',  quantidade: 3200, custoMedio: 20.92 },
      { ticker: 'BMGB4',  quantidade: 8700, custoMedio: 2.55 },
      { ticker: 'BRAP4',  quantidade: 1800, custoMedio: 16.09 },
      { ticker: 'BRSR6',  quantidade: 5440, custoMedio: 11.97 },
      { ticker: 'EUCA4',  quantidade: 2600, custoMedio: 14.42 },
      { ticker: 'ISAE4',  quantidade: 1600, custoMedio: 23.67 },
      { ticker: 'JBSS32', quantidade: 680,  custoMedio: 44.68 },
      { ticker: 'JHSF3',  quantidade: 9100, custoMedio: 4.13 },
      { ticker: 'LOGG3',  quantidade: 600,  custoMedio: 21.03 },
      { ticker: 'MELK3',  quantidade: 6200, custoMedio: 3.07 },
      { ticker: 'PRIO3',  quantidade: 500,  custoMedio: 36.54 },
      { ticker: 'SAPR11', quantidade: 3400, custoMedio: 23.02 },
    ],
  },
]

// ── Tabela de uma carteira ─────────────────────────────────
function CarteiraTable({ ativos, quotes, onEdit, onRemove, editingIdx, editBuf, setEditBuf, onSaveEdit, ocultar }) {
  const masked = '••••••'
  const [sortKey, setSortKey] = React.useState('ticker')
  const [sortDir, setSortDir] = React.useState('asc')

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  const sortIcon = (key) => sortKey !== key ? ' ↕' : sortDir === 'asc' ? ' ↑' : ' ↓'

  const rawRows = ativos.map((item, originalIdx) => {
    const q     = quotes[item.ticker] || {}
    const custo = item.quantidade * item.custoMedio
    const cot   = q.price ?? null
    const liq   = cot != null ? item.quantidade * cot : null
    const res   = liq != null ? liq - custo : null
    const pct   = res != null ? (res / custo) * 100 : null
    return { ...item, custo, cot, varDiaria: q.change ?? null, liq, res, pct, originalIdx }
  })

  const rows = [...rawRows].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity
    const bv = b[sortKey] ?? -Infinity
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
    return sortDir === 'asc' ? cmp : -cmp
  })

  const totalCusto = rawRows.reduce((s, r) => s + r.custo, 0)
  const totalLiq   = rawRows.reduce((s, r) => s + (r.liq ?? r.custo), 0)
  const totalRes   = totalLiq - totalCusto
  const totalPct   = totalCusto > 0 ? (totalRes / totalCusto) * 100 : 0

  const ThS = ({ k, children, align = 'right' }) => (
    <th onClick={() => handleSort(k)}
      className={`px-3 py-3 text-${align} font-medium cursor-pointer select-none transition hover:text-zinc-200 whitespace-nowrap ${sortKey === k ? 'text-blue-400' : 'text-zinc-500'}`}>
      {children}{sortIcon(k)}
    </th>
  )

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-zinc-900 border-b border-zinc-800">
            <tr className="text-[10px] font-mono uppercase tracking-wider">
              <th className="px-3 py-3 text-left w-8 text-zinc-500"></th>
              <ThS k="ticker" align="left">Ativo</ThS>
              <ThS k="quantidade">Qtd.</ThS>
              <ThS k="custoMedio">Custo Médio</ThS>
              <ThS k="custo">Custo Total</ThS>
              <ThS k="cot">Cotação</ThS>
              <ThS k="varDiaria">Var. Diária</ThS>
              <ThS k="liq">Vl. Liquidação</ThS>
              <ThS k="res">Resultado Histórico</ThS>
              <ThS k="pct">% Histórico</ThS>
              <th className="px-3 py-3 text-center w-16 text-zinc-500">Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const idx       = row.originalIdx
              const isGain    = row.res != null && row.res >= 0
              const isLoss    = row.res != null && row.res < 0
              const isEditing = editingIdx === idx
              return (
                <tr key={row.ticker} className={`border-b border-zinc-800/50 transition ${isEditing ? 'bg-blue-500/5' : 'hover:bg-zinc-800/30'}`}>
                  <td className="px-3 py-2.5">
                    {row.res != null
                      ? isGain
                        ? <span className="flex items-center justify-center w-5 h-5 rounded bg-emerald-500/15 text-emerald-400"><TrendingUp size={10} /></span>
                        : <span className="flex items-center justify-center w-5 h-5 rounded bg-red-500/15 text-red-400"><TrendingDown size={10} /></span>
                      : <span className="w-5 h-5 block" />}
                  </td>
                  <td className="px-3 py-2.5 font-mono font-bold text-zinc-100">{row.ticker}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                    {isEditing
                      ? <input type="number" value={editBuf.quantidade} onChange={e => setEditBuf(b => ({ ...b, quantidade: e.target.value }))}
                          className="w-24 px-2 py-0.5 bg-zinc-900 border border-blue-500/50 rounded font-mono text-zinc-200 text-right focus:outline-none text-xs" />
                      : row.quantidade.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                    {isEditing
                      ? <input type="number" step="0.01" value={editBuf.custoMedio} onChange={e => setEditBuf(b => ({ ...b, custoMedio: e.target.value }))}
                          className="w-24 px-2 py-0.5 bg-zinc-900 border border-blue-500/50 rounded font-mono text-zinc-200 text-right focus:outline-none text-xs" />
                      : ocultar ? masked : fmtMoneyFull(row.custoMedio)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-400">{ocultar ? masked : fmtMoneyFull(row.custo)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-200">
                    {row.cot != null ? fmtMoneyFull(row.cot) : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono ${row.varDiaria == null ? 'text-zinc-600' : row.varDiaria >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {row.varDiaria != null ? fmtPct(row.varDiaria, 2) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                    {ocultar ? masked : row.liq != null ? fmtMoneyFull(row.liq) : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono font-semibold ${isGain ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-zinc-600'}`}>
                    {ocultar ? masked : row.res != null ? (row.res >= 0 ? '+' : '') + fmtMoneyFull(row.res) : '—'}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono font-semibold ${isGain ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-zinc-600'}`}>
                    {row.pct != null ? fmtPct(row.pct, 1) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {isEditing
                        ? <button onClick={() => onSaveEdit(idx)} className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400 transition"><Check size={12} /></button>
                        : <button onClick={() => onEdit(idx)} className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200 transition"><Edit2 size={12} /></button>}
                      <button onClick={() => onRemove(idx)} className="p-1 rounded hover:bg-red-500/20 text-zinc-600 hover:text-red-400 transition"><X size={12} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-zinc-900/60 border-t border-zinc-700">
            <tr className="text-[10px] font-mono uppercase tracking-wider">
              <td colSpan={4} className="px-3 py-3 text-zinc-500">Total carteira</td>
              <td className="px-3 py-3 text-right font-mono font-semibold text-zinc-200">{ocultar ? '••••••' : fmtMoneyFull(totalCusto)}</td>
              <td colSpan={2} />
              <td className="px-3 py-3 text-right font-mono font-semibold text-zinc-200">{ocultar ? '••••••' : fmtMoneyFull(totalLiq)}</td>
              <td className={`px-3 py-3 text-right font-mono font-bold ${totalRes >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {ocultar ? '••••••' : (totalRes >= 0 ? '+' : '') + fmtMoneyFull(totalRes)}
              </td>
              <td className={`px-3 py-3 text-right font-mono font-bold ${totalRes >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmtPct(totalPct, 2)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/40 text-[10px] font-mono uppercase tracking-wider text-zinc-600">
        Cotações via BRAPI · B3 · Clique em ✏ para editar · Clique no cabeçalho para ordenar
      </div>
    </div>
  )
}

// ── Visão geral consolidada ────────────────────────────────
function VisaoGeral({ carteiras, quotes, onNavigate, ocultar }) {
  const carteiraStats = carteiras.map(c => {
    const rows = c.ativos.map(item => {
      const q     = quotes[item.ticker] || {}
      const custo = item.quantidade * item.custoMedio
      const cot   = q.price ?? null
      const liq   = cot != null ? item.quantidade * cot : null
      const res   = liq != null ? liq - custo : null
      return { custo, liq: liq ?? custo, res: res ?? 0 }
    })
    const totalCusto = rows.reduce((s, r) => s + r.custo, 0)
    const totalLiq   = rows.reduce((s, r) => s + r.liq, 0)
    const totalRes   = totalLiq - totalCusto
    const totalPct   = totalCusto > 0 ? (totalRes / totalCusto) * 100 : 0
    return { ...c, totalCusto, totalLiq, totalRes, totalPct }
  })

  const grandCusto  = carteiraStats.reduce((s, c) => s + c.totalCusto, 0)
  const grandLiq    = carteiraStats.reduce((s, c) => s + c.totalLiq, 0)
  const grandRes    = grandLiq - grandCusto
  const grandPct    = grandCusto > 0 ? (grandRes / grandCusto) * 100 : 0
  const totalAtivos = carteiras.reduce((s, c) => s + c.ativos.length, 0)
  const isGain      = grandRes >= 0

  const masked = '••••••'

  return (
    <div className="space-y-6">
      {/* HERO — resumo consolidado */}
      <div className="relative rounded-2xl overflow-hidden border border-zinc-700/50"
        style={{ background: 'linear-gradient(135deg, #18181b 0%, #1c1c1f 60%, #141416 100%)' }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: isGain
            ? 'radial-gradient(ellipse at top right, rgba(16,185,129,0.07) 0%, transparent 60%)'
            : 'radial-gradient(ellipse at top right, rgba(239,68,68,0.07) 0%, transparent 60%)' }} />
        <div className="relative px-8 py-7">
          <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-zinc-500 mb-5">Consolidado · todas as carteiras</div>
          <div className="flex flex-wrap items-end gap-8">
            {/* Retorno % — destaque principal */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Retorno total</div>
              <div className={`text-5xl font-bold font-mono leading-none ${isGain ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmtPct(grandPct, 2)}
              </div>
            </div>
            <div className="w-px h-12 bg-zinc-800 hidden md:block" />
            {/* Resultado em R$ */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Resultado</div>
              <div className={`text-2xl font-bold font-mono ${isGain ? 'text-emerald-400' : 'text-red-400'}`}>
                {ocultar ? masked : (grandRes >= 0 ? '+' : '') + fmtMoneyFull(grandRes)}
              </div>
            </div>
            <div className="w-px h-12 bg-zinc-800 hidden md:block" />
            {/* Investido */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Investido</div>
              <div className="text-xl font-mono text-zinc-300">{ocultar ? masked : fmtMoneyFull(grandCusto)}</div>
            </div>
            {/* Valor atual */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Valor atual</div>
              <div className="text-xl font-mono text-zinc-300">{ocultar ? masked : fmtMoneyFull(grandLiq)}</div>
            </div>
          </div>
          {/* Stats menores */}
          <div className="flex gap-6 mt-5 pt-5 border-t border-zinc-800">
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              <span className="text-zinc-300 font-semibold">{carteiras.length}</span> carteiras
            </div>
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              <span className="text-zinc-300 font-semibold">{totalAtivos}</span> ativos
            </div>
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              <span className={`font-semibold ${carteiraStats.filter(c => c.totalRes >= 0).length > 0 ? 'text-emerald-400' : 'text-zinc-300'}`}>
                {carteiraStats.filter(c => c.totalRes >= 0).length}
              </span> carteiras em gain
            </div>
          </div>
        </div>
      </div>

      {/* Cards por carteira */}
      <div>
        <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500 mb-3">Por carteira</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {carteiraStats.map(c => {
            const gain = c.totalRes >= 0
            return (
              <button key={c.id} onClick={() => onNavigate(c.id)}
                className="group relative bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl p-5 text-left transition-all overflow-hidden">
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{ background: gain
                    ? 'radial-gradient(ellipse at top left, rgba(16,185,129,0.04) 0%, transparent 60%)'
                    : 'radial-gradient(ellipse at top left, rgba(239,68,68,0.04) 0%, transparent 60%)' }} />
                <div className="relative">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="text-sm font-bold font-mono text-zinc-100">{c.nome}</div>
                      <div className="text-[10px] font-mono text-zinc-600 mt-0.5">{c.ativos.length} ativos</div>
                    </div>
                    {/* % destaque */}
                    <div className={`text-2xl font-bold font-mono ${gain ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmtPct(c.totalPct, 2)}
                    </div>
                  </div>
                  {/* Barra de progresso visual */}
                  <div className="w-full h-0.5 bg-zinc-800 rounded-full mb-4 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${gain ? 'bg-emerald-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, Math.abs(c.totalPct))}%` }} />
                  </div>
                  {/* Valores */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-[9px] font-mono uppercase text-zinc-600 mb-0.5">Investido</div>
                      <div className="text-xs font-mono text-zinc-400">{ocultar ? masked : fmtMoneyFull(c.totalCusto)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-mono uppercase text-zinc-600 mb-0.5">Atual</div>
                      <div className="text-xs font-mono text-zinc-400">{ocultar ? masked : fmtMoneyFull(c.totalLiq)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-mono uppercase text-zinc-600 mb-0.5">Resultado</div>
                      <div className={`text-xs font-mono font-semibold ${gain ? 'text-emerald-400' : 'text-red-400'}`}>
                        {ocultar ? masked : (c.totalRes >= 0 ? '+' : '') + fmtMoneyFull(c.totalRes)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 text-[10px] font-mono text-zinc-600 group-hover:text-zinc-400 transition flex items-center gap-1">
                    Ver carteira <ChevronRight size={10} />
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
      {/* RANKING TOP 10 MELHOR / PIOR */}
      {(() => {
        const todosAtivos = carteiras.flatMap(c => c.ativos.map(item => {
          const q     = quotes[item.ticker] || {}
          const custo = item.quantidade * item.custoMedio
          const cot   = q.price ?? null
          const liq   = cot != null ? item.quantidade * cot : null
          const res   = liq != null ? liq - custo : null
          const pct   = res != null ? (res / custo) * 100 : null
          return { ticker: item.ticker, carteira: c.nome, custo, liq, res, pct }
        })).filter(a => a.pct != null)

        if (!todosAtivos.length) return null

        const sorted   = [...todosAtivos].sort((a, b) => b.pct - a.pct)
        const top10    = sorted.slice(0, 10)
        const worst10  = [...sorted].reverse().slice(0, 10)

        const RankRow = ({ item, rank, isGain }) => (
          <div className="flex items-center gap-3 py-2 border-b border-zinc-800/50 last:border-0">
            <span className="text-[10px] font-mono text-zinc-600 w-5 text-center">{rank}</span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-zinc-100">{item.ticker}</span>
                <span className="text-[9px] font-mono text-zinc-600">{item.carteira}</span>
              </div>
              {!ocultar && (
                <div className="text-[10px] font-mono text-zinc-600 mt-0.5">
                  {(item.res >= 0 ? '+' : '') + fmtMoneyFull(item.res)}
                </div>
              )}
            </div>
            <div className={`text-sm font-bold font-mono ${isGain ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtPct(item.pct, 1)}
            </div>
          </div>
        )

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* TOP 10 MELHORES */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
                <TrendingUp size={12} className="text-emerald-400" />
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-400">Top 10 · Melhor alocação</span>
              </div>
              <div className="px-4">
                {top10.map((item, i) => (
                  <RankRow key={item.ticker + i} item={item} rank={i + 1} isGain={true} />
                ))}
              </div>
            </div>
            {/* TOP 10 PIORES */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
                <TrendingDown size={12} className="text-red-400" />
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-400">Top 10 · Pior alocação</span>
              </div>
              <div className="px-4">
                {worst10.map((item, i) => (
                  <RankRow key={item.ticker + i} item={item} rank={i + 1} isGain={false} />
                ))}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function PortfolioPage({ user }) {
  const [carteiras, setCarteiras] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(PORTFOLIO_STORAGE_KEY)) || defaultCarteiras }
    catch { return defaultCarteiras }
  })
  const [quotes, setQuotes]       = React.useState({})
  const [quotesTs, setQuotesTs]   = React.useState(null)
  const [loading, setLoading]     = React.useState(false)
  const [online, setOnline]       = React.useState(true)
  const [activeTab, setActiveTab] = React.useState('geral')
  const [editingIdx, setEditingIdx] = React.useState(null)
  const [editBuf, setEditBuf]     = React.useState({})
  const [newTicker, setNewTicker] = React.useState('')
  const [showAdd, setShowAdd]     = React.useState(false)
  const [showNewCarteira, setShowNewCarteira] = React.useState(false)
  const [newCarteiraNome, setNewCarteiraNome] = React.useState('')
  const [ocultar, setOcultar]     = React.useState(false)

  useEffect(() => {
    try { localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(carteiras)) } catch {}
  }, [carteiras])

  const allTickers = [...new Set(carteiras.flatMap(c => c.ativos.map(a => a.ticker)))]

  const fetchAll = async () => {
    setLoading(true)
    const result = await fetchQuotes(allTickers)
    setOnline(Object.keys(result).length > 0)
    setQuotes(result)
    setQuotesTs(new Date())
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [allTickers.join(',')])

  const activeCarteira = carteiras.find(c => c.id === activeTab)

  const updateAtivos = (carteiraId, fn) => {
    setCarteiras(prev => prev.map(c => c.id === carteiraId ? { ...c, ativos: fn(c.ativos) } : c))
    setEditingIdx(null)
  }

  const startEdit = (idx) => {
    if (!activeCarteira) return
    setEditingIdx(idx)
    setEditBuf({ quantidade: activeCarteira.ativos[idx].quantidade, custoMedio: activeCarteira.ativos[idx].custoMedio })
  }
  const saveEdit = (idx) => {
    const qtd   = parseFloat(String(editBuf.quantidade).replace(',', '.'))
    const custo = parseFloat(String(editBuf.custoMedio).replace(',', '.'))
    if (!isNaN(qtd) && qtd >= 0 && !isNaN(custo) && custo >= 0) {
      updateAtivos(activeTab, ativos => ativos.map((a, i) => i === idx ? { ...a, quantidade: qtd, custoMedio: custo } : a))
    } else { setEditingIdx(null) }
  }
  const removeItem = (idx) => updateAtivos(activeTab, ativos => ativos.filter((_, i) => i !== idx))
  const addItem = () => {
    const t = newTicker.trim().toUpperCase()
    if (!t || !activeCarteira) return
    updateAtivos(activeTab, ativos => [...ativos, { ticker: t, quantidade: 0, custoMedio: 0 }])
    setNewTicker('')
    setShowAdd(false)
    setTimeout(() => setEditingIdx(activeCarteira.ativos.length), 50)
  }
  const addCarteira = () => {
    const nome = newCarteiraNome.trim()
    if (!nome) return
    const id = nome.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now()
    setCarteiras(prev => [...prev, { id, nome, ativos: [] }])
    setActiveTab(id)
    setNewCarteiraNome('')
    setShowNewCarteira(false)
  }
  const removeCarteira = (id) => {
    setCarteiras(prev => prev.filter(c => c.id !== id))
    setActiveTab('geral')
  }

  // totais globais para o header
  const grandRows = carteiras.flatMap(c => c.ativos.map(item => {
    const q = quotes[item.ticker] || {}
    const custo = item.quantidade * item.custoMedio
    const liq   = q.price != null ? item.quantidade * q.price : custo
    return { custo, liq }
  }))
  const grandCusto = grandRows.reduce((s, r) => s + r.custo, 0)
  const grandLiq   = grandRows.reduce((s, r) => s + r.liq, 0)
  const grandRes   = grandLiq - grandCusto
  const grandPct   = grandCusto > 0 ? (grandRes / grandCusto) * 100 : 0

  return (
    <div className="flex-1 overflow-auto" style={{ background: '#111113' }}>
      {/* TOP BAR */}
      <div className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-30">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs font-mono text-zinc-400 uppercase tracking-wider">
            <span className="text-zinc-300 font-semibold">{carteiras.length} carteiras</span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-300 font-semibold">{allTickers.length} ativos</span>
            <span className="text-zinc-700">·</span>
            <span className={`font-bold text-sm ${grandRes >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {ocultar ? '••••••' : (grandRes >= 0 ? '+' : '') + fmtMoneyFull(grandRes)}
              {' '}<span className="text-base">({fmtPct(grandPct, 2)})</span>
            </span>
            {quotesTs && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="flex items-center gap-1.5 text-[11px]">
                  {online
                    ? <><Wifi size={10} className="text-emerald-400" /><span className="text-emerald-400">ao vivo {quotesTs.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></>
                    : <><WifiOff size={10} className="text-red-400" /><span className="text-red-400">sem cotação</span></>}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Botão ocultar valores */}
            <button onClick={() => setOcultar(o => !o)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider border rounded-lg transition ${ocultar ? 'border-blue-500/40 text-blue-400 bg-blue-500/10' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'}`}>
              {ocultar ? '👁 Mostrar' : '🙈 Ocultar'}
            </button>
            {activeTab !== 'geral' && (
              <button onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-zinc-100 rounded-lg transition">
                + Ativo
              </button>
            )}
            <button onClick={fetchAll} disabled={loading}
              className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-mono uppercase tracking-wider bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg transition">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Atualizando...' : 'Atualizar cotações'}
            </button>
          </div>
        </div>

        {/* ABAS */}
        <div className="px-6 flex items-center gap-1 border-t border-zinc-900 overflow-x-auto">
          <button onClick={() => { setActiveTab('geral'); setEditingIdx(null) }}
            className={`px-4 py-2.5 text-[11px] font-mono uppercase tracking-wider border-b-2 transition whitespace-nowrap ${activeTab === 'geral' ? 'border-blue-500 text-blue-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            Visão Geral
          </button>
          {carteiras.map(c => (
            <div key={c.id} className="relative group flex items-center">
              <button onClick={() => { setActiveTab(c.id); setEditingIdx(null) }}
                className={`px-4 py-2.5 text-[11px] font-mono uppercase tracking-wider border-b-2 transition whitespace-nowrap ${activeTab === c.id ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                {c.nome}
              </button>
              {carteiras.length > 1 && (
                <button onClick={() => removeCarteira(c.id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-600 hover:text-red-400 transition absolute -right-1 top-1">
                  <X size={9} />
                </button>
              )}
            </div>
          ))}
          <button onClick={() => setShowNewCarteira(true)}
            className="px-3 py-2.5 text-[11px] font-mono text-zinc-600 hover:text-zinc-400 transition whitespace-nowrap">
            + carteira
          </button>
        </div>
      </div>

      {/* ADD TICKER */}
      {showAdd && activeTab !== 'geral' && (
        <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-900/50 flex items-center gap-3">
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Novo ativo:</span>
          <input autoFocus type="text" placeholder="Ex: PETR4" value={newTicker}
            onChange={e => setNewTicker(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') addItem(); if (e.key === 'Escape') setShowAdd(false) }}
            className="px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded font-mono text-zinc-200 focus:border-blue-500/50 focus:outline-none w-32" />
          <button onClick={addItem} className="px-3 py-1.5 text-[10px] font-mono uppercase bg-blue-600 hover:bg-blue-500 text-white rounded transition">Adicionar</button>
          <button onClick={() => setShowAdd(false)} className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition">Cancelar</button>
        </div>
      )}

      {/* ADD CARTEIRA */}
      {showNewCarteira && (
        <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-900/50 flex items-center gap-3">
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Nome da carteira:</span>
          <input autoFocus type="text" placeholder="Ex: BC Growth" value={newCarteiraNome}
            onChange={e => setNewCarteiraNome(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCarteira(); if (e.key === 'Escape') setShowNewCarteira(false) }}
            className="px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded font-mono text-zinc-200 focus:border-blue-500/50 focus:outline-none w-48" />
          <button onClick={addCarteira} className="px-3 py-1.5 text-[10px] font-mono uppercase bg-blue-600 hover:bg-blue-500 text-white rounded transition">Criar</button>
          <button onClick={() => setShowNewCarteira(false)} className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition">Cancelar</button>
        </div>
      )}

      {/* CONTENT */}
      <div className="px-6 py-6">
        {activeTab === 'geral'
          ? <VisaoGeral carteiras={carteiras} quotes={quotes} onNavigate={setActiveTab} ocultar={ocultar} />
          : activeCarteira
            ? <CarteiraTable
                ativos={activeCarteira.ativos}
                quotes={quotes}
                onEdit={startEdit}
                onRemove={removeItem}
                editingIdx={editingIdx}
                editBuf={editBuf}
                setEditBuf={setEditBuf}
                onSaveEdit={saveEdit}
                ocultar={ocultar}
              />
            : null
        }
      </div>

      <footer className="px-6 py-4 border-t border-zinc-800/50">
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-600">
          <span>BC.QUANT · Portfólio · {new Date().toLocaleDateString('pt-BR')}</span>
          <span>Dados salvos localmente · cotações {online ? 'ao vivo' : 'indisponíveis'}</span>
        </div>
      </footer>
    </div>
  )
}

// ============================================================
// LAYOUT: SIDEBAR + MAIN
// ============================================================
const NAV_ITEMS = [
  { id: 'screening', label: 'Screening Graham', icon: BarChart2 },
  { id: 'portfolio', label: 'Portfólio',         icon: TrendingUp },
]

export default function App() {
  const [page, setPage] = React.useState('home')
  const { user, authLoading, authError, login, logout } = useAuth()

  if (user === undefined) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mx-auto mb-4" />
          <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">Verificando acesso...</p>
        </div>
      </div>
    )
  }

  if (user === null) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-lg font-bold tracking-tight" style={{ fontFamily: 'ui-monospace,monospace' }}>
              BC<span className="text-blue-500">.</span>QUANT
            </span>
          </div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">Plataforma de análise quantitativa</p>
        </div>
        <LoginScreen onLogin={login} loading={authLoading} error={authError} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {/* GLOBAL HEADER */}
      <header className="border-b border-zinc-800 bg-zinc-950 z-40 shrink-0">
        <div className="px-6 py-3 flex items-center gap-6">
          {/* Logo */}
          <button onClick={() => setPage('home')} className="flex items-center gap-2 group">
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-sm font-bold tracking-tight" style={{ fontFamily: 'ui-monospace,monospace' }}>
              BC<span className="text-blue-500">.</span>QUANT
            </span>
          </button>

          {/* Divider */}
          <div className="w-px h-4 bg-zinc-800" />

          {/* NAV */}
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon
              const active = page === item.id
              const isPortfolio = item.id === 'portfolio'
              return (
                <button key={item.id} onClick={() => setPage(item.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-[11px] font-mono uppercase tracking-wider transition ${
                    active
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                      : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}>
                  <Icon size={11} />
                  {item.label}
                  {isPortfolio && user === null && (
                    <span className="text-zinc-600 text-[9px]">🔒</span>
                  )}
                </button>
              )
            })}
          </nav>

          {/* AUTH STATUS */}
          <div className="ml-auto flex items-center gap-3">
            {user === undefined ? (
              <div className="w-1.5 h-1.5 bg-zinc-700 rounded-full animate-pulse" />
            ) : user ? (
              <div className="flex items-center gap-2">
                {user.photoURL && (
                  <img src={user.photoURL} alt="" className="w-6 h-6 rounded-full border border-zinc-700" />
                )}
                <span className="text-[10px] font-mono text-zinc-400 hidden md:block truncate max-w-[140px]">
                  {user.displayName || user.email}
                </span>
                <button onClick={logout}
                  className="text-[10px] font-mono uppercase tracking-wider text-zinc-600 hover:text-zinc-300 transition px-2 py-1 rounded hover:bg-zinc-800">
                  Sair
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* PAGE CONTENT */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {page === 'home'      && <HomePage onNavigate={setPage} />}
        {page === 'screening' && <ScreeningPage />}
        {page === 'portfolio' && (
          user === undefined ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mx-auto mb-4" />
                <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">Verificando acesso...</p>
              </div>
            </div>
          ) : user ? (
            <PortfolioPage user={user} />
          ) : (
            <LoginScreen onLogin={login} loading={authLoading} error={authError} />
          )
        )}
      </main>
    </div>
  )
}

// ============================================================
// HOME PAGE
// ============================================================
function HomePage({ onNavigate }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        {/* Hero */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-[10px] tracking-[0.3em] text-zinc-500 uppercase font-mono">terminal · bc</span>
          </div>
          <h1 className="text-6xl font-bold tracking-tight text-zinc-50 mb-4" style={{ fontFamily: 'ui-monospace,"Geist Mono",monospace' }}>
            BC<span className="text-blue-500">.</span>QUANT
          </h1>
          <p className="text-sm text-zinc-500 tracking-widest uppercase font-mono">
            Valuation · Qualidade · Risco · Brasil
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button onClick={() => onNavigate('screening')}
            className="group relative p-6 bg-zinc-900 border border-zinc-800 hover:border-blue-500/40 rounded-xl text-left transition-all hover:bg-zinc-800/60">
            <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'radial-gradient(circle at top left, rgba(59,130,246,0.05) 0%, transparent 60%)' }} />
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <BarChart2 size={16} className="text-blue-400" />
                </div>
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-blue-400/70">Módulo 01</span>
              </div>
              <h2 className="text-base font-bold text-zinc-100 mb-2" style={{ fontFamily: 'ui-monospace,monospace' }}>Screening Graham</h2>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Análise quantitativa da B3 pelo método Graham. Ranking por valuation, qualidade e risco. Filtros, comparação e histórico de bases.
              </p>
              <div className="mt-4 flex items-center gap-1 text-[10px] font-mono text-blue-400/60 group-hover:text-blue-400 transition">
                Acessar <ChevronRight size={10} />
              </div>
            </div>
          </button>

          <button onClick={() => onNavigate('portfolio')}
            className="group relative p-6 bg-zinc-900 border border-zinc-800 hover:border-emerald-500/40 rounded-xl text-left transition-all hover:bg-zinc-800/60">
            <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'radial-gradient(circle at top left, rgba(16,185,129,0.05) 0%, transparent 60%)' }} />
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <TrendingUp size={16} className="text-emerald-400" />
                </div>
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400/70">Módulo 02</span>
              </div>
              <h2 className="text-base font-bold text-zinc-100 mb-2" style={{ fontFamily: 'ui-monospace,monospace' }}>Portfólio</h2>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Acompanhe sua carteira em tempo real. Cotações ao vivo via BRAPI, resultado por ativo, gain/loss e valor de liquidação.
              </p>
              <div className="mt-4 flex items-center gap-1 text-[10px] font-mono text-emerald-400/60 group-hover:text-emerald-400 transition">
                Acessar <ChevronRight size={10} />
              </div>
            </div>
          </button>
        </div>

        <p className="text-center text-[10px] font-mono text-zinc-700 mt-10 uppercase tracking-widest">
          BC.QUANT · Bruno · {new Date().toLocaleDateString('pt-BR')}
        </p>
      </div>
    </div>
  )
}
