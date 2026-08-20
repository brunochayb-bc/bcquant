import { useEffect, useMemo, useRef, useState } from 'react';
import { saveOptionsData, loadOptionsData } from '../lib/firebase';
import { computeOperacao, computePosition, computePainel } from '../lib/optionsCalc';

const DEFAULT = { aporte: 0, numAtivos: 16, operacoes: [] };
const fmtBRL = v => v == null || isNaN(v) ? '—' : v.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
const fmtInt = v => v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('pt-BR');
const fmtPct = v => v == null || isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

// Input BRL: formata quando não focado, cru quando focado, select-all no focus
function MoneyInput({ value, onChange, className = '', ...rest }) {
  const [focused, setFocused] = useState(false);
  const [temp, setTemp] = useState('');
  const display = focused ? temp : fmtBRL(value || 0);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onFocus={e => { setFocused(true); setTemp(String(value || '')); setTimeout(() => e.target.select(), 0); }}
      onBlur={() => { setFocused(false); onChange(parseFloat(String(temp).replace(/\./g, '').replace(',', '.')) || 0); }}
      onChange={e => setTemp(e.target.value)}
      className={className}
      {...rest}
    />
  );
}

// Input inteiro com milhar: 6000 → "6.000"
function IntInput({ value, onChange, className = '', ...rest }) {
  const [focused, setFocused] = useState(false);
  const [temp, setTemp] = useState('');
  const display = focused ? temp : fmtInt(value || 0);
  return (
    <input
      type="text"
      inputMode="numeric"
      value={display}
      onFocus={e => { setFocused(true); setTemp(String(value || '')); setTimeout(() => e.target.select(), 0); }}
      onBlur={() => { setFocused(false); onChange(parseInt(String(temp).replace(/\D/g, ''), 10) || 0); }}
      onChange={e => setTemp(e.target.value)}
      className={className}
      {...rest}
    />
  );
}

