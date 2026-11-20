// The Lost Temple of Solara — multiplayer adventure escape room server
// Two ways to play:
//   • Private expedition: one team, 5-letter room code (friends at home)
//   • School event: a teacher hosts with a 6-digit PIN, students form teams,
//     the teacher starts everyone at once and watches a live leaderboard.

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 20000, pingTimeout: 25000 });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));
app.get('/health', (req, res) => res.send('ok'));
app.get('/qr.svg', async (req, res) => {
  try {
    const svg = await QRCode.toString(String(req.query.t || '').slice(0, 300), { type: 'svg', margin: 1, color: { dark: '#10201c', light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  } catch (e) { res.status(400).end(); }
});

// ---------------- Game rules (answers live on the server so nobody can peek) -------------
const MAX_TEAM = 6;
const MAX_TEAMS = 60;
const ANSWERS = { doorA: '3142', console: 'QUEST' };
const LOCK_NAMES = { doorA: 'the stone door', console: 'the Sun Door' };
const GEM_ORDER = ['red', 'blue', 'yellow', 'green'];
const HATS = ['explorer', 'cap', 'crown', 'beanie', 'bandana', 'none'];
const PLATES = { sun: { x: -2.5, z: -3 }, moon: { x: 2.5, z: -3 }, r: 0.95 };
const EXIT_Z = -15.8;

// Sunbeam puzzle (same numbers are used in public/game.js to draw the beam)
const BEAM = {
  source: { x: -5.7, z: 3 },
  target: { x: 5.4, z: 3 },
  mirrors: [{ x: -2, z: 3 }, { x: 2, z: 3 }, { x: -2, z: -1 }, { x: 2, z: -1 }]
};
function traceBeam(m) {
  let x = BEAM.source.x, z = BEAM.source.z, dx = 1, dz = 0, last = -1;
  for (let n = 0; n < 12; n++) {
    let best = -1, bestT = Infinity;
    BEAM.mirrors.forEach((p, i) => {
      if (i === last) return;
      const on = dx ? Math.abs(p.z - z) < 0.01 : Math.abs(p.x - x) < 0.01;
      const t = dx ? (p.x - x) * dx : (p.z - z) * dz;
      if (on && t > 0.01 && t < bestT) { bestT = t; best = i; }
    });
    const T = BEAM.target;
    const ton = dx ? Math.abs(T.z - z) < 0.01 : Math.abs(T.x - x) < 0.01;
    const tt = dx ? (T.x - x) * dx : (T.z - z) * dz;
    if (ton && tt > 0.01 && tt < bestT) return { hit: true };
    if (best < 0) return { hit: false };
    x = BEAM.mirrors[best].x; z = BEAM.mirrors[best].z; last = best;
    if (m[best] === 0) [dx, dz] = [dz, dx]; else [dx, dz] = [-dz, -dx];
  }
  return { hit: false };
}

// ---------------- school-friendly text filter ----------------
const BAD_LONG = ['fuck', 'shit', 'bitch', 'asshole', 'cunt', 'bastard', 'nigg', 'porn', 'penis', 'vagina', 'anjing', 'bangsat', 'kontol', 'memek', 'ngentot', 'goblok', 'tolol', 'bajingan', 'jancok', 'pepek', 'lonte', 'perek', 'kampret', 'idiot', 'stupid'];
const BAD_WORD = ['dick', 'sex', 'asu', 'tai', 'babi', 'bego', 'cok', 'fck', 'wtf', 'ass'];
function clean(text) {
  let t = String(text || '');
  for (const w of BAD_LONG) t = t.replace(new RegExp(w, 'gi'), m => '*'.repeat(m.length));
  for (const w of BAD_WORD) t = t.replace(new RegExp(`\\b${w}\\b`, 'gi'), m => '*'.repeat(m.length));
  return t;
}
function cleanName(n, fallback = 'Explorer') {
  const s = clean(String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16));
  return s.replace(/\*/g, '').trim() ? s : fallback;
}
function cleanAvatar(a) {
  a = a || {};
  return { color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : '#ff9f43', hat: HATS.includes(a.hat) ? a.hat : 'explorer' };
}

// ---------------- rooms (= one team each) and events ----------------
const rooms = new Map();   // code -> room
const events = new Map();  // pin  -> event

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = ''; for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)]; } while (rooms.has(code));
  return code;
}
function makePin() {
  let pin;
  do { pin = String(Math.floor(100000 + Math.random() * 900000)); } while (events.has(pin));
  return pin;
}
function freshState() {
  return {
    started: false, startTime: null, endTime: null,
    gemSeq: [], chestOpen: false, doorA: false,
    mirrors: [0, 1, 0, 1], beamSolved: false, doorB: false,
    consoleSolved: false, escaped: false, hints: 0
  };
}
const progressOf = s => [s.chestOpen, s.doorA, s.beamSolved, s.doorB, s.consoleSolved, s.escaped].filter(Boolean).length;
function spawnFor(index) { return { x: ((index % 3) - 1) * 1.1, z: 13.4 + Math.floor(index / 3) * 0.9 }; }

