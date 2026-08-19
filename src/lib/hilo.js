// Hi-Lo Activator (Krausz) — SMA dos N períodos ANTERIORES (exclui barra atual)
const BRAPI_TOKEN = 'hsFUdwdsYC7VQQQUhoQ9fc';

export function hiloActivator(bars, length = 10) {
  if (!Array.isArray(bars) || bars.length < length + 2) return null;
  const n = bars.length;
  const hiSMA = new Array(n).fill(null);
  const loSMA = new Array(n).fill(null);
  for (let i = length; i < n; i++) {
    let sumH = 0, sumL = 0;
    for (let j = i - length + 1; j <= i; j++) { sumH += bars[j].high; sumL += bars[j].low; }
    hiSMA[i] = sumH / length;
    loSMA[i] = sumL / length;
  }
  let trend = null;
  let ultimoFlipIdx = length;
  for (let i = length; i < n; i++) {
    const c = bars[i].close;
    if (trend === null) { trend = c >= loSMA[i] ? 'UP' : 'DOWN'; ultimoFlipIdx = i; continue; }
    if (trend === 'UP' && c < loSMA[i]) { trend = 'DOWN'; ultimoFlipIdx = i; }
    else if (trend === 'DOWN' && c > hiSMA[i]) { trend = 'UP'; ultimoFlipIdx = i; }
  }
  const last = n - 1;
  const linha = trend === 'UP' ? loSMA[last] : hiSMA[last];
  const precoAtual = bars[last].close;
  const distanciaPct = ((precoAtual - linha) / linha) * 100;
  return { trend, linha, precoAtual, distanciaPct, barrasDesdeFlip: last - ultimoFlipIdx };
}

export async function fetchHistoricalDaily(ticker, range = '3mo') {
  const url = `https://brapi.dev/api/quote/${ticker}?range=${range}&interval=1d&token=${BRAPI_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BRAPI ${ticker}: ${res.status}`);
  const data = await res.json();
  const result = data.results?.[0];
  if (!result?.historicalDataPrice) return null;
  return result.historicalDataPrice.map(b => ({ date: b.date, high: b.high, low: b.low, close: b.close }));
}

export async function fetchHiloBatch(tickers, length = 10) {
  return Promise.all(tickers.map(async (t) => {
    try {
      const bars = await fetchHistoricalDaily(t, '3mo');
      if (!bars) return { ticker: t, error: 'no data' };
      const hilo = hiloActivator(bars, length);
      if (!hilo) return { ticker: t, error: 'insufficient bars' };
      return { ticker: t, ...hilo };
    } catch (e) { return { ticker: t, error: e.message }; }
  }));
}
