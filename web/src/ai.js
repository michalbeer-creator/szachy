// Prosty przeciwnik komputerowy: alfa-beta + wyszukiwanie spokojne (bicia) + tablice pozycyjne.
import { Chess } from 'chess.js';

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Tablice pozycyjne z punktu widzenia białych, a8 = indeks 0 (jak board() w chess.js)
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20],
  kEnd: [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50],
};

/** Ocena z punktu widzenia strony, która ma ruch. */
function evaluate(chess) {
  const b = chess.board();
  let score = 0; let heavy = 0;
  for (const row of b) for (const sq of row) if (sq && sq.type !== 'p' && sq.type !== 'k') heavy += VAL[sq.type];
  const endgame = heavy <= 1300;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = b[r][f];
      if (!sq) continue;
      const idx = sq.color === 'w' ? r * 8 + f : (7 - r) * 8 + f;
      const table = sq.type === 'k' && endgame ? PST.kEnd : PST[sq.type];
      const v = VAL[sq.type] + table[idx];
      score += sq.color === 'w' ? v : -v;
    }
  }
  return chess.turn() === 'w' ? score : -score;
}

const MATE = 100000;

function order(moves) {
  return moves.sort((a, b) => score(b) - score(a));
  function score(m) {
    let s = 0;
    if (m.captured) s += 10 * VAL[m.captured] - VAL[m.piece] + 1000;
    if (m.promotion) s += VAL[m.promotion];
    return s;
  }
}

export function bestMove(fen, level = 2) {
  const chess = new Chess(fen);
  const maxDepth = level <= 1 ? 1 : level === 2 ? 3 : 5;
  const budget = level <= 1 ? 300 : level === 2 ? 1500 : 3500;
  const deadline = Date.now() + budget;
  const qMax = level <= 1 ? 1 : 3;
  let nodes = 0; let timeUp = false;

  function quiesce(alpha, beta, qd) {
    nodes++;
    const stand = evaluate(chess);
    if (stand >= beta) return beta;
    if (alpha < stand) alpha = stand;
    if (qd <= 0) return alpha;
    const caps = order(chess.moves({ verbose: true }).filter((m) => m.captured || m.promotion));
    for (const m of caps) {
      // przycinanie: nawet zbicie nie ratuje oceny
      if (m.captured && stand + VAL[m.captured] + 200 < alpha) continue;
      chess.move(m);
      const v = -quiesce(-beta, -alpha, qd - 1);
      chess.undo();
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  function search(d, alpha, beta, ply) {
    nodes++;
    if ((nodes & 63) === 0 && Date.now() > deadline) timeUp = true;
    if (timeUp) return 0;
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return chess.inCheck() ? -MATE + ply : 0;
    if (chess.isInsufficientMaterial() || chess.isDrawByFiftyMoves()) return 0;
    if (d <= 0) return quiesce(alpha, beta, qMax);
    for (const m of order(moves)) {
      chess.move(m);
      const v = -search(d - 1, -beta, -alpha, ply + 1);
      chess.undo();
      if (timeUp) return 0;
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  let root = order(chess.moves({ verbose: true }));
  if (!root.length) return null;
  const noise = level <= 1 ? 80 : 0;
  let best = root[0];
  // pogłębianie iteracyjne: najlepszy ruch z poprzedniej głębokości sprawdzamy najpierw
  for (let depth = 1; depth <= maxDepth; depth++) {
    let iterBest = null; let alpha = -MATE - 1;
    const scored = [];
    for (const m of root) {
      chess.move(m);
      let v = -search(depth - 1, -MATE - 1, noise ? MATE + 1 : -alpha, 1);
      chess.undo();
      if (timeUp) break;
      if (noise) v += (Math.random() - 0.5) * 2 * noise;
      scored.push([v, m]);
      if (v > alpha) { alpha = v; iterBest = m; }
    }
    if (timeUp && depth > 1) break; // niepełna iteracja – zostaje wynik poprzedniej
    if (iterBest) best = iterBest;
    if (alpha >= MATE - 100) break; // znaleziony mat
    root = [best, ...root.filter((m) => m !== best)];
    if (timeUp) break;
  }
  return { from: best.from, to: best.to, promotion: best.promotion, nodes };
}
