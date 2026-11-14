import { Chess } from 'chess.js';
import { net } from './net.js';
import { bestMove } from './ai.js';
import workerSrc from '../../build/ai-worker.txt';

const $ = (id) => document.getElementById(id);
const FILES = 'abcdefgh';
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const COLOR_NAME = { w: 'białe', b: 'czarne' };
const LEVELS = ['Łatwy', 'Średni', 'Trudny'];

const pieceHtml = (color, type) => `<span class="pc ${color}">${GLYPH[type]}︎</span>`;
const other = (c) => (c === 'w' ? 'b' : 'w');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let G = null; // stan partii

// ======================= UI: ekrany, okna, komunikaty =======================

function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === screen));
}

function toast(text, ms = 1400) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), ms);
}

function modal(html, actions) {
  modal.kind = null;
  const card = $('modal-card');
  card.innerHTML = html + '<div class="btns"></div>';
  const box = card.querySelector('.btns');
  for (const [label, fn, cls] of actions) {
    const b = document.createElement('button');
    b.className = cls || 'big';
    b.textContent = label;
    b.onclick = () => { closeModal(); fn && fn(); };
    box.appendChild(b);
  }
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); modal.kind = null; }
const modalOpen = () => !$('modal').classList.contains('hidden');

const RULES_HTML = `
<h2>Zasady gry</h2>
<p>Zaczynają białe, gracze ruszają się na zmianę. Dotknij swojej figury – kropki pokażą dozwolone pola – i dotknij pola docelowego.</p>
<ul>
<li><b>Szach</b>: król jest atakowany (pole podświetla się na czerwono). Trzeba się obronić.</li>
<li><b>Mat</b>: szach, przed którym nie ma obrony – koniec partii.</li>
<li><b>Pat</b>: brak dozwolonego ruchu bez szacha – remis.</li>
<li><b>Roszada</b>: dotknij króla i pola dwa w bok (król i wieża nie mogły się ruszać, król nie może przechodzić przez atakowane pole).</li>
<li><b>Bicie w przelocie</b> i <b>promocja piona</b> (wybierasz figurę) działają automatycznie.</li>
<li>Remis także przy trzykrotnym powtórzeniu pozycji, po 50 ruchach bez bicia i ruchu pionem oraz przy braku materiału do mata.</li>
</ul>
<p class="muted">W grze z komputerem i na jednym telefonie można cofać ruchy. Na dwóch telefonach można zaproponować remis albo się poddać.</p>`;

// ======================= nowa partia =======================

function cleanName(s) { return (s || '').replace(/[|<>]/g, '').trim().slice(0, 12); }
const myName = () => cleanName($('name1').value) || 'Gracz';

function beginGame(opts) {
  closeModal();
  G = {
    mode: 'local', // 'local' | 'cpu' | 'net'
    me: null,      // kolor gracza w trybie cpu/net
    flip: false,
    level: 2,
    ...opts,
    chess: new Chess(),
    moves: [],      // historia w notacji UCI (e2e4, e7e8q)
    sel: null,
    dests: [],
    caps: [],
    result: null,
    token: (G ? G.token : 0) + 1,
    thinking: false,
  };
  show('game');
  render();
  maybeCpu();
}

function newLocal() {
  const w = cleanName($('name1').value) || 'Gracz 1';
  const b = cleanName($('name2').value) || 'Gracz 2';
  beginGame({ mode: 'local', names: { w, b } });
}

function cpuMenu() {
  const st = { color: cpuMenu.color || 'w', level: cpuMenu.level || 2 };
  const draw = () => {
    modal(`<h2>🤖 Gra z komputerem</h2>
      <div class="opt-label">Grasz kolorem</div>
      <div class="seg" id="seg-color">
        <button data-v="w">Białe</button><button data-v="b">Czarne</button><button data-v="r">Losowo</button></div>
      <div class="opt-label">Poziom</div>
      <div class="seg" id="seg-level">${LEVELS.map((l, i) => `<button data-v="${i + 1}">${l}</button>`).join('')}</div>`, [
      ['Graj', () => {
        cpuMenu.color = st.color; cpuMenu.level = st.level;
        const me = st.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : st.color;
        const you = myName() === 'Gracz 1' ? 'Ty' : myName();
        const cpu = `Komputer (${LEVELS[st.level - 1].toLowerCase()})`;
        beginGame({ mode: 'cpu', me, level: st.level, names: me === 'w' ? { w: you, b: cpu } : { w: cpu, b: you } });
      }],
      ['Anuluj', null, 'ghost'],
    ]);
    for (const [id, key] of [['seg-color', 'color'], ['seg-level', 'level']]) {
      for (const b of $(id).children) {
        const v = key === 'level' ? Number(b.dataset.v) : b.dataset.v;
        b.classList.toggle('on', st[key] === v);
        b.onclick = () => { st[key] = v; draw(); };
      }
    }
  };
  draw();
}