const dirtyEvents = new Set();
function emitState(room) {
  io.to(room.code).emit('state', { ...room.state, hostId: room.hostId, teamName: room.teamName || null, serverNow: Date.now() });
  if (room.event) dirtyEvents.add(room.event);
}
function emitLobby(room) {
  io.to(room.code).emit('lobby', {
    code: room.code, hostId: room.hostId, started: room.state.started, teamName: room.teamName || null,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, hat: p.hat }))
  });
  if (room.event) dirtyEvents.add(room.event);
}
function log(room, text, sfx) {
  io.to(room.code).emit('log', { text });
  if (sfx) io.to(room.code).emit('sfx', sfx);
}

function addPlayer(socket, room, name, avatar) {
  const sp = spawnFor(room.players.size);
  room.players.set(socket.id, { id: socket.id, name, ...avatar, x: sp.x, y: 0, z: sp.z, yaw: 0, pitch: 0 });
  socket.join(room.code);
  socket.data.code = room.code;
}
function getRoom(socket) {
  const room = rooms.get(socket.data.code);
  if (!room) return null;
  const player = room.players.get(socket.id);
  return player ? { room, player } : null;
}
// remove a socket from whatever team it is in
function leaveRoom(socket, quiet = false) {
  const room = rooms.get(socket.data.code);
  socket.data.code = null;
  if (!room) return;
  socket.leave(room.code);
  const p = room.players.get(socket.id);
  room.players.delete(socket.id);
  if (room.event) {
    const ev = events.get(room.event);
    // empty teams that never started disappear from the list; started teams keep their progress
    if (room.players.size === 0 && !room.state.started && ev) { ev.teams.delete(room.code); rooms.delete(room.code); }
    dirtyEvents.add(room.event);
  } else {
    if (room.players.size === 0) { rooms.delete(room.code); return; }
    if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
  }
  if (rooms.has(room.code)) {
    if (p && !quiet) log(room, `${p.name} left the expedition.`);
    emitLobby(room); emitState(room); checkEscape(room);
  }
}

function checkPlates(room) {
  const s = room.state;
  if (!s.started || !s.beamSolved || s.doorB) return;
  let onSun = 0, onMoon = 0;
  for (const p of room.players.values()) {
    if (Math.hypot(p.x - PLATES.sun.x, p.z - PLATES.sun.z) < PLATES.r) onSun++;
    if (Math.hypot(p.x - PLATES.moon.x, p.z - PLATES.moon.z) < PLATES.r) onMoon++;
  }
  if ((room.players.size === 1 && (onSun || onMoon)) || (onSun && onMoon)) {
    s.doorB = true;
    log(room, 'The twin stones glow together… the great gate rumbles open!', 'door');
    emitState(room);
  }
}
function checkEscape(room) {
  const s = room.state;
  if (!s.consoleSolved || s.escaped || room.players.size === 0) return;
  for (const p of room.players.values()) if (p.z > EXIT_Z) return;
  s.escaped = true;
  s.endTime = Date.now();
  let rank = null, total = null;
  const ev = room.event && events.get(room.event);
  if (ev) {
    ev.finishOrder.push(room.code);
    rank = ev.finishOrder.length; total = ev.teams.size;
    io.to('host:' + ev.pin).emit('teamFinished', { teamName: room.teamName, rank, time: s.endTime - s.startTime });
  }
  emitState(room);
  io.to(room.code).emit('escaped', {
    time: s.endTime - s.startTime, hints: s.hints, rank, total, teamName: room.teamName || null, event: !!ev,
    players: [...room.players.values()].map(p => p.name)
  });
}

