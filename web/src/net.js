// Połączenie z drugim telefonem przez Google Nearby Connections (most window.NearbyNative w Androidzie).
// W przeglądarce z ?mocknet działa atrapa na BroadcastChannel (dwie karty = dwa telefony) do testów.

const listeners = new Set();
const emit = (ev) => listeners.forEach((fn) => { try { fn(ev); } catch (e) { console.error(e); } });

window.onNearby = (ev) => {
  if (ev.type === 'message') {
    let data;
    try { data = JSON.parse(ev.data); } catch { return; }
    emit({ type: 'message', data });
  } else emit(ev);
};

function nativeBackend() {
  const N = window.NearbyNative;
  return {
    status: () => { try { return JSON.parse(N.status()); } catch { return { gms: false }; } },
    host: (name) => N.host(name),
    join: (name) => N.join(name),
    connect: (id, myName) => N.connect(id, myName),
    send: (obj) => N.send(JSON.stringify(obj)),
    stopSearch: () => N.stopSearch(),
    stop: () => N.stop(),
    openSettings: () => N.openSettings && N.openSettings(),
  };
}

function mockBackend() {
  const ch = new BroadcastChannel('szachy-mocknet');
  const me = Math.random().toString(36).slice(2, 8);
  const ev = (o) => setTimeout(() => window.onNearby(o), 30);
  let mode = null; let advName = ''; let peer = null; let advTimer = null;
  const post = (o) => ch.postMessage({ ...o, from: me });
  ch.onmessage = ({ data: m }) => {
    if (m.to && m.to !== me) return;
    if (m.k === 'adv' && mode === 'join' && !peer) ev({ type: 'found', id: m.from, name: m.name });
    if (m.k === 'req' && mode === 'host' && !peer) {
      peer = m.from; mode = null; clearInterval(advTimer);
      ev({ type: 'connecting', id: m.from, name: m.name });
      post({ k: 'acc', to: m.from });
      ev({ type: 'connected', id: m.from });
    }
    if (m.k === 'acc' && !peer) { peer = m.from; mode = null; ev({ type: 'connected', id: m.from }); }
    if (m.k === 'msg' && m.from === peer) ev({ type: 'message', data: m.data });
    if (m.k === 'bye' && m.from === peer) { peer = null; ev({ type: 'disconnected', id: m.from }); }
    if (m.k === 'whohosts' && mode === 'host') post({ k: 'adv', name: advName });
  };
  // test: zerwanie połączenia po obu stronach
  window.__mockDrop = () => { if (peer) { post({ k: 'bye', to: peer }); const p = peer; peer = null; ev({ type: 'disconnected', id: p }); } };
  return {
    status: () => ({ gms: true, connected: !!peer }),
    host: (name) => {
      mode = 'host'; advName = name; clearInterval(advTimer);
      advTimer = setInterval(() => post({ k: 'adv', name }), 500);
      ev({ type: 'hosting' });
    },
    join: () => { mode = 'join'; post({ k: 'whohosts' }); ev({ type: 'discovering' }); },
    connect: (id, myName) => post({ k: 'req', to: id, name: myName }),
    send: (obj) => peer && post({ k: 'msg', to: peer, data: JSON.stringify(obj) }),
    stopSearch: () => { mode = null; clearInterval(advTimer); },
    stop: () => { mode = null; clearInterval(advTimer); if (peer) post({ k: 'bye', to: peer }); peer = null; },
    openSettings: () => {},
  };
}

const backend = window.NearbyNative ? nativeBackend()
  : (/[?&]mocknet/.test(location.search) && window.BroadcastChannel ? mockBackend() : null);

export const net = {
  available: () => !!backend,
  on: (fn) => listeners.add(fn),
  status: () => (backend ? backend.status() : { gms: false }),
  host: (name) => backend && backend.host(name),
  join: (name) => backend && backend.join(name),
  connect: (id, myName) => backend && backend.connect(id, myName),
  send: (obj) => backend && backend.send(obj),
  stopSearch: () => backend && backend.stopSearch(),
  stop: () => backend && backend.stop(),
  openSettings: () => backend && backend.openSettings(),
};