// ======================= logika ruchów =======================

const bottomColor = () => (G.mode === 'local' ? (G.flip ? 'b' : 'w') : G.me);
const isMyTurn = () => G.mode === 'local' || G.chess.turn() === G.me;
const canMove = () => G && !G.result && !G.paused && !G.thinking && isMyTurn();

function onSquare(sq) {
  if (!canMove()) {
    if (G && !G.result && !G.thinking && !G.paused && !isMyTurn()) toast('Ruch przeciwnika');
    return;
  }
  const piece = G.chess.get(sq);
  if (G.sel && G.dests.includes(sq)) { tryMove(G.sel, sq); return; }
  if (piece && piece.color === G.chess.turn() && G.sel !== sq) {
    G.sel = sq;
    const ms = G.chess.moves({ square: sq, verbose: true });
    G.dests = ms.map((m) => m.to);
    G.caps = ms.filter((m) => m.captured).map((m) => m.to);
  } else {
    G.sel = null; G.dests = []; G.caps = [];
  }
  render();
}

function tryMove(from, to) {
  const piece = G.chess.get(from);
  const promo = piece.type === 'p' && (to[1] === '8' || to[1] === '1');
  if (!promo) { playMove({ from, to }); return; }
  const c = piece.color;
  modal(`<h2>Promocja piona</h2><p>Wybierz figurę:</p>
    <div class="promo">${['q', 'r', 'b', 'n'].map((t) => `<button data-t="${t}">${pieceHtml(c, t)}</button>`).join('')}</div>`,
  [['Anuluj', () => { G.sel = null; G.dests = []; G.caps = []; render(); }, 'ghost']]);
  for (const b of $('modal-card').querySelectorAll('.promo button')) {
    b.onclick = () => { closeModal(); playMove({ from, to, promotion: b.dataset.t }); };
  }
}

const toUci = (m) => m.from + m.to + (m.promotion || '');
const fromUci = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });

/** Wykonuje ruch lokalnego gracza. */
function playMove(mv) {
  let m;
  try { m = G.chess.move(mv); } catch { m = null; }
  if (!m) return;
  const n = G.moves.length;
  G.moves.push(toUci(m));
  if (G.mode === 'net') net.send({ t: 'move', uci: toUci(m), n });
  afterMove(m);
}

function afterMove(m) {
  G.sel = null; G.dests = []; G.caps = [];
  G.lastSan = m.san;
  if (navigator.vibrate) try { navigator.vibrate(m.captured ? 25 : 12); } catch { /* brak */ }
  checkEnd();
  render(m);
  if (G.result) setTimeout(endDialog, 650); else maybeCpu();
}

function checkEnd() {
  const c = G.chess;
  if (G.result) return;
  if (c.isCheckmate()) G.result = { kind: 'mate', winner: other(c.turn()) };
  else if (c.isStalemate()) G.result = { kind: 'stalemate', winner: null };
  else if (c.isInsufficientMaterial()) G.result = { kind: 'insufficient', winner: null };
  else if (c.isThreefoldRepetition()) G.result = { kind: 'threefold', winner: null };
  else if (c.isDrawByFiftyMoves()) G.result = { kind: 'fifty', winner: null };
}

function resultText(r) {
  const nm = (c) => G.names[c];
  switch (r.kind) {
    case 'mate': return [`Mat! Wygrywa ${nm(r.winner)}`, `${nm(r.winner)} (${COLOR_NAME[r.winner]}) daje mata`];
    case 'resign': return [`Wygrywa ${nm(r.winner)}`, `${nm(other(r.winner))} poddaje partię`];
    case 'left': return [`Wygrywa ${nm(r.winner)}`, `${nm(other(r.winner))} opuszcza grę`];
    case 'stalemate': return ['Remis', 'Pat – brak dozwolonego ruchu'];
    case 'insufficient': return ['Remis', 'Za mało materiału do mata'];
    case 'threefold': return ['Remis', 'Trzykrotne powtórzenie pozycji'];
    case 'fifty': return ['Remis', '50 ruchów bez bicia i ruchu pionem'];
    case 'agreed': return ['Remis', 'Remis za zgodą'];
    default: return ['Koniec partii', ''];
  }
}

