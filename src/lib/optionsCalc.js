// Cálculos derivados para operações de opções

export function computeOperacao(op) {
  const qtde = Number(op.qtde) || 0;
  const custoMedio = Number(op.custoMedio) || 0;
  const precoAtual = Number(op.precoAtual) || 0;
  const custoTotal = qtde * custoMedio;
  const liquidacao = qtde * precoAtual;
  const resultado = liquidacao - custoTotal;
  const resultadoPct = custoTotal > 0 ? (resultado / custoTotal) * 100 : 0;
  const gl = resultado > 0 ? 'GAIN' : resultado < 0 ? 'LOSS' : '-';
  return { custoTotal, liquidacao, resultado, resultadoPct, gl };
}

export function computePosition(custoMedio, aporte, numAtivos) {
  const c = Number(custoMedio);
  const a = Number(aporte);
  const n = Number(numAtivos);
  if (!c || c <= 0 || !a || !n || n <= 0) return 0;
  return Math.floor((a / n) / c);
}

export function computePainel(operacoes, aporte) {
  const ops = Array.isArray(operacoes) ? operacoes : [];
  const abertas = ops.filter(o => o.status === 'ABERTA');
  const encerradas = ops.filter(o => o.status === 'ENCERRADA');

  const capitalAlocado = abertas.reduce((s, o) => s + computeOperacao(o).custoTotal, 0);
  const resultadoRealizado = encerradas.reduce((s, o) => s + computeOperacao(o).resultado, 0);
  const resultadoEmAberto = abertas.reduce((s, o) => s + computeOperacao(o).resultado, 0);
  const saldoEmCaixa = (Number(aporte) || 0) - capitalAlocado + resultadoRealizado;

  const gainsEnc = encerradas.filter(o => computeOperacao(o).resultado > 0);
  const lossesEnc = encerradas.filter(o => computeOperacao(o).resultado < 0);
  const somaGanhosEnc = gainsEnc.reduce((s, o) => s + computeOperacao(o).resultado, 0);
  const somaPerdasEnc = Math.abs(lossesEnc.reduce((s, o) => s + computeOperacao(o).resultado, 0));

  const ap = Number(aporte) || 0;
  const liquidacaoAberta = abertas.reduce((s, o) => s + computeOperacao(o).liquidacao, 0);
  return {
    aporte: ap,
    capitalAlocado,
    saldoEmCaixa,
    resultadoRealizado,
    resultadoEmAberto,
    liquidacaoAberta,
    nAbertas: abertas.length,
    nEncerradas: encerradas.length,
    taxaAcerto: encerradas.length > 0 ? (gainsEnc.length / encerradas.length) * 100 : 0,
    pctGanhos: ap > 0 ? (somaGanhosEnc / ap) * 100 : 0,
    pctPerdas: ap > 0 ? (somaPerdasEnc / ap) * 100 : 0,
  };
}
