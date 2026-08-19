import { useEffect, useMemo, useState } from 'react';
import { saveHiloWatchlist, loadHiloWatchlist } from '../lib/firebase';
import { fetchHiloBatch } from '../lib/hilo';

const HILO_LENGTH = 10;
const REFRESH_MS = 5 * 60 * 1000;

export default function HiloTab({ uid }) {
  const [tickers, setTickers] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [input, setInput] = useState('');
  const [sortKey, setSortKey] = useState('distanciaPct');
  const [sortDir, setSortDir] = useState('asc');
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const list = await loadHiloWatchlist(uid);
        setTickers(list);
      } catch (e) { setError('Falha ao carregar watchlist: ' + e.message); }
    })();
  }, [uid]);

  const refresh = async () => {
    if (tickers.length === 0) { setRows([]); return; }
    setLoading(true);
    try {
      const data = await fetchHiloBatch(tickers, HILO_LENGTH);
      setRows(data);
      setLastUpdate(new Date());
    } catch (e) { setError('Falha no fetch: ' + e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [tickers]);

  const saveTickers = async (next) => {
    setTickers(next);
    if (!uid) return;
    setSaving(true);
    try {
      await saveHiloWatchlist(uid, next);
    } catch (e) { setError('Falha ao salvar: ' + e.message); }
    finally { setSaving(false); }
  };

  const addTicker = () => {
    const t = input.trim().toUpperCase();
    if (!t || tickers.includes(t)) { setInput(''); return; }
    saveTickers([...tickers, t]);
    setInput('');
  };
  const removeTicker = (t) => saveTickers(tickers.filter(x => x !== t));

  const toggleSort = (k) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      if (a.error && !b.error) return 1;
      if (!a.error && b.error) return -1;
      if (a.error && b.error) return 0;
      const va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const sortIcon = (k) => sortKey !== k ? '↕' : (sortDir === 'asc' ? '↑' : '↓');
  const fmt = (v, d = 2) => v == null || isNaN(v) ? '—' : v.toFixed(d);
  const fmtBRL = (v) => v == null || isNaN(v) ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xl font-bold text-white">Hi-Lo Activator</h2>
        <span className="text-xs text-neutral-400">length={HILO_LENGTH} · diário</span>
        {lastUpdate && (
          <span className="text-xs text-neutral-500 ml-auto">
            Atualizado {lastUpdate.toLocaleTimeString('pt-BR')}
          </span>
        )}
        <button onClick={refresh} disabled={loading}
          className="ml-2 px-3 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 rounded text-white disabled:opacity-50">
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
      <div className="flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTicker()}
          placeholder="Adicionar ticker (ex: PETR4)"
          className="flex-1 max-w-xs px-3 py-1 bg-neutral-900 border border-neutral-700 rounded text-white text-sm" />
        <button onClick={addTicker}
          className="px-3 py-1 text-sm bg-emerald-700 hover:bg-emerald-600 rounded text-white">
          + Adicionar
        </button>
        {saving && <span className="text-xs text-neutral-400 self-center">salvando…</span>}
      </div>
      {error && (
        <div className="p-2 bg-red-900/40 border border-red-700 rounded text-sm text-red-200">{error}</div>
      )}
      {tickers.length === 0 ? (
        <div className="text-sm text-neutral-400 p-8 text-center border border-neutral-800 rounded">
          Nenhum ativo na watchlist. Adicione tickers acima para começar.
        </div>
      ) : (
        <div className="overflow-x-auto border border-neutral-800 rounded">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-300">
              <tr>
                <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('ticker')}>Ticker {sortIcon('ticker')}</th>
                <th className="text-right px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('precoAtual')}>Preço {sortIcon('precoAtual')}</th>
                <th className="text-center px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('trend')}>Trend {sortIcon('trend')}</th>
                <th className="text-right px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('linha')}>Linha Hi-Lo {sortIcon('linha')}</th>
                <th className="text-right px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('distanciaPct')}>Dist. % {sortIcon('distanciaPct')}</th>
                <th className="text-right px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort('barrasDesdeFlip')}>Barras {sortIcon('barrasDesdeFlip')}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => (
                <tr key={r.ticker} className="border-t border-neutral-800 hover:bg-neutral-900/50">
                  <td className="px-3 py-2 font-mono text-white">{r.ticker}</td>
                  {r.error ? (
                    <td colSpan={5} className="px-3 py-2 text-red-400 text-xs">erro: {r.error}</td>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-right text-white font-mono">{fmtBRL(r.precoAtual)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          r.trend === 'UP' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-red-900/60 text-red-300'
                        }`}>
                          {r.trend === 'UP' ? '▲ ALTA' : '▼ BAIXA'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-300 font-mono">{fmtBRL(r.linha)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${
                        r.distanciaPct >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {r.distanciaPct >= 0 ? '+' : ''}{fmt(r.distanciaPct)}%
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-400 font-mono">{r.barrasDesdeFlip ?? '—'}</td>
                    </>
                  )}
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => removeTicker(r.ticker)}
                      className="text-neutral-500 hover:text-red-400 text-xs" title="Remover">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-xs text-neutral-500">
        UP: preço acima da média das {HILO_LENGTH} mínimas anteriores (linha = suporte).
        DOWN: preço abaixo da média das {HILO_LENGTH} máximas anteriores (linha = resistência).
        Ordene por Dist. % asc para ver candidatos de reversão no topo.
      </div>
    </div>
  );
}