function endDialog() {
  if (!G || !G.result) return;
  const r = G.result;
  const [title, sub] = resultText(r);
  let head = title;
  if (G.mode !== 'local' && r.winner) head = r.winner === G.me ? 'Wygrałeś!' : (G.mode === 'cpu' ? 'Komputer wygrywa' : title);
  const icon = r.winner ? (G.mode !== 'local' && r.winner !== G.me ? '😔' : '🏆') : '🤝';
  const html = `<div class="trophy">${icon}</div><h2 style="text-align:center">${esc(head)}</h2>
    <p style="text-align:center">${esc(sub)}</p>`;
  modal.kind = 'end';
  if (G.mode === 'net') {
    modal(html, [['Rewanż', askRematch], ['Zobacz planszę', null, 'ghost'], ['Menu', leaveNetGame, 'ghost']]);
  } else {
    const opts = G.mode === 'cpu'
      ? { mode: 'cpu', me: other(G.me), level: G.level, names: { w: G.names.b, b: G.names.w } }
      : { mode: 'local', names: { w: G.names.b, b: G.names.w }, flip: G.flip };
    modal(html, [['Rewanż (zamiana kolorów)', () => beginGame(opts)], ['Zobacz planszę', null, 'ghost'],
      ['Menu', () => { G = null; show('menu'); }, 'ghost']]);
  }
  modal.kind = 'end';
}

function undo() {
  if (!G || G.mode === 'net' || !G.moves.length) return;
  G.token++;
  G.thinking = false;
  let k = 1;
  if (G.mode === 'cpu') {
    // cofamy do najbliższej pozycji, w której ruch ma gracz
    k = G.chess.turn() === G.me ? 2 : 1;
    if (k > G.moves.length) k = G.moves.length;
    if (G.moves.length - k === 0 && G.me === 'b') k = G.moves.length - 1; // komputer zaczyna białymi
    if (k <= 0) return;
  }
  for (let i = 0; i < k; i++) { G.chess.undo(); G.moves.pop(); }
  G.result = null; G.sel = null; G.dests = []; G.caps = [];
  render();
  maybeCpu();
}

// ======================= komputer =======================

let worker = null;
let workerReqs = new Map();
let workerId = 0;
function getWorker() {
  if (worker !== null) return worker;
  try {
    const url = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = (e) => { const fn = workerReqs.get(e.data.id); workerReqs.delete(e.data.id); fn && fn(e.data.move); };
    worker.onerror = () => { worker = false; for (const fn of workerReqs.values()) fn(undefined); workerReqs.clear(); };
  } catch { worker = false; }
  return worker;
}

function think(fen, level) {
  return new Promise((resolve) => {
    const w = getWorker();
    const local = () => setTimeout(() => resolve(bestMove(fen, level)), 30);
    if (!w) { local(); return; }
    const id = ++workerId;
    workerReqs.set(id, (mv) => (mv === undefined ? local() : resolve(mv)));
    w.postMessage({ id, fen, level });
  });
}

async function maybeCpu() {
  if (!G || G.mode !== 'cpu' || G.result || G.chess.turn() === G.me) return;
  const token = G.token;
  G.thinking = true;
  render();
  const started = Date.now();
  const mv = await think(G.chess.fen(), G.level);
  const wait = 450 - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (!G || G.token !== token) return;
  G.thinking = false;
  if (!mv) { render(); return; }
  const m = G.chess.move(mv);
  G.moves.push(toUci(m));
  afterMove(m);
}

// ======================= rysowanie =======================

function captured() {
  // figury zbite: różnica względem kompletu startowego
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const have = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  let mat = 0;
  for (const row of G.chess.board()) {
    for (const sq of row) {
      if (!sq || sq.type === 'k') continue;
      have[sq.color][sq.type]++;
      mat += (sq.color === 'w' ? 1 : -1) * VAL[sq.type];
    }
  }
  const lost = (c) => ['q', 'r', 'b', 'n', 'p'].flatMap((t) => Array(Math.max(0, start[t] - have[c][t])).fill(t));
  return { lostW: lost('w'), lostB: lost('b'), mat };
}