export default function OptionsTab({ uid }) {
  const [data, setData] = useState(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('todas');
  const [mask, setMask] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const loaded = await loadOptionsData(uid);
        if (loaded) setData({ ...DEFAULT, ...loaded, operacoes: loaded.operacoes || [] });
      } catch (e) { setError('Erro ao carregar: ' + e.message); }
      finally { setLoading(false); }
    })();
  }, [uid]);

  const schedule = (next) => {
    setData(next);
    if (!uid) return;
    clearTimeout(saveTimer.current);
    setPending(true);
    saveTimer.current = setTimeout(async () => {
      try { await saveOptionsData(uid, next); }
      catch (e) { setError('Erro ao salvar: ' + e.message); }
      finally { setPending(false); }
    }, 500);
  };

  const updateOp = (id, patch) => schedule({ ...data, operacoes: data.operacoes.map(o => o.id === id ? {...o, ...patch} : o) });
  const removeOp = (id) => { if (confirm('Remover esta operação?')) schedule({ ...data, operacoes: data.operacoes.filter(o => o.id !== id) }); };
  const addOp = () => {
    const novo = {
      id: `op_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      dataAbertura: new Date().toISOString().slice(0,10),
      ativo: '', tipo: 'CALL', qtde: 0, custoMedio: 0,
      status: 'ABERTA', precoAtual: 0, dataFinal: ''
    };
    schedule({ ...data, operacoes: [novo, ...data.operacoes] });
  };

  const painel = useMemo(() => computePainel(data.operacoes, data.aporte), [data]);
  const filtered = useMemo(() => {
    if (filter === 'abertas') return data.operacoes.filter(o => o.status === 'ABERTA');
    if (filter === 'encerradas') return data.operacoes.filter(o => o.status === 'ENCERRADA');
    return data.operacoes;
  }, [data.operacoes, filter]);

  const m = v => mask ? '••••' : v;
  if (loading) return <div className="p-4 text-neutral-400">Carregando…</div>;

  const inp = "bg-transparent text-white border-b border-transparent hover:border-neutral-700 focus:border-blue-500 outline-none";

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold text-white">Opções</h2>
        {pending && <span className="text-xs text-neutral-500">salvando…</span>}
        {error && <span className="text-xs text-red-400 ml-2">{error}</span>}
        <button onClick={() => setMask(!mask)}
          className="ml-auto text-xs px-2 py-1 bg-neutral-800 hover:bg-neutral-700 rounded text-white">
          {mask ? 'Mostrar valores' : 'Ocultar valores'}
        </button>
      </div>

      {/* PAINEL */}
      <div className="border border-neutral-800 rounded overflow-hidden">
        <div className="bg-neutral-900 px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-400 border-b border-neutral-800">
          Painel de Caixa e Performance
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-neutral-800">
          <div className="px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Aporte Total</div>
            <MoneyInput value={data.aporte}
              onChange={v => schedule({...data, aporte: v})}
              className="w-full bg-transparent text-yellow-300 font-mono text-base text-left outline-none" />
          </div>
          <Kpi label="Capital Alocado" value={m(fmtBRL(painel.capitalAlocado))} />
          <Kpi label="Saldo em Caixa" value={m(fmtBRL(painel.saldoEmCaixa))} />
          <Kpi label="Resultado Realizado" value={m(fmtBRL(painel.resultadoRealizado))} color={painel.resultadoRealizado >= 0 ? 'emerald':'red'} />
          <Kpi label="Resultado em Aberto" value={m(fmtBRL(painel.resultadoEmAberto))} color={painel.resultadoEmAberto >= 0 ? 'emerald':'red'} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-neutral-800 border-t border-neutral-800">
          <Kpi label="Nº Op. Abertas" value={painel.nAbertas} />
          <Kpi label="Nº Op. Encerradas" value={painel.nEncerradas} />
          <Kpi label="Taxa de Acerto" value={`${painel.taxaAcerto.toFixed(1)}%`} />
          <Kpi label="% Ganhos s/ Aporte" value={`${painel.pctGanhos.toFixed(2)}%`} color="emerald" />
          <Kpi label="% Perdas s/ Aporte" value={`${painel.pctPerdas.toFixed(2)}%`} color="red" />
        </div>
      </div>

      {/* CONFIG */}
      <div className="flex items-center gap-4 text-xs text-neutral-400">
        <label className="flex items-center gap-2">
          Nº ativos operáveis (base do cálculo de Position):
          <input type="number" min="1" value={data.numAtivos}
            onFocus={e => e.target.select()}
            onChange={e => schedule({...data, numAtivos: parseInt(e.target.value) || 1})}
            className="w-16 px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-white text-center" />
        </label>
      </div>

      {/* FILTROS + ADD */}
      <div className="flex items-center gap-1 border-b border-neutral-800">
        {[
          ['todas', `Todas (${data.operacoes.length})`],
          ['abertas', `Abertas (${painel.nAbertas})`],
          ['encerradas', `Encerradas (${painel.nEncerradas})`],
        ].map(([k,l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-4 py-2 text-sm ${filter===k ? 'text-white border-b-2 border-blue-500' : 'text-neutral-400 hover:text-white'}`}>
            {l}
          </button>
        ))}
        <button onClick={addOp}
          className="ml-auto mb-1 px-3 py-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 rounded text-white">
          + Nova operação
        </button>
      </div>

      {/* TABELA */}
      <div className="overflow-x-auto border border-neutral-800 rounded">
        <table className="w-full text-xs">
          <thead className="bg-neutral-900 text-neutral-300">
            <tr>
              <th className="text-left px-2 py-2">Data Abertura</th>
              <th className="text-left px-2 py-2">Ativo</th>
              <th className="text-left px-2 py-2">Tipo</th>
              <th className="text-right px-2 py-2">Qtde</th>
              <th className="text-right px-2 py-2">Custo Médio</th>
              <th className="text-right px-2 py-2">Custo Total</th>
              <th className="text-left px-2 py-2">Status</th>
              <th className="text-right px-2 py-2">Preço Atual</th>
              <th className="text-left px-2 py-2">Data Final</th>
              <th className="text-right px-2 py-2">Liquidação</th>
              <th className="text-right px-2 py-2">Resultado</th>
              <th className="text-right px-2 py-2">%</th>
              <th className="text-center px-2 py-2">G/L</th>
              <th className="text-right px-2 py-2">Position</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(op => {
              const c = computeOperacao(op);
              const pos = computePosition(op.custoMedio, data.aporte, data.numAtivos);
              const ativoBg = op.tipo === 'CALL'
                ? 'bg-emerald-900/60 border-emerald-700'
                : 'bg-red-900/60 border-red-700';
              const isAberta = op.status === 'ABERTA';
              return (
                <tr key={op.id} className="border-t border-neutral-800 hover:bg-neutral-900/30">
                  <td className="px-1 py-1"><input type="date" value={op.dataAbertura || ''} onChange={e => updateOp(op.id, {dataAbertura: e.target.value})} className={`${inp} w-28`} /></td>
                  <td className="px-1 py-1">
                    <input type="text" value={op.ativo || ''}
                      onChange={e => updateOp(op.id, {ativo: e.target.value.toUpperCase()})}
                      onFocus={e => e.target.select()}
                      placeholder="TICKER"
                      className={`font-mono w-24 px-2 py-0.5 rounded border text-white outline-none focus:ring-1 focus:ring-blue-500 ${ativoBg}`} />
                  </td>
                  <td className="px-1 py-1">
                    <select value={op.tipo || 'CALL'} onChange={e => updateOp(op.id, {tipo: e.target.value})}
                      className={`border rounded px-1 py-0.5 font-semibold ${op.tipo === 'CALL' ? 'bg-emerald-900/40 border-emerald-800 text-emerald-300' : 'bg-red-900/40 border-red-800 text-red-300'}`}>
                      <option value="CALL">CALL</option>
                      <option value="PUT">PUT</option>
                    </select>
                  </td>
                  <td className="px-1 py-1 text-right">
                    <IntInput value={op.qtde} onChange={v => updateOp(op.id, {qtde: v})}
                      className={`${inp} text-right font-mono w-24`} />
                  </td>
                  <td className="px-1 py-1 text-right">
                    <MoneyInput value={op.custoMedio} onChange={v => updateOp(op.id, {custoMedio: v})}
                      className={`${inp} text-right font-mono w-24`} />
                  </td>
                  <td className="px-2 py-1 text-right text-neutral-300 font-mono">{fmtBRL(c.custoTotal)}</td>
                  <td className="px-1 py-1">
                    <select value={op.status || 'ABERTA'} onChange={e => updateOp(op.id, {status: e.target.value})}
                      className={`border rounded px-1 py-0.5 ${op.status === 'ABERTA' ? 'bg-blue-900/40 border-blue-800 text-blue-300' : 'bg-neutral-800 border-neutral-700 text-neutral-300'}`}>
                      <option value="ABERTA">ABERTA</option>
                      <option value="ENCERRADA">ENCERRADA</option>
                    </select>
                  </td>
                  <td className="px-1 py-1 text-right">
                    <MoneyInput value={op.precoAtual} onChange={v => updateOp(op.id, {precoAtual: v})}
                      className={`${inp} text-right font-mono w-24`} />
                  </td>
                  <td className="px-1 py-1">
                    {!isAberta && (
                      <input type="date" value={op.dataFinal || ''}
                        onChange={e => updateOp(op.id, {dataFinal: e.target.value})}
                        className={`${inp} w-28`} />
                    )}
                  </td>
                  <td className="px-2 py-1 text-right text-neutral-300 font-mono">{fmtBRL(c.liquidacao)}</td>
                  <td className={`px-2 py-1 text-right font-mono ${c.resultado > 0 ? 'text-emerald-400' : c.resultado < 0 ? 'text-red-400' : 'text-neutral-400'}`}>{fmtBRL(c.resultado)}</td>
                  <td className={`px-2 py-1 text-right font-mono ${c.resultadoPct > 0 ? 'text-emerald-400' : c.resultadoPct < 0 ? 'text-red-400' : 'text-neutral-400'}`}>{fmtPct(c.resultadoPct)}</td>
                  <td className="px-2 py-1 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      c.gl === 'GAIN' ? 'bg-emerald-900/60 text-emerald-300' :
                      c.gl === 'LOSS' ? 'bg-red-900/60 text-red-300' :
                      'bg-neutral-800 text-neutral-400'
                    }`}>{c.gl}</span>
                  </td>
                  <td className="px-2 py-1 text-right text-neutral-400 font-mono">{fmtInt(pos)}</td>
                  <td className="px-1 py-1"><button onClick={() => removeOp(op.id)} className="text-neutral-500 hover:text-red-400">✕</button></td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={15} className="p-8 text-center text-neutral-500">
                Nenhuma operação {filter !== 'todas' ? filter : ''}. Clique em "+ Nova operação" para começar.
              </td></tr>
            )}
          </tbody>
          {painel.nAbertas > 0 && (
            <tfoot className="bg-neutral-900 border-t-2 border-neutral-700">
              <tr>
                <td colSpan={9} className="px-3 py-2 text-right text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">
                  Total Liquidação (abertas) →
                </td>
                <td className="px-2 py-2 text-right font-mono text-yellow-300 font-bold">
                  {m(fmtBRL(painel.liquidacaoAberta))}
                </td>
                <td colSpan={5} className="px-2 py-2 text-[10px] text-neutral-500 italic">
                  feed p/ Visão Geral
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, color }) {
  const c = color === 'emerald' ? 'text-emerald-300' : color === 'red' ? 'text-red-300' : 'text-white';
  return (
    <div className="px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">{label}</div>
      <div className={`text-base font-mono ${c}`}>{value}</div>
    </div>
  );
}