// ---------------- event snapshots ----------------
function teamSummary(room, withIds = false) {
  return {
    id: room.code, name: room.teamName,
    players: [...room.players.values()].map(p => ({ ...(withIds ? { id: p.id } : {}), name: p.name, color: p.color, hat: p.hat })),
    progress: progressOf(room.state), hints: room.state.hints,
    time: room.state.escaped ? room.state.endTime - room.state.startTime : null
  };
}
function emitEvent(ev) {
  const teams = [...ev.teams.values()];
  const inTeams = teams.reduce((n, r) => n + r.players.size, 0);
  const waiting = (io.sockets.adapter.rooms.get('ev:' + ev.pin)?.size || 0) - inTeams;
  io.to('host:' + ev.pin).emit('hostState', {
    pin: ev.pin, started: ev.started, startTime: ev.startTime, locked: ev.locked, chatOff: ev.chatOff,
    serverNow: Date.now(), waiting: Math.max(0, waiting), players: inTeams,
    teams: teams.map(r => ({ ...teamSummary(r, true), rank: ev.finishOrder.indexOf(r.code) + 1 || null }))
  });
  io.to('ev:' + ev.pin).emit('eventLobby', {
    pin: ev.pin, started: ev.started, locked: ev.locked,
    teams: teams.map(r => ({ id: r.code, name: r.teamName, full: r.players.size >= MAX_TEAM, players: teamSummary(r).players }))
  });
}
setInterval(() => { for (const pin of dirtyEvents) { const ev = events.get(pin); if (ev) emitEvent(ev); } dirtyEvents.clear(); }, 400);

function isHost(socket) {
  const ev = events.get(socket.data.hostOf);
  return ev && ev.hostSocket === socket.id ? ev : null;
}
function endEvent(ev, msg) {
  io.to('ev:' + ev.pin).emit('eventEnded', { message: msg });
  for (const room of ev.teams.values()) rooms.delete(room.code);
  for (const s of io.sockets.adapter.rooms.get('ev:' + ev.pin) || []) {
    const sock = io.sockets.sockets.get(s);
    if (sock) { if (sock.data.code) sock.leave(sock.data.code); sock.data.code = null; sock.data.pin = null; sock.leave('ev:' + ev.pin); }
  }
  events.delete(ev.pin);
}
function startRoom(room, time) {
  room.state.started = true; room.state.startTime = time;
  io.to(room.code).emit('started');
  emitLobby(room); emitState(room);
}