function barHtml(color, cap) {
  // przy graczu pokazujemy figury, które zbił (czyli straty przeciwnika)
  const takes = color === 'w' ? cap.lostB : cap.lostW;
  const adv = color === 'w' ? cap.mat : -cap.mat;
  const thinking = G.thinking && G.chess.turn() === color;
  return `<span class="dot ${color}"></span><span class="nm${thinking ? ' thinking' : ''}">${esc(G.names[color])}</span>
    <span class="caps">${takes.map((t) => pieceHtml(other(color), t)).join('')}${adv > 0 ? `<span class="adv">+${adv}</span>` : ''}</span>`;
}

function render(lastMove) {
  if (!G) return;
  const c = G.chess;
  const bottom = bottomColor();
  const hist = c.history({ verbose: true });
  const last = lastMove || hist[hist.length - 1];
  const turn = c.turn();
  let kingSq = null;
  if (c.inCheck()) {
    for (const row of c.board()) for (const sq of row) if (sq && sq.type === 'k' && sq.color === turn) kingSq = sq.square;
  }

  // plansza
  let html = '';
  for (let vr = 0; vr < 8; vr++) {
    for (let vf = 0; vf < 8; vf++) {
      const rank = bottom === 'w' ? 8 - vr : vr + 1;
      const file = bottom === 'w' ? vf : 7 - vf;
      const sq = FILES[file] + rank;
      const light = (file + rank) % 2 === 1;
      const p = c.get(sq);
      const cls = ['sq', light ? 'l' : 'd'];
      if (last && (last.from === sq || last.to === sq)) cls.push('last');
      if (G.sel === sq) cls.push('sel');
      if (G.dests.includes(sq)) cls.push('dest');
      if (G.caps.includes(sq)) cls.push('cap');
      if (kingSq === sq) cls.push('check');
      let inner = p ? pieceHtml(p.color, p.type) : '';
      if (vf === 0) inner += `<span class="crd r">${rank}</span>`;
      if (vr === 7) inner += `<span class="crd f">${FILES[file]}</span>`;
      html += `<div class="${cls.join(' ')}" data-sq="${sq}">${inner}</div>`;
    }
  }
  $('board').innerHTML = html;
  if (lastMove) animate(lastMove, bottom);

  // paski graczy
  const cap = captured();
  const top = other(bottom);
  $('bar-top').innerHTML = barHtml(top, cap);
  $('bar-bottom').innerHTML = barHtml(bottom, cap);
  $('bar-top').classList.toggle('on', !G.result && turn === top);
  $('bar-bottom').classList.toggle('on', !G.result && turn === bottom);

  // status
  const main = $('status-main');
  let sub = '';
  main.classList.remove('alert');
  if (G.result) {
    const [t, s] = resultText(G.result);
    main.textContent = t; sub = s;
  } else if (G.paused) {
    main.textContent = 'Połączenie zerwane'; sub = 'Czekam na drugi telefon…';
  } else {
    const who = G.mode === 'local' ? G.names[turn] : (turn === G.me ? 'Twój ruch' : `Ruch: ${G.names[turn]}`);
    main.textContent = G.mode === 'local' ? `Ruch: ${who}` : who;
    if (c.inCheck()) { main.textContent += ' – szach!'; main.classList.add('alert'); }
    sub = `${COLOR_NAME[turn]} · ruch ${c.moveNumber()}${G.mode === 'cpu' ? ` · ${LEVELS[G.level - 1].toLowerCase()}` : ''}`;
  }
  $('status-sub').textContent = sub;

  // zapis partii
  let mv = '';
  hist.forEach((m, i) => {
    if (i % 2 === 0) mv += `<b>${i / 2 + 1}.</b>`;
    mv += `<span class="${i === hist.length - 1 ? 'cur' : ''}">${esc(m.san)}</span>`;
  });
  const box = $('moves');
  box.innerHTML = mv || '<span>Zaczynają białe</span>';
  box.scrollLeft = box.scrollWidth;

  // przyciski
  const a = $('actions');
  if (G.mode === 'net') {
    a.innerHTML = G.result
      ? '<button id="act-rematch" class="hot">Rewanż</button><button id="act-menu">Menu</button>'
      : '<button id="act-draw">½ Remis</button><button id="act-resign">🏳 Poddaj</button>';
  } else {
    a.innerHTML = `<button id="act-undo" ${G.moves.length ? '' : 'disabled'}>↶ Cofnij</button>
      ${G.mode === 'local' ? '<button id="act-flip">⇅ Obróć</button>' : ''}
      ${G.result ? '<button id="act-again" class="hot">Nowa partia</button>' : '<button id="act-resign">🏳 Poddaj</button>'}`;
  }
  const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  on('act-undo', undo);
  on('act-flip', () => { G.flip = !G.flip; render(); });
  on('act-resign', askResign);
  on('act-draw', offerDraw);
  on('act-again', endDialog);
  on('act-rematch', askRematch);
  on('act-menu', leaveNetGame);
}

function animate(m, bottom) {
  const el = $('board').querySelector(`[data-sq="${m.to}"] .pc`);
  if (!el) return;
  const dx = (FILES.indexOf(m.from[0]) - FILES.indexOf(m.to[0])) * (bottom === 'w' ? 1 : -1);
  const dy = (Number(m.to[1]) - Number(m.from[1])) * (bottom === 'w' ? 1 : -1);
  const size = $('board').clientWidth / 8;
  el.style.transform = `translate(${dx * size}px, ${dy * size}px)`;
  el.style.zIndex = 3;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.add('anim');
    el.style.transform = '';
  }));
}

$('board').addEventListener('click', (e) => {
  const sq = e.target.closest('[data-sq]');
  if (sq && G) onSquare(sq.dataset.sq);
});

// ======================= poddanie, wyjście =======================

function askResign() {
  if (!G || G.result) return;
  const loser = G.mode === 'local' ? G.chess.turn() : G.me;
  modal(`<h2>Poddać partię?</h2><p>${G.mode === 'local' ? `Poddaje: <b>${esc(G.names[loser])}</b> (${COLOR_NAME[loser]}).` : 'Przeciwnik wygra tę partię.'}</p>`, [
    ['Poddaję się', () => {
      G.token++; G.thinking = false;
      G.result = { kind: 'resign', winner: other(loser) };
      if (G.mode === 'net') net.send({ t: 'resign', n: G.moves.length });
      render(); endDialog();
    }],
    ['Graj dalej', null, 'ghost'],
  ]);
}

function askQuit() {
  if (!G) return;
  if (G.result && G.mode !== 'net') { G.token++; G = null; show('menu'); return; }
  modal(`<h2>Wyjść z partii?</h2><p>${G.mode === 'net' ? 'Przeciwnik zostanie powiadomiony, a partia się zakończy.' : 'Bieżąca partia zostanie utracona.'}</p>`, [
    ['Wróć do gry', null],
    ['Wyjdź do menu', () => { if (G.mode === 'net') return leaveNetGame(); G.token++; G = null; show('menu'); }, 'ghost'],
  ]);
}

$('btn-quit').onclick = askQuit;
$('btn-more').onclick = () => {
  if (!G) return;
  const pgn = G.chess.pgn({ maxWidth: 40 }) || '(brak ruchów)';
  modal(`<h2>Zapis partii</h2><p style="font-family:monospace;font-size:13px;white-space:pre-wrap;user-select:text">${esc(pgn)}</p>`, [
    ['Zasady gry', () => modal(RULES_HTML, [['OK', null]])],
    ['Zamknij', null, 'ghost'],
  ]);
};
$('btn-pvp').onclick = newLocal;
$('btn-cpu').onclick = cpuMenu;
$('btn-rules').onclick = () => modal(RULES_HTML, [['OK', null]]);

// przycisk „wstecz” w Androidzie; true = obsłużone
window.handleBack = () => {
  if (modalOpen()) {
    if (lobby || (G && G.paused) || modal.kind === 'draw') return true; // te okna zamyka się przyciskiem
    closeModal(); return true;
  }
  if (G) { askQuit(); return true; }
  return false;
};

// ======================= GRA NA DWÓCH TELEFONACH (Nearby) =======================

const SEP = '|';
let lobby = null;        // { role: 'host'|'join', name, found: Map, connecting }
let rejoinTimer = null;
const myPid = Math.random().toString(36).slice(2, 10);
const shownName = (adv) => adv.split(SEP)[0];

function netError(text) {
  modal(`<h2>Gra na dwóch telefonach</h2><p>${text}</p>`, [['OK', null]]);
}