io.on('connection', socket => {
  // ===== private expeditions =====
  socket.on('create', (data, cb) => {
    if (typeof cb !== 'function') return;
    leaveRoom(socket, true);
    const code = makeCode();
    const room = { code, hostId: socket.id, players: new Map(), state: freshState() };
    rooms.set(code, room);
    addPlayer(socket, room, cleanName(data && data.name), cleanAvatar(data && data.avatar));
    cb({ ok: true, code, started: false });
    emitLobby(room); emitState(room);
  });

  socket.on('join', (data, cb) => {
    if (typeof cb !== 'function') return;
    const code = String((data && data.code) || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || room.event) return cb({ ok: false, error: 'No expedition found with that code.' });
    if (room.players.size >= MAX_TEAM && !room.players.has(socket.id)) return cb({ ok: false, error: 'That expedition is full (6 players max).' });
    if (room.state.escaped) return cb({ ok: false, error: 'That team already escaped! Ask the host to restart.' });
    leaveRoom(socket, true);
    const name = cleanName(data && data.name);
    addPlayer(socket, room, name, cleanAvatar(data && data.avatar));
    cb({ ok: true, code, started: room.state.started });
    emitLobby(room); emitState(room);
    socket.to(code).emit('log', { text: `${name} joined the expedition!` });
    socket.to(code).emit('sfx', 'join');
  });

  socket.on('start', () => {
    const r = getRoom(socket);
    if (!r || r.room.event || r.room.hostId !== socket.id || r.room.state.started) return;
    startRoom(r.room, Date.now());
  });

  socket.on('restart', () => {
    const r = getRoom(socket);
    if (!r || r.room.event || r.room.hostId !== socket.id || !r.room.state.escaped) return;
    resetRoom(r.room);
  });

  // ===== school events: teacher side =====
  socket.on('hostCreate', (data, cb) => {
    if (typeof cb !== 'function') return;
    const pin = makePin(), key = crypto.randomBytes(12).toString('hex');
    const ev = { pin, key, hostSocket: socket.id, teams: new Map(), started: false, startTime: null, locked: false, chatOff: false, finishOrder: [], lastActive: Date.now() };
    events.set(pin, ev);
    socket.data.hostOf = pin;
    socket.join('host:' + pin);
    cb({ ok: true, pin, key });
    emitEvent(ev);
  });
  socket.on('hostResume', (data, cb) => {
    if (typeof cb !== 'function') return;
    const ev = events.get(String(data && data.pin));
    if (!ev || ev.key !== (data && data.key)) return cb({ ok: false });
    ev.hostSocket = socket.id;
    socket.data.hostOf = ev.pin;
    socket.join('host:' + ev.pin);
    cb({ ok: true, pin: ev.pin });
    emitEvent(ev);
  });
  socket.on('hostStart', () => {
    const ev = isHost(socket); if (!ev || ev.started) return;
    ev.started = true; ev.startTime = Date.now();
    for (const room of ev.teams.values()) if (room.players.size) startRoom(room, ev.startTime);
    emitEvent(ev);
  });
  socket.on('hostLock', () => { const ev = isHost(socket); if (ev) { ev.locked = !ev.locked; emitEvent(ev); } });
  socket.on('hostChat', () => { const ev = isHost(socket); if (ev) { ev.chatOff = !ev.chatOff; emitEvent(ev); } });
  socket.on('hostKick', id => {
    const ev = isHost(socket); if (!ev) return;
    const s = io.sockets.sockets.get(id);
    if (!s || s.data.pin !== ev.pin) return;
    leaveRoom(s, true);
    s.leave('ev:' + ev.pin); s.data.pin = null;
    s.emit('kicked');
    emitEvent(ev);
  });
  socket.on('hostRenameTeam', d => {
    const ev = isHost(socket); if (!ev || !d) return;
    const room = ev.teams.get(d.id); if (!room) return;
    room.teamName = `Team ${[...ev.teams.keys()].indexOf(d.id) + 1}`;
    emitLobby(room); emitState(room); emitEvent(ev);
  });
  socket.on('hostReset', () => {
    const ev = isHost(socket); if (!ev) return;
    ev.started = false; ev.startTime = null; ev.finishOrder = [];
    for (const room of [...ev.teams.values()]) {
      if (!room.players.size) { ev.teams.delete(room.code); rooms.delete(room.code); continue; }
      resetRoom(room);
    }
    emitEvent(ev);
  });
  socket.on('hostEnd', () => { const ev = isHost(socket); if (ev) endEvent(ev, 'Your teacher ended the event. Thanks for playing!'); });

  // ===== school events: student side =====
  socket.on('eventJoin', (data, cb) => {
    if (typeof cb !== 'function') return;
    const ev = events.get(String((data && data.pin) || '').trim());
    if (!ev) return cb({ ok: false, error: 'No event found with that PIN. Check the big screen!' });
    if (ev.locked && !(data && data.rejoin)) return cb({ ok: false, error: 'This event is locked. Ask your teacher to unlock it.' });
    leaveRoom(socket, true);
    socket.data.pin = ev.pin;
    socket.data.profile = { name: cleanName(data.name), avatar: cleanAvatar(data.avatar) };
    socket.join('ev:' + ev.pin);
    ev.lastActive = Date.now();
    // one device = one team. Rejoining after a wifi drop puts the device back in its old team.
    let room = data.teamId && ev.teams.get(data.teamId);
    if (!room || room.players.size >= 1 || room.state.escaped) {
      if (ev.teams.size >= MAX_TEAMS) return cb({ ok: false, error: 'This event is full.' });
      let name = socket.data.profile.name, n = 2;
      const taken = nm => [...ev.teams.values()].some(r => r.teamName.toLowerCase() === nm.toLowerCase());
      while (taken(name)) name = `${socket.data.profile.name} ${n++}`;
      room = { code: makeCode(), hostId: null, players: new Map(), state: freshState(), event: ev.pin, teamName: name };
      rooms.set(room.code, room); ev.teams.set(room.code, room);
    }
    addPlayer(socket, room, room.teamName, socket.data.profile.avatar);
    if (ev.started && !room.state.started) startRoom(room, ev.startTime);
    cb({ ok: true, pin: ev.pin, id: room.code, teamName: room.teamName, started: room.state.started });
    emitLobby(room); emitState(room);
    dirtyEvents.add(ev.pin);
    io.to('host:' + ev.pin).emit('sfx', 'pop');
  });
  function joinTeam(socket, ev, room, cb) {
    if (room.players.size >= MAX_TEAM) return cb({ ok: false, error: 'That team is full (6 max).' });
    leaveRoom(socket, true);
    addPlayer(socket, room, socket.data.profile.name, socket.data.profile.avatar);
    if (ev.started && !room.state.started) startRoom(room, ev.startTime);
    cb({ ok: true, id: room.code, teamName: room.teamName, started: room.state.started });
    emitLobby(room); emitState(room);
    socket.to(room.code).emit('log', { text: `${socket.data.profile.name} joined ${room.teamName}!` });
    socket.to(room.code).emit('sfx', 'join');
  }
  socket.on('teamCreate', (data, cb) => {
    if (typeof cb !== 'function') return;
    const ev = events.get(socket.data.pin); if (!ev) return cb({ ok: false, error: 'You are not in an event.' });
    if (ev.locked) return cb({ ok: false, error: 'The event is locked.' });
    if (ev.teams.size >= MAX_TEAMS) return cb({ ok: false, error: 'There are too many teams. Join an existing one!' });
    const name = cleanName(data && data.name, `Team ${ev.teams.size + 1}`);
    if ([...ev.teams.values()].some(r => r.teamName.toLowerCase() === name.toLowerCase())) return cb({ ok: false, error: 'That team name is taken.' });
    const room = { code: makeCode(), hostId: null, players: new Map(), state: freshState(), event: ev.pin, teamName: name };
    rooms.set(room.code, room); ev.teams.set(room.code, room);
    joinTeam(socket, ev, room, cb);
  });
  socket.on('teamJoin', (data, cb) => {
    if (typeof cb !== 'function') return;
    const ev = events.get(socket.data.pin); if (!ev) return cb({ ok: false, error: 'You are not in an event.' });
    const room = ev.teams.get(data && data.id); if (!room) return cb({ ok: false, error: 'That team no longer exists.' });
    if (room.players.has(socket.id)) return cb({ ok: true, id: room.code, teamName: room.teamName, started: room.state.started });
    if (ev.locked && !data.rejoin) return cb({ ok: false, error: 'The event is locked.' });
    if (room.state.escaped) return cb({ ok: false, error: 'That team already escaped!' });
    joinTeam(socket, ev, room, cb);
  });
  socket.on('teamLeave', () => { const r = getRoom(socket); if (r && r.room.event) leaveRoom(socket); });

  // ===== gameplay =====
  socket.on('move', d => {
    const r = getRoom(socket);
    if (!r || !d) return;
    const { x, y, z, yaw, pitch } = d;
    if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
    r.player.x = Math.max(-7, Math.min(7, x));
    r.player.y = Math.max(0, Math.min(3, y));
    r.player.z = Math.max(-21, Math.min(16, z));
    r.player.yaw = yaw;
    r.player.pitch = Math.max(-1.6, Math.min(1.6, pitch));
    checkPlates(r.room);
    checkEscape(r.room);
  });

  socket.on('gem', color => {
    const r = getRoom(socket);
    if (!r || !r.room.state.started) return;
    const s = r.room.state;
    if (s.chestOpen || !GEM_ORDER.includes(color) || s.gemSeq.includes(color)) return;
    s.gemSeq.push(color);
    const i = s.gemSeq.length - 1;
    if (s.gemSeq[i] !== GEM_ORDER[i]) {
      s.gemSeq = [];
      log(r.room, `${r.player.name} pressed the wrong gem. The gems fade back to sleep…`, 'wrong');
    } else if (s.gemSeq.length === GEM_ORDER.length) {
      s.chestOpen = true;
      log(r.room, 'All four gems blaze with light — the treasure chest pops open!', 'chest');
    } else {
      io.to(r.room.code).emit('sfx', 'gem' + s.gemSeq.length);
    }
    emitState(r.room);
  });

  socket.on('mirror', i => {
    const r = getRoom(socket);
    if (!r || !r.room.state.started) return;
    const s = r.room.state;
    if (!s.doorA || s.beamSolved || !(i >= 0 && i < 4)) return;
    s.mirrors[i] = 1 - s.mirrors[i];
    if (traceBeam(s.mirrors).hit) {
      s.beamSolved = true;
      log(r.room, 'The sunbeam strikes the great crystal! Ancient writing lights up on the wall…', 'beam');
    } else io.to(r.room.code).emit('sfx', 'mirror');
    emitState(r.room);
  });

  socket.on('code', (d, cb) => {
    if (typeof cb !== 'function') return;
    const r = getRoom(socket);
    if (!r || !d || !r.room.state.started) return cb({ ok: false });
    const s = r.room.state, lock = d.lock;
    if (!(lock in ANSWERS)) return cb({ ok: false });
    if (lock === 'console' && !s.doorB) return cb({ ok: false });
    const value = String(d.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const key = lock === 'console' ? 'consoleSolved' : lock;
    if (s[key]) return cb({ ok: true });
    if (value === ANSWERS[lock]) {
      s[key] = true;
      log(r.room, `${r.player.name} opened ${LOCK_NAMES[lock]}!`, 'door');
      if (lock === 'console') log(r.room, 'Daylight pours in! Everyone step outside together to escape.');
      emitState(r.room); checkEscape(r.room);
      cb({ ok: true });
    } else { socket.emit('sfx', 'wrong'); cb({ ok: false }); }
  });

  socket.on('hint', () => {
    const r = getRoom(socket); if (!r) return;
    r.room.state.hints++;
    socket.to(r.room.code).emit('log', { text: `${r.player.name} used a hint.` });
    emitState(r.room);
  });

  socket.on('chat', text => {
    const r = getRoom(socket); if (!r) return;
    const ev = r.room.event && events.get(r.room.event);
    if (ev && ev.chatOff) return socket.emit('log', { text: 'Chat is turned off by your teacher. Use emotes instead!' });
    const now = Date.now();
    if (now - (socket.data.lastChat || 0) < 800) return;
    socket.data.lastChat = now;
    const t = clean(String(text || '').trim().slice(0, 140));
    if (!t) return;
    io.to(r.room.code).emit('chat', { id: socket.id, name: r.player.name, color: r.player.color, text: t });
  });

  socket.on('emote', e => {
    const r = getRoom(socket);
    if (!r || !['wave', 'cheer', 'think'].includes(e)) return;
    io.to(r.room.code).emit('emote', { id: socket.id, emote: e });
  });

  socket.on('disconnect', () => {
    leaveRoom(socket);
    const ev = events.get(socket.data.hostOf);
    if (ev && ev.hostSocket === socket.id) { ev.hostSocket = null; ev.lastActive = Date.now(); }
    if (socket.data.pin) dirtyEvents.add(socket.data.pin);
  });
});

function resetRoom(room) {
  room.state = freshState();
  let i = 0;
  for (const p of room.players.values()) Object.assign(p, spawnFor(i++), { y: 0, yaw: 0, pitch: 0 });
  io.to(room.code).emit('restarted');
  emitLobby(room); emitState(room);
}

// Broadcast positions to each team 10 times a second
setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.state.started || room.players.size < 2) continue;
    io.to(room.code).emit('players', [...room.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, hat: p.hat,
      x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(2), pitch: +p.pitch.toFixed(2)
    })));
  }
}, 100);
// solo players still need one snapshot now and then (spawn + team list)
setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.state.started || room.players.size !== 1) continue;
    const p = room.players.values().next().value;
    io.to(room.code).emit('players', [{ id: p.id, name: p.name, color: p.color, hat: p.hat, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch }]);
  }
}, 1000);
// tidy up events nobody is using any more (host gone + no players for 2 hours)
setInterval(() => {
  const now = Date.now();
  for (const ev of events.values()) {
    const players = [...ev.teams.values()].reduce((n, r) => n + r.players.size, 0);
    if (ev.hostSocket || players) { ev.lastActive = now; continue; }
    if (now - ev.lastActive > 2 * 3600 * 1000) endEvent(ev, 'This event has expired.');
  }
}, 5 * 60 * 1000);

server.listen(PORT, () => console.log(`Escape room running on http://localhost:${PORT}`));