function openNetMenu() {
  if (!net.available()) return netError('Ta opcja działa tylko w aplikacji na Androidzie.');
  if (!net.status().gms) return netError('Ten telefon nie ma Usług Google Play, które są potrzebne do gry na dwóch telefonach.');
  modal(`<h2>📡 Gra na dwóch telefonach</h2>
    <p>Na obu telefonach włącz <b>Bluetooth</b> i <b>Wi-Fi</b> (internet nie jest potrzebny).
    Jeden telefon zakłada grę (gra białymi), drugi do niej dołącza.</p>
    <p class="muted">Grasz jako: <b>${esc(myName())}</b> (imię zmienisz w menu, pierwsze pole).</p>`, [
    ['Załóż grę', startHosting],
    ['Dołącz do gry', startJoining],
    ['Anuluj', null, 'ghost'],
  ]);
}

function lobbyView() {
  if (!lobby) return;
  const cancel = ['Anuluj', cancelLobby, 'ghost'];
  if (lobby.connecting) {
    modal(`<h2>Łączenie…</h2><p>Łączę z: <b>${esc(lobby.connecting)}</b></p><div class="spinner"></div>`, [cancel]);
  } else if (lobby.role === 'host') {
    modal(`<h2>Czekam na drugiego gracza</h2>
      <p>Twoja gra: <b>${esc(lobby.name)}</b></p>
      <p>Na drugim telefonie wybierz <b>📡 Gra na dwóch telefonach → Dołącz do gry</b>.</p>
      <div class="spinner"></div>`, [cancel]);
  } else {
    const items = [...lobby.found.entries()];
    modal(`<h2>Gry w pobliżu</h2>
      ${items.length ? '<p>Dotknij gry, żeby dołączyć:</p>' : '<p>Szukam… Upewnij się, że drugi telefon założył grę.</p><div class="spinner"></div>'}
      <div class="found-list"></div>`, [cancel]);
    const box = $('modal-card').querySelector('.found-list');
    for (const [id, adv] of items) {
      const b = document.createElement('button');
      b.className = 'big found';
      b.textContent = `♞ ${shownName(adv)}`;
      b.onclick = () => {
        lobby.connecting = shownName(adv);
        lobbyView();
        net.connect(id, myName() + SEP + myPid);
      };
      box.appendChild(b);
    }
  }
}

function startHosting() {
  lobby = { role: 'host', name: myName(), found: new Map() };
  lobby.adv = lobby.name + SEP + myPid;
  lobbyView();
  net.host(lobby.adv);
}

function startJoining() {
  lobby = { role: 'join', name: myName(), found: new Map() };
  lobbyView();
  net.join(myName() + SEP + myPid);
}

function cancelLobby() {
  lobby = null;
  net.stop();
  closeModal();
}

/** names: { w, b }, hostColor: kolor gospodarza, host: czy ja jestem gospodarzem */
function beginNetGame(names, hostColor, host, peerPid) {
  lobby = null;
  beginGame({ mode: 'net', names, hostColor, host, peerPid, me: host ? hostColor : other(hostColor) });
}

const inNet = () => G && G.mode === 'net';

net.on((ev) => {
  switch (ev.type) {
    case 'found':
      if (inNet() && G.paused && !G.host) {
        // ponowne łączenie: szukamy tego samego gospodarza
        if (ev.name.split(SEP)[1] === G.peerPid && !G.reconnecting) {
          G.reconnecting = true;
          net.connect(ev.id, G.names[G.me] + SEP + myPid);
        }
        return;
      }
      if (lobby && lobby.role === 'join') { lobby.found.set(ev.id, ev.name); if (!lobby.connecting) lobbyView(); }
      break;
    case 'lost':
      if (lobby && lobby.found.delete(ev.id) && !lobby.connecting) lobbyView();
      break;
    case 'connecting':
      if (lobby && lobby.role === 'host' && !lobby.connecting) { lobby.connecting = shownName(ev.name); lobbyView(); }
      break;
    case 'connected':
      net.send({ t: 'hello', v: 1, name: inNet() ? G.names[G.me] : myName(), pid: myPid, inGame: !!inNet() });
      break;
    case 'connect-failed':
      if (inNet() && G.paused) { G.reconnecting = false; scheduleRejoin(); return; }
      if (lobby) {
        lobby.connecting = null;
        lobbyView();
        toast('Nie udało się połączyć. Spróbuj ponownie.', 2200);
        if (lobby.role === 'host') net.host(lobby.adv);
      }
      break;
    case 'disconnected':
      onDisconnected();
      break;
    case 'permission-denied':
      lobby = null;
      modal(`<h2>Brak uprawnień</h2><p>Bez zgody na <b>urządzenia w pobliżu</b> (Bluetooth / Wi-Fi${
        ev.permanent ? '' : ', a na starszych Androidach lokalizację'}) gra na dwóch telefonach nie zadziała.</p>`,
      ev.permanent
        ? [['Otwórz ustawienia', () => net.openSettings()], ['Anuluj', null, 'ghost']]
        : [['Spróbuj jeszcze raz', openNetMenu], ['Anuluj', null, 'ghost']]);
      break;
    case 'error':
      if (ev.where === 'send') return;
      if (inNet() && G.paused) { G.reconnecting = false; scheduleRejoin(); return; }
      lobby = null;
      net.stop();
      netError(`Nie udało się ${ev.where === 'advertise' ? 'założyć gry' : ev.where === 'discover' ? 'wyszukać gier' : 'połączyć'}.
        Sprawdź, czy Bluetooth, Wi-Fi i lokalizacja są włączone.<br><small class="muted">(${esc(String(ev.message))})</small>`);
      break;
    case 'message':
      onNetMessage(ev.data);
      break;
    default:
  }
});

function onNetMessage(m) {
  if (m.t === 'hello') {
    if (inNet()) {
      if (m.pid !== G.peerPid) { net.stop(); scheduleRejoin(); return; } // ktoś obcy – czekamy na naszego gracza
      reconnected();
      return;
    }
    if (lobby && lobby.role === 'host') {
      const names = { w: lobby.name, b: cleanName(m.name) || 'Gość' };
      net.send({ t: 'start', names, hostColor: 'w', pid: myPid });
      beginNetGame(names, 'w', true, m.pid);
    }
    return;
  }
  if (m.t === 'start') {
    if (inNet() && !G.result) return;
    beginNetGame(m.names, m.hostColor, false, m.pid);
    return;
  }
  if (!inNet()) return;
  switch (m.t) {
    case 'move': {
      if (m.n < G.moves.length) return;            // już mamy ten ruch
      if (m.n > G.moves.length || G.result) { net.send({ t: 'need' }); return; } // brakuje nam ruchów
      if (G.chess.turn() === G.me) { net.send({ t: 'need' }); return; }
      let mv = null;
      try { mv = G.chess.move(fromUci(m.uci)); } catch { mv = null; }
      if (!mv) { net.send({ t: 'need' }); return; }
      G.moves.push(m.uci);
      if (modal.kind === 'draw-wait') closeModal();
      afterMove(mv);
      break;
    }
    case 'need':
      sendSync();
      break;
    case 'sync':
      adoptSync(m);
      break;
    case 'resign':
      if (G.result) return;
      G.result = { kind: 'resign', winner: G.me };
      render(); endDialog();
      break;
    case 'draw':
      if (G.result) return;
      modal.kind = 'draw';
      modal(`<h2>Propozycja remisu</h2><p><b>${esc(G.names[other(G.me)])}</b> proponuje remis.</p>`, [
        ['Przyjmij remis', () => {
          if (!G || G.result) return;
          G.result = { kind: 'agreed', winner: null };
          net.send({ t: 'draw-yes', n: G.moves.length });
          render(); endDialog();
        }],
        ['Graj dalej', () => net.send({ t: 'draw-no' }), 'ghost'],
      ]);
      modal.kind = 'draw';
      break;
    case 'draw-yes':
      if (G.result) return;
      G.result = { kind: 'agreed', winner: null };
      render(); endDialog();
      break;
    case 'draw-no':
      if (modal.kind === 'draw-wait') closeModal();
      toast('Przeciwnik gra dalej', 2000);
      break;
    case 'bye':
      G.token++;
      G.left = true;
      net.stop();
      if (!G.result) G.result = { kind: 'left', winner: G.me };
      render();
      modal(`<h2>Koniec gry</h2><p><b>${esc(G.names[other(G.me)])}</b> opuścił grę.</p>`, [
        ['Zobacz planszę', null, 'ghost'], ['Menu', () => { G = null; show('menu'); }]]);
      break;
    case 'rematch':
      G.peerRematch = true;
      if (!G.wantRematch) toast('Przeciwnik chce rewanżu', 2500);
      tryRematch();
      break;
    default:
  }
}

function offerDraw() {
  if (!inNet() || G.result || G.paused) return;
  net.send({ t: 'draw' });
  modal(`<h2>Remis?</h2><p>Zaproponowano remis. Czekam na odpowiedź przeciwnika…</p><div class="spinner"></div>`,
    [['Graj dalej', null, 'ghost']]);
  modal.kind = 'draw-wait';
}

function sendSync() {
  if (inNet()) net.send({ t: 'sync', moves: G.moves, result: G.result });
}

/** Przyjmuje stan drugiego telefonu, jeśli ma więcej ruchów (np. po zerwanym połączeniu). */
function adoptSync(m) {
  const theirs = m.moves || [];
  const mine = G.moves;
  const prefix = mine.every((u, i) => theirs[i] === u);
  if (theirs.length > mine.length && prefix) {
    const c = new Chess();
    try { theirs.forEach((u) => c.move(fromUci(u))); } catch { return; }
    G.token++;
    G.chess = c;
    G.moves = [...theirs];
    G.sel = null; G.dests = []; G.caps = [];
    checkEnd();
  } else if (theirs.length < mine.length && theirs.every((u, i) => mine[i] === u)) {
    sendSync(); // to my jesteśmy dalej – wyślij swoją wersję
  }
  if (m.result && !G.result && theirs.length >= mine.length) {
    G.result = m.result;
  }
  render();
  if (G.result && modal.kind !== 'end') endDialog();
}

// --- zerwane połączenie ---
function onDisconnected() {
  if (lobby) {
    lobby.connecting = null;
    lobbyView();
    if (lobby.role === 'host') net.host(lobby.adv);
    return;
  }
  if (!inNet() || G.left) return;
  if (G.result) { toast('Połączenie zerwane', 2500); G.lost = true; return; }
  G.paused = true;
  G.reconnecting = false;
  G.sel = null; G.dests = []; G.caps = [];
  render();
  modal(`<h2>Połączenie zerwane</h2>
    <p>Straciłem kontakt z telefonem: <b>${esc(G.names[other(G.me)])}</b>. Próbuję połączyć ponownie…</p>
    <p class="muted">Telefony powinny być blisko siebie, z włączonym Bluetooth i Wi-Fi. Partia jest zapamiętana.</p>
    <div class="spinner"></div>`, [['Zakończ grę', leaveNetGame, 'ghost']]);
  rejoin();
}

function rejoin() {
  clearTimeout(rejoinTimer);
  if (!inNet() || !G.paused) return;
  if (G.host) net.host(G.names[G.me] + SEP + myPid);
  else net.join(G.names[G.me] + SEP + myPid);
}

function scheduleRejoin() {
  clearTimeout(rejoinTimer);
  rejoinTimer = setTimeout(() => { net.stopSearch(); rejoin(); }, 2500);
}

function reconnected() {
  clearTimeout(rejoinTimer);
  if (!G) return;
  G.paused = false;
  G.reconnecting = false;
  G.lost = false;
  closeModal();
  toast('Połączono ponownie', 1800);
  render();
  sendSync();
}

// --- wyjście i rewanż ---
function leaveNetGame() {
  clearTimeout(rejoinTimer);
  if (G) { G.token++; net.send({ t: 'bye' }); }
  setTimeout(() => net.stop(), 300); // daj czas na wysłanie „bye”
  G = null;
  closeModal();
  show('menu');
}

function askRematch() {
  if (!inNet()) return;
  if (G.left || G.lost) { toast('Przeciwnik jest rozłączony', 2200); return; }
  G.wantRematch = true;
  net.send({ t: 'rematch' });
  if (!G.peerRematch) {
    modal('<h2>Rewanż</h2><p>Czekam, aż przeciwnik też wybierze „Rewanż”…</p><div class="spinner"></div>',
      [['Zobacz planszę', null, 'ghost'], ['Menu', leaveNetGame, 'ghost']]);
  }
  tryRematch();
}

function tryRematch() {
  if (!inNet() || !G.wantRematch || !G.peerRematch || !G.host) return;
  const hostColor = other(G.hostColor); // kolory na zmianę
  const hostName = G.names[G.hostColor];
  const guestName = G.names[other(G.hostColor)];
  const names = hostColor === 'w' ? { w: hostName, b: guestName } : { w: guestName, b: hostName };
  net.send({ t: 'start', names, hostColor, pid: myPid });
  beginNetGame(names, hostColor, true, G.peerPid);
}

$('btn-net').onclick = openNetMenu;

// do testów w przeglądarce
window.__game = () => G;
