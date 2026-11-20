// The Lost Temple of Solara — game client (Three.js + Socket.io)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const socket = io();
const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
const rand = (a, b) => a + Math.random() * (b - a);

// Sunbeam puzzle layout (must match server.js)
const BEAM = {
  source: { x: -5.7, z: 3 },
  target: { x: 5.4, z: 3 },
  mirrors: [{ x: -2, z: 3 }, { x: 2, z: 3 }, { x: -2, z: -1 }, { x: 2, z: -1 }]
};
function traceBeam(m) {
  let x = BEAM.source.x, z = BEAM.source.z, dx = 1, dz = 0, last = -1;
  const pts = [[x, z]];
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
    if (ton && tt > 0.01 && tt < bestT) { pts.push([T.x, T.z]); return { pts, hit: true }; }
    if (best < 0) { pts.push([dx ? (dx > 0 ? 5.85 : -5.85) : x, dz ? (dz > 0 ? 4.85 : -4.85) : z]); return { pts, hit: false }; }
    x = BEAM.mirrors[best].x; z = BEAM.mirrors[best].z; last = best;
    pts.push([x, z]);
    if (m[best] === 0) [dx, dz] = [dz, dx]; else [dx, dz] = [-dz, -dx];
  }
  return { pts, hit: false };
}

// ======================================================================
//  AVATAR MODEL (used in the lobby preview and in the game)
// ======================================================================
const COLORS = ['#ff8a3d', '#ffd23f', '#3ddc97', '#4dabf7', '#9775fa', '#f06595', '#20c997', '#e03131'];
const HATS = [['explorer', '🤠', 'Explorer'], ['cap', '🧢', 'Cap'], ['crown', '👑', 'Crown'], ['beanie', '🧶', 'Beanie'], ['bandana', '🎀', 'Bandana'], ['none', '🙂', 'None']];

function std(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra }); }
function part(geo, material, x, y, z, parent) { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); parent.add(m); return m; }

function buildAvatar(color, hat) {
  const g = new THREE.Group();
  const col = new THREE.Color(color);
  const cloth = std(col, { roughness: 0.55 });
  const skin = std(0xf2d0ae, { roughness: 0.7 });
  const pants = std(0x5c4a38);
  const black = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  const legs = [], arms = [];
  for (const lx of [-0.12, 0.12]) {
    const leg = new THREE.Group(); leg.position.set(lx, 0.55, 0); g.add(leg);
    part(new THREE.CapsuleGeometry(0.085, 0.36, 4, 8), pants, 0, -0.25, 0, leg);
    part(new THREE.BoxGeometry(0.15, 0.08, 0.22), std(0x3b2a1a), 0, -0.5, -0.03, leg);
    legs.push(leg);
  }
  part(new THREE.CapsuleGeometry(0.25, 0.36, 6, 14), cloth, 0, 0.88, 0, g);
  part(new THREE.CylinderGeometry(0.255, 0.255, 0.07, 16), std(0x6b4a2a), 0, 0.68, 0, g);
  part(new THREE.BoxGeometry(0.06, 0.06, 0.02), std(0xffd27a, { metalness: 0.8, roughness: 0.3 }), 0, 0.68, -0.26, g);
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.32, 1.08, 0); g.add(arm);
    part(new THREE.CapsuleGeometry(0.07, 0.34, 4, 8), cloth, 0, -0.2, 0, arm);
    part(new THREE.SphereGeometry(0.075, 10, 8), skin, 0, -0.42, 0, arm);
    arms.push(arm);
  }
  // backpack + rolled blanket
  part(new THREE.BoxGeometry(0.36, 0.42, 0.18), std(0x8a5a2b), 0, 0.92, 0.3, g);
  part(new THREE.BoxGeometry(0.3, 0.14, 0.04), std(0x6e4520), 0, 0.85, 0.4, g);
  const roll = part(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 12), std(0x2f7a5a), 0, 1.18, 0.3, g); roll.rotation.z = Math.PI / 2;

  const head = new THREE.Group(); head.position.y = 1.45; g.add(head);
  part(new THREE.SphereGeometry(0.24, 24, 18), skin, 0, 0, 0, head);
  for (const ex of [-0.085, 0.085]) {
    part(new THREE.SphereGeometry(0.035, 10, 8), black, ex, 0.02, -0.215, head);
    part(new THREE.SphereGeometry(0.012, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), ex + 0.012, 0.035, -0.245, head);
    part(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff9a9a, transparent: true, opacity: 0.6 }), ex * 1.6, -0.06, -0.19, head);
  }
  const smile = part(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), black, 0, -0.07, -0.225, head);
  smile.rotation.z = Math.PI;

  const hatMat = c => std(c, { roughness: 0.7 });
  if (hat === 'explorer') {
    part(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 24), hatMat(0xc9a066), 0, 0.15, 0, head);
    part(new THREE.CylinderGeometry(0.2, 0.24, 0.18, 20), hatMat(0xc9a066), 0, 0.25, 0, head);
    part(new THREE.CylinderGeometry(0.245, 0.245, 0.05, 20), hatMat(0x5a3a1e), 0, 0.19, 0, head);
  } else if (hat === 'cap') {
    const capC = col.clone().offsetHSL(0, 0, -0.18);
    const c = part(new THREE.SphereGeometry(0.255, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), hatMat(capC), 0, 0.04, 0, head);
    c.scale.y = 0.85;
    part(new THREE.BoxGeometry(0.26, 0.025, 0.2), hatMat(capC), 0, 0.06, -0.3, head);
    part(new THREE.SphereGeometry(0.03, 8, 6), hatMat(0xffffff), 0, 0.26, 0, head);
  } else if (hat === 'crown') {
    const gold = std(0xffc83d, { metalness: 0.6, roughness: 0.3, emissive: 0x664400 });
    part(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 20, 1, true), gold, 0, 0.24, 0, head).material.side = THREE.DoubleSide;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      part(new THREE.ConeGeometry(0.04, 0.1, 6), gold, Math.sin(a) * 0.2, 0.34, Math.cos(a) * 0.2, head);
    }
    part(new THREE.OctahedronGeometry(0.04), std(0xff3b6b, { emissive: 0x880022 }), 0, 0.24, -0.205, head);
  } else if (hat === 'beanie') {
    const bc = col.clone().offsetHSL(0.5, 0, 0);
    part(new THREE.SphereGeometry(0.26, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), hatMat(bc), 0, 0.03, 0, head);
    const cuff = part(new THREE.TorusGeometry(0.25, 0.045, 8, 24), hatMat(0xffffff), 0, 0.05, 0, head); cuff.rotation.x = Math.PI / 2;
    part(new THREE.SphereGeometry(0.07, 10, 8), hatMat(0xffffff), 0, 0.3, 0, head);
  } else if (hat === 'bandana') {
    const band = part(new THREE.TorusGeometry(0.235, 0.045, 8, 24), hatMat(0xe03131), 0, 0.1, 0, head); band.rotation.x = Math.PI / 2;
    part(new THREE.SphereGeometry(0.05, 8, 6), hatMat(0xe03131), 0, 0.1, 0.25, head);
    const t = part(new THREE.BoxGeometry(0.05, 0.14, 0.02), hatMat(0xe03131), 0.04, 0.02, 0.27, head); t.rotation.z = 0.4;
    part(new THREE.SphereGeometry(0.245, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), hatMat(0x3b2416), 0, 0.03, 0.01, head);
  } else {
    part(new THREE.SphereGeometry(0.25, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), hatMat(0x3b2416), 0, 0.03, 0.02, head);
  }
  return { group: g, head, legs, arms };
}

// ======================================================================
//  LOBBY: name + avatar picker with live 3D preview
// ======================================================================
let myId = null, roomCode = null, hostId = null;
let state = {};
let serverOffset = 0;
let inGame = false, ended = false, spawned = false;
const avatarChoice = { color: COLORS[0], hat: 'explorer' };
try {
  $('nameInput').value = localStorage.getItem('solara-name') || '';
  const saved = JSON.parse(localStorage.getItem('solara-avatar') || 'null');
  if (saved && COLORS.includes(saved.color)) avatarChoice.color = saved.color;
  if (saved && HATS.some(h => h[0] === saved.hat)) avatarChoice.hat = saved.hat;
} catch (e) {}

const preview = { renderer: null, scene: null, camera: null, model: null, running: true };
function setupPreview() {
  try {
    const cv = $('avatarPreview');
    preview.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    preview.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    preview.renderer.outputColorSpace = THREE.SRGBColorSpace;
    preview.scene = new THREE.Scene();
    preview.camera = new THREE.PerspectiveCamera(32, cv.width / cv.height, 0.1, 20);
    preview.camera.position.set(0, 1.1, 3.6);
    preview.camera.lookAt(0, 0.95, 0);
    preview.scene.add(new THREE.HemisphereLight(0xfff2d6, 0x335544, 1.4));
    try { const pm = new THREE.PMREMGenerator(preview.renderer); preview.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; preview.scene.environmentIntensity = 0.6; } catch (e) {}
    const key = new THREE.DirectionalLight(0xffe2a8, 2.2); key.position.set(2, 3, -3); preview.scene.add(key);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.65, 0.08, 32), std(0xc9a46a));
    disc.position.y = -0.04; preview.scene.add(disc);
    rebuildPreview();
    const loop = () => {
      if (!preview.running) return;
      requestAnimationFrame(loop);
      const t = performance.now() / 1000;
      const w = preview.renderer.domElement.clientWidth, h = preview.renderer.domElement.clientHeight;
      if (w && h && (preview.w !== w || preview.h !== h)) {
        preview.w = w; preview.h = h; preview.renderer.setSize(w, h, false);
        preview.camera.aspect = w / h; preview.camera.updateProjectionMatrix();
      }
      if (preview.model) {
        preview.model.group.rotation.y = Math.PI + Math.sin(t * 0.6) * 0.9;
        preview.model.group.position.y = Math.abs(Math.sin(t * 2)) * 0.04;
        preview.model.arms[1].rotation.z = Math.sin(t * 3) * 0.15 + 0.1;
        preview.model.arms[0].rotation.z = -0.1 - Math.sin(t * 3) * 0.15;
      }
      preview.renderer.render(preview.scene, preview.camera);
    };
    loop();
  } catch (e) { $('avatarPreview').style.display = 'none'; }
}
function setupPreviewLoop() { /* preview loop stops when running=false; restart by reloading */ if (preview.renderer) location.reload(); }
function rebuildPreview() {
  if (!preview.scene) return;
  if (preview.model) preview.scene.remove(preview.model.group);
  preview.model = buildAvatar(avatarChoice.color, avatarChoice.hat);
  preview.scene.add(preview.model.group);
}
function renderPickers() {
  const cp = $('colorPick'); cp.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.style.background = c; b.className = c === avatarChoice.color ? 'sel' : ''; b.title = c;
    b.onclick = () => { avatarChoice.color = c; uiTick(); renderPickers(); rebuildPreview(); saveAvatar(); };
    cp.append(b);
  }
  const hp = $('hatPick'); hp.innerHTML = '';
  for (const [id, emoji, label] of HATS) {
    const b = document.createElement('button');
    b.className = id === avatarChoice.hat ? 'sel' : '';
    const e = document.createElement('span'); e.className = 'e'; e.textContent = emoji;
    b.append(e, document.createTextNode(label));
    b.onclick = () => { avatarChoice.hat = id; uiTick(); renderPickers(); rebuildPreview(); saveAvatar(); };
    hp.append(b);
  }
}
function saveAvatar() { try { localStorage.setItem('solara-avatar', JSON.stringify(avatarChoice)); } catch (e) {} }
const updatePreviewName = () => ($('previewName').textContent = $('nameInput').value.trim() || 'Explorer');
$('nameInput').addEventListener('input', updatePreviewName);
renderPickers(); updatePreviewName(); setupPreview();

function showScreen(id) {
  for (const s of ['lobby', 'waiting', 'teams', 'host', 'game', 'ending']) $(s).classList.toggle('hidden', s !== id);
}
function getName() {
  const n = $('nameInput').value.trim();
  if (!n) { $('lobbyError').textContent = urlPin.length === 6 || /^\d{6}$/.test($('codeInput').value.trim()) ? 'Type your team name first!' : 'Type your explorer name first!'; $('nameInput').focus(); sfx('wrong'); return null; }
  try { localStorage.setItem('solara-name', n); } catch (e) {}
  return n;
}
function enterRoom(res) {
  myId = socket.id; roomCode = res.code;
  $('roomCodeBig').textContent = roomCode;
  $('hudCode').textContent = roomCode;
  sfx('join');
  if (res.started) startGame(); else showScreen('waiting');
}
function uiTick() { initAudio(); sfx('click'); }

$('createBtn').onclick = () => {
  initAudio();
  const name = getName(); if (!name) return;
  socket.emit('create', { name, avatar: avatarChoice }, res => { if (res.ok) { session = { mode: 'room', code: res.code }; enterRoom(res); } else $('lobbyError').textContent = res.error; });
};
$('joinBtn').onclick = () => {
  initAudio();
  const name = getName(); if (!name) return;
  const code = $('codeInput').value.trim().toUpperCase();
  if (/^\d{6}$/.test(code)) return joinEvent(code, name);
  if (code.length !== 5) { $('lobbyError').textContent = 'Type the 6-digit event PIN (or a 5-letter expedition code).'; sfx('wrong'); return; }
  socket.emit('join', { name, code, avatar: avatarChoice }, res => {
    if (res.ok) { session = { mode: 'room', code }; enterRoom(res); } else { $('lobbyError').textContent = res.error; sfx('wrong'); }
  });
};
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
$('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('createBtn').click(); });
$('copyCode').onclick = () => {
  uiTick();
  navigator.clipboard?.writeText(roomCode).then(() => ($('copyCode').textContent = '✅ Copied!'), () => {});
};
$('startBtn').onclick = () => { uiTick(); socket.emit('start'); };
$('againBtn').onclick = () => { uiTick(); socket.emit('restart'); };

const hatEmoji = h => (HATS.find(x => x[0] === h) || HATS[0])[1];
socket.on('lobby', data => {
  hostId = data.hostId;
  const list = $('playerList');
  list.innerHTML = '';
  for (const p of data.players) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot'; dot.style.background = p.color; dot.style.color = p.color;
    li.append(dot, document.createTextNode(`${hatEmoji(p.hat)} ${p.name}${p.id === socket.id ? ' (you)' : ''}`));
    if (p.id === data.hostId) li.append(document.createTextNode(' ⭐'));
    list.append(li);
  }
  const amHost = data.hostId === socket.id;
  $('startBtn').classList.toggle('hidden', !amHost || data.started);
  $('waitMsg').textContent = amHost ? 'You are the expedition leader ⭐ Start when your team is ready (solo works too!).' : 'Waiting for the expedition leader to start…';
  $('againBtn').classList.toggle('hidden', !amHost);
  $('endWait').classList.toggle('hidden', amHost);
  renderTeam(data.players);
});

socket.on('started', () => startGame());
socket.on('state', s => applyState(s));
socket.on('players', arr => updatePlayers(arr));
socket.on('log', d => toast(d.text));
socket.on('sfx', name => sfx(name));
socket.on('chat', d => addChat(d));
socket.on('emote', d => showEmote(d.id, d.emote));
socket.on('escaped', d => showEnding(d));
socket.on('restarted', () => {
  ended = false; spawned = false; inGame = false; hintStep = {}; journal.length = 0; updateJournalCount();
  seenRooms.clear(); prevState = null;
  for (const id of Object.keys(avatars)) removeAvatar(id);
  showScreen(session && session.mode === 'event' ? 'teams' : 'waiting');
});
socket.on('disconnect', () => { if (inGame) toast('Connection lost… reconnecting.'); });

function renderTeam(players) {
  const el = $('teamList'); el.innerHTML = '';
  for (const p of players) {
    const d = document.createElement('div');
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = p.color; dot.style.color = p.color;
    d.append(dot, document.createTextNode(`${hatEmoji(p.hat)} ${p.name}`));
    el.append(d);
  }
}
function toast(text) {
  if (!text) return;
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = text;
  const box = hosting ? $('hostToasts') : $('toasts');
  box.append(t);
  setTimeout(() => t.remove(), 5200);
  while (box.children.length > 4) box.firstChild.remove();
}
function addChat(d) {
  const row = document.createElement('div');
  const n = document.createElement('b'); n.style.color = d.color; n.textContent = d.name + ': ';
  row.append(n, document.createTextNode(d.text));
  $('chatLog').append(row);
  while ($('chatLog').children.length > 7) $('chatLog').firstChild.remove();
  sfx('pop');
  if (d.id && avatars[d.id]) showBubble(avatars[d.id], '💬', 3);
}
function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function showEnding(d) {
  ended = true;
  closeModal();
  if (document.pointerLockElement) document.exitPointerLock();
  $('flash').classList.add('on'); setTimeout(() => $('flash').classList.remove('on'), 60);
  $('endTime').textContent = fmtTime(d.time);
  $('endHints').textContent = d.hints;
  const mins = d.time / 60000;
  $('endRank').textContent = mins < 12 && d.hints === 0 ? '⭐⭐⭐' : mins < 25 && d.hints <= 3 ? '⭐⭐' : '⭐';
  $('endRankLabel').textContent = d.rank ? 'Place' : 'Rank';
  if (d.rank) $('endRank').textContent = `#${d.rank} of ${d.total}`;
  $('endEvent').classList.toggle('hidden', !d.event);
  if (d.event) { $('againBtn').classList.add('hidden'); $('endWait').classList.add('hidden'); }
  $('endTeam').textContent = (d.teamName ? d.teamName + ': ' : 'Explorers: ') + d.players.join(', ');
  sfx('win');
  setTimeout(() => { showScreen('ending'); confetti(); }, 1100);
}
function confetti() {
  const cv = $('confetti'), g = cv.getContext('2d');
  if (hosting) { cv.style.zIndex = 50; document.body.append(cv); }
  cv.width = innerWidth; cv.height = innerHeight;
  const cols = ['#ffd23f', '#ff8a3d', '#3ddc97', '#4dabf7', '#f06595', '#ffffff'];
  const ps = Array.from({ length: 180 }, () => ({
    x: rand(0, cv.width), y: rand(-cv.height, 0), vx: rand(-1, 1), vy: rand(2, 5), r: rand(0, 6), vr: rand(-0.2, 0.2),
    w: rand(6, 12), h: rand(8, 16), c: cols[Math.floor(Math.random() * cols.length)]
  }));
  const start = performance.now();
  (function f() {
    const el = performance.now() - start;
    g.clearRect(0, 0, cv.width, cv.height);
    for (const p of ps) {
      p.x += p.vx + Math.sin(el / 400 + p.r) * 0.6; p.y += p.vy; p.r += p.vr;
      if (p.y > cv.height + 20 && el < 5000) { p.y = -20; p.x = rand(0, cv.width); }
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
    }
    if (el < 9000) requestAnimationFrame(f); else g.clearRect(0, 0, cv.width, cv.height);
  })();
}

// ======================================================================
//  SCHOOL EVENTS — student side (join by PIN, pick a team)
// ======================================================================
let session = null;          // what to rejoin after a reconnect
let hosting = false;
let everConnected = false;
const params = new URLSearchParams(location.search);
const urlPin = (params.get('pin') || '').replace(/\D/g, '').slice(0, 6);
if (urlPin.length === 6) {
  $('codeInput').value = urlPin;
  $('pinBanner').classList.remove('hidden'); $('pinBannerPin').textContent = urlPin;
  $('joinBtn').textContent = 'Join event ➜';
  $('nameLabel').textContent = 'Team name';
  $('nameInput').placeholder = 'Type your team name';
}
try {
  const h = JSON.parse(localStorage.getItem('solara-host') || 'null');
  if (h && h.pin) { $('resumeHostBtn').classList.remove('hidden'); $('resumePin').textContent = h.pin; }
} catch (e) {}

function joinEvent(pin, name, rejoin = false, teamId = null) {
  socket.emit('eventJoin', { pin, name, avatar: avatarChoice, rejoin, teamId }, res => {
    if (!res.ok) {
      if (rejoin) { session = null; showScreen('lobby'); }
      $('lobbyError').textContent = res.error; sfx('wrong'); return;
    }
    session = { mode: 'event', pin, name, teamId: res.id };
    $('teamsPin').textContent = pin; $('teamsName').textContent = res.teamName;
    $('hudLabel').textContent = 'Team'; $('hudCode').textContent = res.teamName;
    if (res.started) startGame();
    else { if (!rejoin) sfx('join'); if (!inGame) showScreen('teams'); }
  });
}
function chip(p, onKick) {
  const c = document.createElement('span'); c.className = 'chip';
  const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = p.color; dot.style.color = p.color;
  c.append(dot, document.createTextNode(`${hatEmoji(p.hat)} ${p.name}`));
  if (onKick) { const k = document.createElement('button'); k.className = 'kick'; k.textContent = '✕'; k.title = 'Remove this team'; k.onclick = onKick; c.append(k); }
  return c;
}
socket.on('eventLobby', data => {
  if (!session || session.mode !== 'event') return;
  const grid = $('teamGrid'); grid.innerHTML = ''; grid.classList.add('big');
  for (const t of data.teams) for (const p of t.players) grid.append(chip(p));
  $('myTeamWait').textContent = data.started ? 'The adventure has started — jump in!' : 'Waiting for your teacher to start… ⏳';
});
socket.on('eventEnded', d => {
  session = null; inGame = false; ended = false;
  if (document.pointerLockElement) document.exitPointerLock();
  closeModal();
  showScreen('lobby'); $('lobbyError').textContent = d.message;
});
socket.on('kicked', () => {
  session = null; inGame = false;
  if (document.pointerLockElement) document.exitPointerLock();
  closeModal();
  showScreen('lobby'); $('lobbyError').textContent = 'You were removed from the event by the teacher.';
});
// automatically get back into the game after a wifi hiccup
socket.on('connect', () => {
  if (!everConnected) { everConnected = true; return; }
  if (hosting) return resumeHost(hostInfo, true);
  if (!session) return;
  if (session.mode === 'room') {
    socket.emit('join', { name: $('nameInput').value.trim() || 'Explorer', code: session.code, avatar: avatarChoice }, res => {
      if (res.ok) toast('Reconnected!'); else { toast('Could not rejoin: ' + res.error); }
    });
  } else joinEvent(session.pin, session.name, true, session.teamId);
});

// ======================================================================
//  SCHOOL EVENTS — teacher dashboard
// ======================================================================
let hostInfo = null, hostData = null, hostTimer = null, lastPlayerCount = 0;
const STEP_NAMES = ['Chest', 'Door', 'Sunbeam', 'Gate', 'Password', 'Escaped'];
$('hostBtn').onclick = () => {
  initAudio(); sfx('click');
  socket.emit('hostCreate', {}, res => {
    if (!res.ok) return;
    hostInfo = { pin: res.pin, key: res.key };
    try { localStorage.setItem('solara-host', JSON.stringify(hostInfo)); } catch (e) {}
    enterHost();
  });
};
$('resumeHostBtn').onclick = () => {
  initAudio();
  try { resumeHost(JSON.parse(localStorage.getItem('solara-host'))); } catch (e) {}
};
function resumeHost(info, silent = false) {
  if (!info) return;
  socket.emit('hostResume', info, res => {
    if (res.ok) { hostInfo = info; if (!silent) enterHost(); }
    else { try { localStorage.removeItem('solara-host'); } catch (e) {} $('resumeHostBtn').classList.add('hidden'); if (!silent) $('lobbyError').textContent = 'That event has ended. Start a new one!'; }
  });
}
function enterHost() {
  hosting = true; preview.running = false;
  const url = `${location.origin}/?pin=${hostInfo.pin}`;
  $('hostPin').textContent = hostInfo.pin; $('hPinSmall').textContent = hostInfo.pin;
  $('hostUrl').textContent = location.host;
  $('hostQr').src = '/qr.svg?t=' + encodeURIComponent(url);
  showScreen('host');
  clearInterval(hostTimer);
  hostTimer = setInterval(() => {
    if (hostData && hostData.started) $('hTimer').textContent = fmtTime(Date.now() + serverOffset - hostData.startTime);
  }, 500);
}
socket.on('hostState', d => {
  hostData = d; serverOffset = d.serverNow - Date.now();
  $('hostLobby').classList.toggle('hidden', d.started);
  $('hostLive').classList.toggle('hidden', !d.started);
  $('hLock').textContent = d.locked ? '🔒 Joining locked' : '🔓 Joining open';
  $('hChat').textContent = d.chatOff ? '💬 Chat: off' : '💬 Chat: on';
  $('hTeams').textContent = d.teams.filter(t => t.players.length).length;

  lastPlayerCount = d.players;
  $('hStart').disabled = !d.players;
  if (!d.started) renderHostTeams(d); else renderBoard(d);
});
function renderHostTeams(d) {
  const el = $('hostTeams'); el.innerHTML = '';
  const teams = d.teams.filter(t => t.players.length);
  if (!teams.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Waiting for teams to join… 🧭'; el.append(e); return; }
  const wrap = document.createElement('div'); wrap.className = 'chips big'; wrap.style.gridColumn = '1 / -1';
  for (const t of teams) {
    const p = t.players[0];
    wrap.append(chip({ ...p, name: t.name }, () => { if (confirm(`Remove team "${t.name}"?`)) socket.emit('hostKick', p.id); }));
  }
  el.append(wrap);
}
function sortedTeams(d) {
  return d.teams.filter(t => t.players.length || t.progress).sort((a, b) =>
    (a.rank || 999) - (b.rank || 999) || b.progress - a.progress || a.hints - b.hints || a.name.localeCompare(b.name));
}
function renderBoard(d) {
  const el = $('board'); el.innerHTML = '';
  const teams = sortedTeams(d);
  $('hDone').textContent = `${teams.filter(t => t.rank).length}/${teams.length}`;
  teams.forEach((t, i) => {
    const row = document.createElement('div'); row.className = 'board-row' + (t.rank ? ' done' : '');
    const rk = document.createElement('div'); rk.className = 'rk'; rk.textContent = t.rank ? ['🥇', '🥈', '🥉'][t.rank - 1] || '#' + t.rank : i + 1;
    const tn = document.createElement('div'); tn.className = 'tn'; tn.textContent = t.name;
    const chips = document.createElement('div'); chips.className = 'chips';
    void chips;
    const steps = document.createElement('div'); steps.className = 'steps';
    STEP_NAMES.forEach((n, k) => { const s = document.createElement('div'); s.textContent = n; if (k < t.progress) s.className = 'on'; steps.append(s); });
    const hints = document.createElement('div'); hints.className = 'num'; hints.textContent = t.hints;
    const time = document.createElement('div'); time.className = 'num'; time.textContent = t.time ? fmtTime(t.time) : '…';
    row.append(rk, tn, steps, hints, time); el.append(row);
  });
}
socket.on('teamFinished', d => {
  toast(`${['🥇', '🥈', '🥉'][d.rank - 1] || '🎉'} ${d.teamName} escaped in ${fmtTime(d.time)}!`);
  sfx(d.rank <= 3 ? 'win' : 'chest');
});
$('hStart').onclick = () => { initAudio(); sfx('door'); socket.emit('hostStart'); };
$('hLock').onclick = () => socket.emit('hostLock');
$('hChat').onclick = () => socket.emit('hostChat');
$('hMusic').onclick = () => { initAudio(); musicOn = !musicOn; $('hMusic').classList.toggle('off', !musicOn); };
$('hFull').onclick = () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); };
$('hReset').onclick = () => { if (confirm('Reset every team so everyone can play again?')) socket.emit('hostReset'); };
$('hEnd').onclick = () => {
  if (!confirm('End the event for everyone?')) return;
  socket.emit('hostEnd');
  hosting = false; clearInterval(hostTimer);
  try { localStorage.removeItem('solara-host'); } catch (e) {}
  $('resumeHostBtn').classList.add('hidden');
  showScreen('lobby'); preview.running = true; setupPreviewLoop();
};
$('hPodium').onclick = () => {
  if (!hostData) return;
  const top = sortedTeams(hostData).slice(0, 3);
  const steps = $('podiumSteps'); steps.innerHTML = '';
  [1, 0, 2].forEach(i => {
    const t = top[i]; if (!t) return;
    const st = document.createElement('div'); st.className = 'podium-step p' + (i + 1);
    const title = document.createElement('div'); title.className = 'ptitle'; title.textContent = t.name;
    const mem = document.createElement('div'); mem.className = 'pmembers'; mem.textContent = t.players.map(p => p.name).join(', ');
    const block = document.createElement('div'); block.className = 'block';
    const b = document.createElement('b'); b.textContent = i + 1;
    const sp = document.createElement('span'); sp.textContent = t.time ? fmtTime(t.time) : `${t.progress}/6 steps`;
    block.append(b, sp); st.append(title, mem, block); steps.append(st);
  });
  $('podium').classList.remove('hidden');
  sfx('win'); confetti();
};
$('podiumClose').onclick = () => $('podium').classList.add('hidden');

// ======================================================================
//  AUDIO — every sound is synthesised, no audio files needed
// ======================================================================
let actx = null, master, sfxBus, musicBus, noiseBuf;
let soundOn = true, musicOn = true;
function initAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.8; master.connect(actx.destination);
    sfxBus = actx.createGain(); sfxBus.connect(master);
    musicBus = actx.createGain(); musicBus.gain.value = 0.2; musicBus.connect(master);
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startMusic();
  } catch (e) { actx = null; }
}
function tone(freq, dur, o = {}) {
  if (!actx) return;
  const { type = 'sine', vol = 0.15, delay = 0, slideTo = null, attack = 0.01, bus = sfxBus } = o;
  const t = actx.currentTime + delay;
  const osc = actx.createOscillator(), g = actx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(bus); osc.start(t); osc.stop(t + dur + 0.05);
}
function noise(dur, o = {}) {
  if (!actx) return;
  const { type = 'lowpass', freq = 800, freqTo = null, q = 1, vol = 0.2, delay = 0, attack = 0.005, bus = sfxBus } = o;
  const t = actx.currentTime + delay;
  const src = actx.createBufferSource(); src.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(bus);
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
}
const chord = (notes, gap, o) => notes.forEach((f, i) => tone(f, o.dur || 0.4, { ...o, delay: (o.delay || 0) + i * gap }));
function coins(n = 8, delay = 0) { for (let i = 0; i < n; i++) tone(rand(2200, 3800), 0.09, { type: 'square', vol: 0.025, delay: delay + i * 0.05 }); }
function sfx(name) {
  if (!actx || !soundOn) return;
  if (actx.state === 'suspended') actx.resume();
  switch (name) {
    case 'click': tone(1300, 0.04, { type: 'square', vol: 0.03 }); break;
    case 'pop': tone(520, 0.1, { slideTo: 980, vol: 0.09 }); break;
    case 'join': tone(523, 0.14, { type: 'triangle', vol: 0.12 }); tone(784, 0.2, { type: 'triangle', vol: 0.12, delay: 0.1 }); break;
    case 'step': noise(0.08, { freq: rand(380, 620), vol: 0.09 }); break;
    case 'jump': noise(0.22, { type: 'bandpass', freq: 700, freqTo: 2200, vol: 0.05 }); tone(300, 0.15, { slideTo: 520, vol: 0.04 }); break;
    case 'land': noise(0.12, { freq: 260, vol: 0.18 }); break;
    case 'page': noise(0.28, { type: 'highpass', freq: 2500, vol: 0.06, attack: 0.04 }); break;
    case 'key': tone(rand(850, 1100), 0.05, { type: 'square', vol: 0.035 }); noise(0.04, { type: 'highpass', freq: 3000, vol: 0.04 }); break;
    case 'gem1': case 'gem2': case 'gem3': {
      const f = [660, 784, 880][+name[3] - 1];
      tone(f, 1.2, { vol: 0.16 }); tone(f * 2.01, 0.7, { vol: 0.05 }); tone(f * 3.02, 0.4, { vol: 0.02 }); break;
    }
    case 'chest':
      chord([523, 659, 784, 1046], 0.09, { type: 'triangle', vol: 0.13, dur: 0.6 }); coins(12, 0.35);
      tone(1046, 1.4, { vol: 0.08, delay: 0.45 }); break;
    case 'wrong': tone(240, 0.16, { type: 'triangle', vol: 0.16 }); tone(170, 0.3, { type: 'triangle', vol: 0.16, delay: 0.14 }); break;
    case 'door':
      noise(2.4, { freq: 240, vol: 0.32, attack: 0.25 }); tone(48, 2.2, { type: 'sawtooth', vol: 0.05, attack: 0.3 });
      chord([523, 784, 1046], 0.12, { type: 'triangle', vol: 0.1, dur: 0.7, delay: 0.2 }); break;
    case 'mirror': tone(1200, 0.04, { type: 'square', vol: 0.04 }); noise(0.3, { type: 'bandpass', freq: 3200, freqTo: 1100, vol: 0.06, q: 2 }); break;
    case 'beam':
      tone(220, 1.6, { type: 'triangle', slideTo: 880, vol: 0.09 });
      for (let i = 0; i < 12; i++) tone(880 + i * 110, 0.6, { vol: 0.045, delay: 0.1 + i * 0.07 });
      chord([659, 830, 988, 1318], 0.1, { type: 'triangle', vol: 0.1, dur: 0.8, delay: 1 }); break;
    case 'hint': tone(1046, 0.45, { vol: 0.08 }); tone(1318, 0.6, { vol: 0.06, delay: 0.12 }); break;
    case 'room': chord([392, 523, 659], 0.06, { type: 'triangle', vol: 0.06, dur: 1.2 }); noise(0.9, { type: 'bandpass', freq: 600, freqTo: 2400, vol: 0.04, attack: 0.3 }); break;
    case 'plate': tone(130, 0.25, { type: 'triangle', vol: 0.12 }); noise(0.15, { freq: 300, vol: 0.12 }); break;
    case 'win':
      [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, i === 6 ? 1.2 : 0.3, { type: 'triangle', vol: 0.13, delay: i * 0.14 }));
      coins(16, 0.9); break;
  }
}
// ambience + music
const PENTA = [440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5];
const PROG = [[110, [440, 523, 659]], [87.31, [349, 440, 523]], [130.81, [392, 523, 659]], [98, [392, 494, 587]]];
let musicStep = 0, musicNext = 0, melodyIdx = 3;
function startMusic() {
  musicNext = actx.currentTime + 0.3;
  setInterval(() => {
    if (!actx) return;
    while (musicNext < actx.currentTime + 0.25) { scheduleMusic(musicNext); musicNext += 0.29; musicStep++; }
    ambience();
  }, 100);
}
function scheduleMusic(t) {
  if (!musicOn || !(inGame || hosting) || ended) return;
  const delay = t - actx.currentTime;
  const bar = Math.floor(musicStep / 8) % 4, beat = musicStep % 8;
  const [bass, triad] = PROG[bar];
  if (beat === 0 || beat === 4) tone(bass, 0.5, { type: 'triangle', vol: 0.22, delay, bus: musicBus });
  if (beat === 0) triad.forEach(f => tone(f, 2.2, { vol: 0.035, delay, attack: 0.3, bus: musicBus }));
  if (beat % 2 === 1) noise(0.05, { type: 'highpass', freq: 6000, vol: 0.05, delay, bus: musicBus });
  if (Math.random() < 0.6) {
    melodyIdx = Math.max(0, Math.min(PENTA.length - 1, melodyIdx + Math.round(rand(-2, 2))));
    tone(PENTA[melodyIdx], 0.35, { type: 'triangle', vol: 0.09, delay, bus: musicBus });
  }
}
let nextAmb = 0;
function ambience() {
  if (!inGame || hosting || ended || !soundOn || actx.currentTime < nextAmb) return;
  nextAmb = actx.currentTime + rand(2.5, 6);
  const z = me.z;
  if (z > 5 || z < -15) { // jungle birds
    const base = rand(2200, 3400), n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) tone(base, 0.09, { slideTo: base * 1.35, vol: 0.025, delay: i * 0.13 });
  } else if (z > -5) { // cave drips
    tone(rand(900, 1500), 0.14, { slideTo: 350, vol: 0.06 });
  } else { // vault chimes
    tone(PENTA[Math.floor(Math.random() * PENTA.length)] * 2, 1.6, { vol: 0.03 });
  }
}
$('muteBtn').onclick = () => {
  soundOn = !soundOn; initAudio();
  if (sfxBus) sfxBus.gain.value = soundOn ? 1 : 0;
  $('muteBtn').textContent = soundOn ? '🔊' : '🔇';
};
$('musicBtn').onclick = () => {
  musicOn = !musicOn; initAudio();
  $('musicBtn').classList.toggle('off', !musicOn);
};

// ======================================================================
//  TEXTURES (all drawn in code)
// ======================================================================
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.userData.canvas = c;
  return t;
}
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
function speckle(g, w, h, n, dark = 0.12, light = 0.06) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${Math.random() * dark})` : `rgba(255,255,255,${Math.random() * light})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}
function sandstoneTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#7a5e3a'; g.fillRect(0, 0, w, h);
    const bh = 64;
    for (let y = 0, r = 0; y < h; y += bh, r++) {
      for (let x = (r % 2) * -64; x < w; x += 128) {
        g.fillStyle = hsl(36 + rand(-4, 4), 38 + rand(-6, 6), 58 + rand(-6, 5));
        g.fillRect(x + 3, y + 3, 122, bh - 6);
        g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 3, y + 3, 122, 5);
        if (Math.random() < 0.25) { g.fillStyle = hsl(110, 35, 32, 0.35); g.beginPath(); g.ellipse(x + rand(10, 110), y + bh - 8, rand(15, 40), rand(4, 9), 0, 0, 7); g.fill(); }
        if (Math.random() < 0.2) {
          g.strokeStyle = 'rgba(60,40,20,0.4)'; g.lineWidth = 1.5; g.beginPath();
          let cx = x + rand(20, 100), cy = y + 5; g.moveTo(cx, cy);
          for (let k = 0; k < 4; k++) { cx += rand(-12, 12); cy += rand(8, 14); g.lineTo(cx, cy); } g.stroke();
        }
      }
    }
    speckle(g, w, h, 4000);
  });
}
function slabTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#4a4a35'; g.fillRect(0, 0, w, h);
    const s = 128;
    for (let x = 0; x < w; x += s) for (let y = 0; y < h; y += s) {
      g.fillStyle = hsl(38 + rand(-5, 5), 20 + rand(-5, 5), 48 + rand(-6, 6)); g.fillRect(x + 3, y + 3, s - 6, s - 6);
      g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x + 3, y + 3, s - 6, 6);
    }
    g.strokeStyle = hsl(100, 40, 30, 0.5); g.lineWidth = 3;
    for (let i = 0; i < 8; i++) { const x = Math.floor(rand(1, 4)) * s; g.beginPath(); g.moveTo(x, rand(0, h)); g.lineTo(x, rand(0, h)); g.stroke(); }
    speckle(g, w, h, 4000);
  });
}
function caveTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2b3550'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = hsl(225 + rand(-20, 30), 25, rand(18, 38), 0.45);
      g.beginPath(); g.ellipse(rand(0, w), rand(0, h), rand(15, 70), rand(10, 40), rand(0, 3), 0, 7); g.fill();
    }
    for (let i = 0; i < 60; i++) { g.fillStyle = hsl(rand(170, 290), 80, 70, 0.6); g.fillRect(rand(0, w), rand(0, h), 2, 2); }
    speckle(g, w, h, 3000, 0.2, 0.08);
  });
}
function vaultTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#121a33'; g.fillRect(0, 0, w, h);
    const bh = 64;
    for (let y = 0, r = 0; y < h; y += bh, r++) {
      for (let x = (r % 2) * -80; x < w; x += 160) { g.fillStyle = hsl(228 + rand(-6, 6), 30, 22 + rand(-4, 4)); g.fillRect(x + 3, y + 3, 154, bh - 6); }
      if (r % 3 === 0) { g.fillStyle = '#c99a3b'; g.fillRect(0, y, w, 4); }
    }
    g.fillStyle = 'rgba(255,215,120,0.5)';
    for (let i = 0; i < 18; i++) { const x = rand(20, w - 20), y = rand(20, h - 20); g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    speckle(g, w, h, 3000);
  });
}
function starTex() {
  return canvasTex(1024, 1024, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, w * 0.7);
    gr.addColorStop(0, '#24306a'); gr.addColorStop(1, '#0a0f26');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1300; i++) {
      const r = Math.random() < 0.94 ? rand(0.5, 1.4) : rand(1.6, 3);
      g.fillStyle = `rgba(255,${rand(225, 255)},${rand(190, 255)},${rand(0.5, 1)})`;
      g.beginPath(); g.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(255,215,140,0.45)'; g.lineWidth = 2;
    const cons = [[[200, 200], [260, 240], [330, 230], [390, 280], [420, 350]], [[650, 600], [700, 650], [760, 640], [800, 700]], [[600, 180], [640, 260], [700, 230]]];
    for (const c of cons) { g.beginPath(); c.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
  });
}
function grassTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3f8f3a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) {
      g.strokeStyle = hsl(rand(85, 120), 50, rand(28, 55)); g.lineWidth = 1.5;
      const x = rand(0, w), y = rand(0, h); g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-3, 3), y - rand(4, 10)); g.stroke();
    }
  });
}
function skyTex() {
  return canvasTex(512, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3d9cff'); gr.addColorStop(0.65, '#bfe6ff'); gr.addColorStop(1, '#ffe7a8');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const sg = g.createRadialGradient(w * 0.5, h * 0.42, 10, w * 0.5, h * 0.42, 160);
    sg.addColorStop(0, '#fffbe8'); sg.addColorStop(0.25, 'rgba(255,240,180,0.9)'); sg.addColorStop(1, 'rgba(255,230,150,0)');
    g.fillStyle = sg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [cx, cy] of [[90, 120], [400, 90], [330, 220]]) for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(cx + i * 18, cy + Math.sin(i) * 8, rand(16, 26), 0, 7); g.fill(); }
    g.fillStyle = '#2c6b35';
    for (let x = 0; x < w; x += 14) { const th = rand(40, 110); g.beginPath(); g.ellipse(x, h - th / 3, rand(14, 30), th / 2, 0, 0, 7); g.fill(); }
  });
}
function leafTex() {
  return canvasTex(128, 128, (g) => {
    g.translate(64, 64);
    for (let i = 0; i < 5; i++) {
      g.rotate(1.25); g.fillStyle = hsl(rand(95, 130), 55, rand(28, 42));
      g.beginPath(); g.ellipse(0, -28, 12, 30, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.2)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -55); g.stroke();
    }
  });
}
function glowTex(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,220,140,0.6)') {
  return canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, inner); gr.addColorStop(0.3, mid); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}
function flameTex() {
  return canvasTex(128, 256, (g, w, h) => {
    const gr = g.createRadialGradient(64, 180, 4, 64, 160, 90);
    gr.addColorStop(0, 'rgba(255,255,220,1)'); gr.addColorStop(0.25, 'rgba(255,210,90,0.95)');
    gr.addColorStop(0.6, 'rgba(255,110,20,0.6)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(64, 10); g.quadraticCurveTo(120, 150, 100, 210); g.quadraticCurveTo(64, 250, 28, 210); g.quadraticCurveTo(8, 150, 64, 10); g.fill();
  });
}
function textTex(lines, opts = {}) {
  const { w = 1024, h = 512, bg = null, color = '#fff', font = '48px Cinzel, serif', lineH = 64, glow = null } = opts;
  return canvasTex(w, h, (g) => {
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    g.font = font; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (glow) { g.shadowColor = glow; g.shadowBlur = 26; }
    const total = lines.length * lineH;
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 - total / 2 + lineH * (i + 0.5)));
  });
}
function drawAnimal(g, type) {
  g.beginPath();
  if (type === 'bird') {
    g.ellipse(128, 150, 42, 22, -0.1, 0, 7); g.moveTo(186, 128); g.arc(172, 128, 16, 0, 7);
    g.moveTo(186, 122); g.lineTo(210, 130); g.lineTo(186, 136);
    g.moveTo(110, 140); g.quadraticCurveTo(70, 60, 60, 50); g.quadraticCurveTo(110, 80, 150, 138);
    g.moveTo(130, 138); g.quadraticCurveTo(160, 70, 190, 55); g.quadraticCurveTo(175, 100, 160, 142);
    g.moveTo(92, 150); g.lineTo(52, 135); g.lineTo(56, 172); g.closePath();
    g.fill();
  } else if (type === 'snake') {
    g.lineWidth = 24; g.lineCap = 'round'; g.beginPath(); g.moveTo(40, 170);
    for (let x = 40; x <= 190; x += 5) g.lineTo(x, 150 + Math.sin((x - 40) / 24) * 38);
    g.stroke(); g.beginPath(); g.ellipse(205, 150 + Math.sin(150 / 24) * 38 - 6, 24, 17, -0.3, 0, 7); g.fill();
  } else if (type === 'monkey') {
    g.arc(128, 82, 34, 0, 7); g.moveTo(102, 82); g.arc(90, 82, 15, 0, 7); g.moveTo(181, 82); g.arc(166, 82, 15, 0, 7);
    g.moveTo(160, 160); g.ellipse(128, 160, 32, 44, 0, 0, 7); g.fill();
    g.lineWidth = 16; g.lineCap = 'round'; g.beginPath();
    g.moveTo(102, 140); g.lineTo(68, 104); g.moveTo(154, 140); g.lineTo(190, 176);
    g.moveTo(112, 196); g.lineTo(100, 226); g.moveTo(144, 196); g.lineTo(156, 226); g.stroke();
    g.lineWidth = 9; g.beginPath(); g.moveTo(150, 190); g.quadraticCurveTo(220, 210, 210, 160); g.arc(196, 162, 14, 0, -2.5, true); g.stroke();
  } else if (type === 'jaguar') {
    g.ellipse(120, 140, 62, 28, 0, 0, 7); g.moveTo(214, 116); g.arc(190, 116, 24, 0, 7);
    g.moveTo(174, 100); g.lineTo(180, 80); g.lineTo(190, 96); g.moveTo(194, 96); g.lineTo(206, 80); g.lineTo(208, 100);
    for (const lx of [74, 96, 144, 166]) g.rect(lx - 7, 150, 14, 58);
    g.fill(); g.lineWidth = 11; g.lineCap = 'round'; g.beginPath(); g.moveTo(62, 132); g.quadraticCurveTo(20, 120, 34, 76); g.stroke();
  }
}
function carvingTex(type) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#b8915a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#7a5a30'; g.lineWidth = 12; g.strokeRect(8, 8, w - 16, h - 16);
    g.strokeStyle = '#e6c58e'; g.lineWidth = 3; g.strokeRect(20, 20, w - 40, h - 40);
    speckle(g, w, h, 1500);
    g.save(); g.translate(3, 3); g.fillStyle = g.strokeStyle = '#ecd2a0'; drawAnimal(g, type); g.restore();
    g.fillStyle = g.strokeStyle = '#4e3418'; drawAnimal(g, type);
  });
}
function doorTex(base, line) {
  return canvasTex(256, 384, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2500);
    g.strokeStyle = line; g.lineWidth = 8; g.strokeRect(14, 14, w - 28, h - 28);
    g.beginPath(); g.arc(128, 170, 50, 0, 7); g.stroke();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; g.beginPath(); g.moveTo(128 + Math.cos(a) * 64, 170 + Math.sin(a) * 64); g.lineTo(128 + Math.cos(a) * 92, 170 + Math.sin(a) * 92); g.stroke(); }
    g.beginPath(); g.moveTo(128, 145); g.lineTo(150, 170); g.lineTo(128, 195); g.lineTo(106, 170); g.closePath(); g.stroke();
    g.fillStyle = line; g.fillRect(40, 300, 176, 6); g.fillRect(40, 320, 176, 6);
  });
}
function plateTex(kind) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#5c5444'; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill();
    g.strokeStyle = '#d9b26a'; g.lineWidth = 8; g.beginPath(); g.arc(128, 128, 112, 0, 7); g.stroke();
    if (kind === 'sun') {
      g.fillStyle = g.strokeStyle = '#ffcf5c'; g.beginPath(); g.arc(128, 128, 38, 0, 7); g.fill(); g.lineWidth = 9;
      for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; g.beginPath(); g.moveTo(128 + Math.cos(a) * 52, 128 + Math.sin(a) * 52); g.lineTo(128 + Math.cos(a) * 88, 128 + Math.sin(a) * 88); g.stroke(); }
    } else {
      g.fillStyle = '#d8e4ff'; g.beginPath(); g.arc(128, 128, 64, 0, 7); g.fill();
      g.fillStyle = '#5c5444'; g.beginPath(); g.arc(158, 110, 58, 0, 7); g.fill();
    }
  });
}
function planetTex(type) {
  return canvasTex(512, 256, (g, w, h) => {
    if (type === 'mercury') {
      g.fillStyle = '#9a9690'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 160; i++) { const r = rand(3, 16); g.fillStyle = `rgba(60,58,55,${rand(0.2, 0.5)})`; g.beginPath(); g.arc(rand(0, w), rand(0, h), r, 0, 7); g.fill(); }
    } else if (type === 'venus') {
      g.fillStyle = '#ecd08e'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(${rand(200, 250)},${rand(160, 200)},100,0.35)`; g.lineWidth = rand(6, 20); g.beginPath(); const y = rand(0, h); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + rand(-40, 40), w * 0.7, y + rand(-40, 40), w, y); g.stroke(); }
    } else if (type === 'earth') {
      g.fillStyle = '#2468d0'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 14; i++) { g.fillStyle = i % 3 ? '#43a34a' : '#9a8a48'; g.beginPath(); const x = rand(0, w), y = rand(40, h - 40); for (let k = 0; k < 9; k++) { const a = (k / 9) * 6.28; const r = rand(18, 50); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8); } g.fill(); }
      g.fillStyle = '#f3f6ff'; g.fillRect(0, 0, w, 16); g.fillRect(0, h - 16, w, 16);
      for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(rand(0, w), rand(0, h), rand(20, 60), rand(4, 10), 0, 0, 7); g.fill(); }
    } else if (type === 'mars') {
      g.fillStyle = '#c4532f'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${rand(80, 120)},${rand(25, 40)},20,0.35)`; g.beginPath(); g.ellipse(rand(0, w), rand(0, h), rand(10, 50), rand(6, 20), rand(0, 3), 0, 7); g.fill(); }
      g.fillStyle = '#f2e6e0'; g.fillRect(0, 0, w, 10);
    } else if (type === 'jupiter') {
      const cols = ['#d8b48a', '#f1e2c6', '#b97a4a', '#e8cfa6', '#a5643a', '#f4e8d2', '#c99566', '#e0c39c'];
      let y = 0, i = 0; while (y < h) { const bh = rand(14, 34); g.fillStyle = cols[i++ % cols.length]; g.fillRect(0, y, w, bh); y += bh; }
      g.fillStyle = '#b2452c'; g.beginPath(); g.ellipse(w * 0.62, h * 0.64, 34, 18, 0, 0, 7); g.fill();
    }
  });
}
function paperTex(lines) {
  return textTex(lines, { w: 160, h: 200, bg: '#f2e2b8', color: '#6b4a24', font: '20px serif', lineH: 26 });
}

// ======================================================================
//  WORLD BUILDING
// ======================================================================
let renderer, composer, scene, camera;
const colliders = [], interactables = [], occluders = [];
const interactSet = new Set();
const doors = {};
const anim = { flames: [], vines: [], spin: [], bob: [] };
const H = 4, T = 0.3;

function mat(opts) { return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, ...opts }); }
function addMesh(geo, material, x, y, z, parent = scene) { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); parent.add(m); return m; }
function box(w, h, d, material, x, y, z, parent) { return addMesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, parent); }
function addCollider(minX, maxX, minZ, maxZ, active = null) { colliders.push({ minX, maxX, minZ, maxZ, active }); }
function solid(mesh, hw, hd) { addCollider(mesh.position.x - hw, mesh.position.x + hw, mesh.position.z - hd, mesh.position.z + hd); occluders.push(mesh); return mesh; }
function makeInteractable(mesh, label, action) { mesh.userData.label = label; mesh.userData.action = action; interactables.push(mesh); interactSet.add(mesh); }
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
function hitbox(w, h, d, x, y, z, label, action) { const m = box(w, h, d, hitMat, x, y, z); makeInteractable(m, label, action); return m; }
function texMat(tex, rx, ry, extra = {}) {
  const t = tex.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  return mat({ map: t, ...extra });
}
function wall(x1, z1, x2, z2, tex, extra) {
  const len = Math.hypot(x2 - x1, z2 - z1), alongX = Math.abs(z2 - z1) < 1e-6;
  const m = box(alongX ? len : T, H, alongX ? T : len, texMat(tex, len / 3, H / 3, extra), (x1 + x2) / 2, H / 2, (z1 + z2) / 2);
  return solid(m, alongX ? len / 2 : T / 2, alongX ? T / 2 : len / 2);
}
function dividerWall(z, texA, texB) {
  for (const [tex, off] of [[texA, 0.08], [texB, -0.08]]) {
    const m1 = texMat(tex, 5 / 3, H / 3), m2 = texMat(tex, 0.66, 0.33);
    occluders.push(box(5, H, T / 2, m1, -3.5, H / 2, z + off), box(5, H, T / 2, m1, 3.5, H / 2, z + off), box(2, 1, T / 2, m2, 0, 3.5, z + off));
  }
  addCollider(-6, -1, z - T / 2, z + T / 2); addCollider(1, 6, z - T / 2, z + T / 2);
}
function floorAndCeiling(z1, z2, floorTex, ceilMat, rep = 3) {
  const len = Math.abs(z2 - z1), cz = (z1 + z2) / 2;
  addMesh(new THREE.PlaneGeometry(12, len), texMat(floorTex, 12 / rep, len / rep, { roughness: 0.8 }), 0, 0, cz).rotation.x = -Math.PI / 2;
  addMesh(new THREE.PlaneGeometry(12, len), ceilMat, 0, H, cz).rotation.x = Math.PI / 2;
}
function makeDoor(key, z, tex, extra = {}) {
  const g = new THREE.Group();
  const d = box(2, 3, 0.25, mat({ map: tex, roughness: 0.75, ...extra }), 0, 0, 0, g);
  g.position.set(0, 1.5, z);
  scene.add(g);
  occluders.push(d);
  doors[key] = { group: g, open: false };
  addCollider(-1, 1, z - 0.15, z + 0.15, () => !doors[key].open);
}
function pointLight(color, intensity, dist, x, y, z) { const l = new THREE.PointLight(color, intensity, dist, 1.5); l.position.set(x, y, z); scene.add(l); return l; }
function sprite(tex, color, size, x, y, z, opacity = 1, parent = scene) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(size, size, 1); s.position.set(x, y, z); parent.add(s); return s;
}

let TX = {};
function buildWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10140f);
  scene.fog = new THREE.FogExp2(0x1a1810, 0.028);
  scene.add(new THREE.HemisphereLight(0xfff0d0, 0x40382a, 1.0));
  try { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.25; } catch (e) {}

  TX = { sand: sandstoneTex(), slab: slabTex(), cave: caveTex(), vault: vaultTex(), glow: glowTex(), flame: flameTex(), leaf: leafTex(), spark: glowTex('rgba(255,255,255,1)', 'rgba(255,255,255,0.4)') };

  // ---- shell ----
  wall(-6, 15, 6, 15, TX.sand);
  wall(-6, 5, -6, 15, TX.sand); wall(6, 5, 6, 15, TX.sand);
  wall(-6, -5, -6, 5, TX.cave); wall(6, -5, 6, 5, TX.cave);
  wall(-6, -15, -6, -5, TX.vault); wall(6, -15, 6, -5, TX.vault);
  wall(-6, -15, -1, -15, TX.vault); wall(1, -15, 6, -15, TX.vault);
  occluders.push(box(2, 1, T, texMat(TX.vault, 0.66, 0.33), 0, 3.5, -15));
  dividerWall(5, TX.sand, TX.cave);
  dividerWall(-5, TX.cave, TX.vault);

  floorAndCeiling(5, 15, TX.slab, texMat(TX.sand, 4, 3.3, { color: 0xb0a090 }), 2.5);
  floorAndCeiling(-5, 5, TX.cave, texMat(TX.cave, 4, 3.3, { color: 0x8890aa }), 3);
  const st = starTex();
  floorAndCeiling(-15, -5, TX.vault, mat({ map: st, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: 0.8 }), 3);

  makeDoor('doorA', 5, doorTex('#a7814e', '#6a4a22'));
  makeDoor('doorB', -5, doorTex('#4a5677', '#9fb4ff'), { emissive: 0x111833 });
  makeDoor('exit', -15, doorTex('#c9962e', '#fff1b8'), { metalness: 0.6, roughness: 0.35, emissive: 0x332200 });
  const doorLabels = {
    doorA: () => state.doorA ? null : 'A sealed stone door — there\'s a dial beside it',
    doorB: () => state.doorB ? null : 'A heavy stone gate. No handle, no lock…',
    exit: () => state.consoleSolved ? null : 'The Sun Door. The golden tablet nearby controls it.'
  };
  for (const [key, z] of [['doorA', 5], ['doorB', -5], ['exit', -15]]) {
    hitbox(2, 3, 0.45, 0, 1.5, z, doorLabels[key], () => toast(doorLabels[key]()));
  }

  buildEntrance();
  buildCavern();
  buildVault();
  buildOutside();
  buildParticles();
}

// ---------------- ROOM 1: ENTRANCE HALL ----------------
function brazier(x, z, light = true) {
  const stone = mat({ color: 0x8a7350 });
  addMesh(new THREE.CylinderGeometry(0.16, 0.24, 0.8, 10), stone, x, 0.4, z);
  addMesh(new THREE.CylinderGeometry(0.34, 0.2, 0.22, 14), mat({ color: 0x6b4a22, metalness: 0.5, roughness: 0.5 }), x, 0.9, z);
  addCollider(x - 0.3, x + 0.3, z - 0.3, z + 0.3);
  const f = new THREE.Group(); f.position.set(x, 1.0, z); scene.add(f);
  const layers = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.flame, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: i ? 0xffaa55 : 0xffffff }));
    s.scale.set(0.45 - i * 0.08, 0.75 - i * 0.1, 1); s.position.y = 0.3; f.add(s); layers.push(s);
  }
  sprite(TX.glow, 0xff9a40, 1.6, x, 1.25, z, 0.35);
  const l = light ? pointLight(0xffa04a, 7, 9, x, 1.6, z) : null;
  anim.flames.push({ layers, light: l, seed: Math.random() * 10, x, z });
}
function vine(x, z, len) {
  const g = new THREE.Group(); g.position.set(x, H, z); scene.add(g);
  const stem = addMesh(new THREE.CylinderGeometry(0.015, 0.015, len, 5), mat({ color: 0x2f5a25 }), 0, -len / 2, 0, g);
  const leafMat = new THREE.MeshStandardMaterial({ map: TX.leaf, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
  for (let y = 0.2; y < len; y += rand(0.18, 0.3)) {
    const l = addMesh(new THREE.PlaneGeometry(0.28, 0.28), leafMat, rand(-0.05, 0.05), -y, rand(-0.05, 0.05), g);
    l.rotation.set(rand(-0.5, 0.5), rand(0, 6.28), rand(-0.5, 0.5));
  }
  anim.vines.push({ g, seed: Math.random() * 10 });
  return stem;
}
function plant(x, z, s = 1) {
  const leafMat = new THREE.MeshStandardMaterial({ map: TX.leaf, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
  for (let i = 0; i < 7; i++) {
    const l = addMesh(new THREE.PlaneGeometry(0.9 * s, 0.9 * s), leafMat, x + rand(-0.15, 0.15), 0.4 * s + rand(0, 0.3) * s, z + rand(-0.15, 0.15));
    l.rotation.set(rand(-1.2, -0.3), rand(0, 6.28), 0);
  }
}
function buildEntrance() {
  // sunlight pouring through a crack in the ceiling
  const sun = new THREE.SpotLight(0xffe2a0, 28, 10, 0.45, 0.7, 1.2);
  sun.position.set(0.5, 3.95, 9.5); sun.target.position.set(0, 0, 9.5);
  scene.add(sun, sun.target);
  const shaft = addMesh(new THREE.CylinderGeometry(0.5, 1.4, 4, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 0.3, 2, 9.5);
  anim.shaft = shaft;
  addMesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0xfff4cc }), 0.5, 3.99, 9.5).rotation.x = Math.PI / 2;

  // pillars
  for (const [px, pz] of [[-3.6, 7.2], [3.6, 7.2], [-3.6, 12.8], [3.6, 12.8]]) {
    const p = addMesh(new THREE.CylinderGeometry(0.35, 0.38, H, 16), texMat(TX.sand, 1, 1.3), px, H / 2, pz);
    box(0.95, 0.25, 0.95, texMat(TX.sand, 0.3, 0.1), px, H - 0.12, pz);
    box(0.95, 0.25, 0.95, texMat(TX.sand, 0.3, 0.1), px, 0.12, pz);
    solid(p, 0.42, 0.42);
  }
  brazier(-5.1, 6.0); brazier(5.1, 6.0, false); brazier(-5.1, 12.0, false); brazier(5.1, 11.8);
  for (let i = 0; i < 16; i++) {
    const side = i % 4;
    const x = side === 0 ? -5.75 : side === 1 ? 5.75 : rand(-5.5, 5.5);
    const z = side < 2 ? rand(5.5, 14.5) : side === 2 ? 14.75 : 5.25;
    vine(x, z, rand(0.8, 2.2));
  }
  plant(-5.3, 14.3, 1.1); plant(5.3, 14.3, 1.2); plant(-5.4, 8.2, 0.8); plant(5.4, 5.6, 0.9);

  // expedition camp: crate, backpack, rope, lantern
  const crate = box(0.8, 0.6, 0.6, mat({ map: canvasTex(128, 128, (g) => { g.fillStyle = '#8a6236'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#5a3c1c'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 120); g.beginPath(); g.moveTo(4, 4); g.lineTo(124, 124); g.stroke(); }) }), -3.9, 0.3, 14.2);
  solid(crate, 0.4, 0.3);
  box(0.4, 0.5, 0.25, mat({ color: 0x7a4f2a }), -3.0, 0.25, 14.4);
  const rope = addMesh(new THREE.TorusGeometry(0.18, 0.05, 8, 20), mat({ color: 0xc9a46a }), -3.9, 0.65, 14.1); rope.rotation.x = Math.PI / 2;
  const lantern = addMesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8), mat({ color: 0xffe2a0, emissive: 0xffb84a, emissiveIntensity: 1.5 }), -4.2, 0.72, 14.35);
  sprite(TX.glow, 0xffc46a, 0.7, -4.2, 0.75, 14.35, 0.6);

  // riddle tablet on a stone stand
  const standM = texMat(TX.sand, 0.3, 0.4);
  box(0.6, 1.0, 0.4, standM, -2.4, 0.5, 10.4);
  addCollider(-2.75, -2.05, 10.15, 10.65);
  const tablet = box(0.8, 0.55, 0.08, mat({ map: textTex(['☀  ☾  ✦', '≈ ⌇ ≈ ⌇', '◆ ◆ ◆ ◆'], { w: 256, h: 180, bg: '#a88454', color: '#4e3418', font: '34px serif', lineH: 52 }) }), -2.4, 1.25, 10.35);
  tablet.rotation.x = 0.3;
  const riddle = 'Fire wakes first,\nthen the sky above.\nThe sun follows the sky,\nand the forest sleeps last.';
  makeInteractable(tablet, 'Read the stone tablet', () => showNote('Stone tablet', riddle, null, 'Captain Reyes translated the ancient symbols in her journal:', 'tablet'));

  // gem wall (left)
  const panel = box(0.12, 1.3, 2.8, mat({ map: canvasTex(256, 128, (g) => { g.fillStyle = '#8a6a3e'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#ffcf6b'; g.lineWidth = 4; g.strokeRect(8, 8, 240, 112); speckle(g, 256, 128, 800); }) }), -5.8, 1.55, 10);
  occluders.push(panel);
  const GEM_COL = { red: 0xff3b3b, blue: 0x3b8bff, yellow: 0xffd23f, green: 0x3ddc6a };
  anim.gems = {};
  ['yellow', 'red', 'green', 'blue'].forEach((c, i) => {
    const z = 9.0 + i * 0.66;
    addMesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 16), mat({ color: 0x4a3418 }), -5.72, 1.55, z).rotation.z = Math.PI / 2;
    const gem = addMesh(new THREE.OctahedronGeometry(0.15), new THREE.MeshStandardMaterial({ color: GEM_COL[c], emissive: GEM_COL[c], emissiveIntensity: 0.25, roughness: 0.15, metalness: 0.2, flatShading: true }), -5.62, 1.55, z);
    gem.userData.baseX = -5.62;
    const halo = sprite(TX.glow, GEM_COL[c], 0.6, -5.55, 1.55, z, 0.15);
    anim.gems[c] = { gem, halo, pulse: 0 };
    makeInteractable(gem, () => state.chestOpen ? null : `Press the ${c} gem`, () => socket.emit('gem', c));
  });

  // treasure chest (opens when gems are solved)
  const wood = mat({ color: 0x7a4a22, roughness: 0.7 });
  const gold = mat({ color: 0xffc23d, metalness: 0.85, roughness: 0.3, emissive: 0x442200 });
  const cx = 2.3, cz = 10.4;
  box(1.0, 0.5, 0.65, wood, cx, 0.25, cz);
  for (const ox of [-0.42, 0.42]) box(0.08, 0.52, 0.67, gold, cx + ox, 0.26, cz);
  const lid = new THREE.Group(); lid.position.set(cx, 0.5, cz - 0.325); scene.add(lid);
  box(1.04, 0.16, 0.68, wood, 0, 0.08, 0.325, lid);
  for (const ox of [-0.42, 0.42]) box(0.09, 0.18, 0.7, gold, ox, 0.08, 0.325, lid);
  box(0.14, 0.16, 0.05, gold, 0, 0.02, 0.68, lid);
  anim.lid = lid;
  const page = addMesh(new THREE.PlaneGeometry(0.4, 0.3), mat({ map: paperTex(['~~~', '~~~~', '~~']) }), cx, 0.51, cz); page.rotation.x = -Math.PI / 2;
  anim.chestGlow = sprite(TX.glow, 0xffd27a, 1.6, cx, 0.8, cz, 0);
  anim.chestPos = new THREE.Vector3(cx, 0.8, cz);
  const chestHit = hitbox(1.1, 0.9, 0.8, cx, 0.45, cz, () => state.chestOpen ? 'Read the journal page in the chest' : 'A locked treasure chest', () => state.chestOpen
    ? showNote('Captain Reyes\' journal page', 'Day 12 — The door of this hall counts\nthe creatures carved into its walls.\n\nBirds first, then snakes,\nthen monkeys, then jaguars.\n\nOne number for each. — A.R.', null, null, 'chest')
    : toast('The chest is sealed. Four gem-shaped holes run along its lid… maybe the gems on the wall?'));
  solid(chestHit, 0.5, 0.35);

  // animal carvings: 3 birds, 1 snake, 4 monkeys, 2 jaguars  →  3142
  const CARV = [
    [-4.2, 1.9, 14.84, Math.PI, 'monkey'], [-1.6, 2.3, 14.84, Math.PI, 'bird'], [1.6, 1.7, 14.84, Math.PI, 'monkey'], [4.2, 2.1, 14.84, Math.PI, 'jaguar'],
    [-5.84, 2.0, 13.2, Math.PI / 2, 'bird'], [-5.84, 2.6, 6.8, Math.PI / 2, 'monkey'],
    [5.84, 2.3, 13.3, -Math.PI / 2, 'monkey'], [5.84, 2.4, 10.0, -Math.PI / 2, 'snake'], [5.84, 1.9, 6.7, -Math.PI / 2, 'bird'],
    [-3.6, 2.2, 5.17, 0, 'jaguar']
  ];
  const ctex = {};
  for (const [x, y, z, ry, a] of CARV) {
    ctex[a] = ctex[a] || carvingTex(a);
    const c = addMesh(new THREE.PlaneGeometry(0.75, 0.75), mat({ map: ctex[a], roughness: 0.9 }), x, y, z);
    c.rotation.y = ry;
    makeInteractable(c, 'Look at the carving', () => showNote('A stone carving', null, ctex[a].userData.canvas.toDataURL(), `A carving of a ${a}.`));
  }

  // door dial (keypad)
  const kp = box(0.42, 0.55, 0.08, mat({ color: 0x8a6a3e, roughness: 0.6 }), 1.75, 1.45, 5.19);
  addMesh(new THREE.TorusGeometry(0.13, 0.025, 8, 24), mat({ color: 0xffc23d, metalness: 0.8, roughness: 0.3 }), 1.75, 1.5, 5.24);
  anim.kpGem = addMesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff5555 }), 1.75, 1.5, 5.25);
  makeInteractable(kp, () => state.doorA ? null : 'Turn the door dial', () => !state.doorA && showKeypad('doorA', 'Stone Door Dial'));
}

// ---------------- ROOM 2: CRYSTAL CAVERN ----------------
function crystalCluster(x, y, z, color, s = 1, glow = true) {
  const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 5; i++) {
    const c = addMesh(new THREE.OctahedronGeometry(0.15 * s), m, rand(-0.15, 0.15) * s, 0.15 * s, rand(-0.15, 0.15) * s, g);
    c.scale.set(1, rand(2, 3.5), 1); c.rotation.set(rand(-0.5, 0.5), rand(0, 3), rand(-0.5, 0.5));
  }
  if (glow) sprite(TX.glow, color, 1.2 * s, x, y + 0.3 * s, z, 0.3);
  return { g, m };
}
function buildCavern() {
  pointLight(0x6d8cff, 9, 12, 0, 3.4, 1);
  pointLight(0xb47cff, 5, 8, -4, 2.5, -3);
  // stalactites & stalagmites
  const rock = mat({ map: TX.cave, color: 0x9aa4c4 });
  for (let i = 0; i < 26; i++) {
    const x = rand(-5.6, 5.6), z = rand(-4.6, 4.6);
    if (Math.abs(z - 3) < 0.5 || Math.abs(z + 1) < 0.5 || Math.abs(Math.abs(x) - 2) < 0.4) continue; // keep beam path clear-ish
    const h = rand(0.3, 1.0);
    addMesh(new THREE.ConeGeometry(rand(0.08, 0.2), h, 7), rock, x, H - h / 2, z).rotation.x = Math.PI;
  }
  for (const [x, z] of [[-5.3, -4.3], [5.3, -4.4], [-5.4, 0.8], [5.4, -1.8], [-4.8, 4.5]]) {
    const h = rand(0.5, 1.1); addMesh(new THREE.ConeGeometry(0.25, h, 8), rock, x, h / 2, z); addCollider(x - 0.25, x + 0.25, z - 0.25, z + 0.25);
  }
  const ccols = [0x7af7ff, 0xb47cff, 0x5cffb0, 0xff7ad9];
  for (const [x, z, s] of [[-5.3, -4.2, 1.2], [5.3, -4.3, 1.1], [-5.3, 1.2, 0.8], [5.4, -2.6, 0.9], [-1.4, 4.6, 0.7], [1.4, 4.6, 0.7], [-5.4, 4.4, 1]]) {
    crystalCluster(x, 0, z, ccols[Math.floor(Math.random() * ccols.length)], s);
  }

  // note on a rock
  const rockSeat = addMesh(new THREE.DodecahedronGeometry(0.45), rock, -4.2, 0.3, 4.2); solid(rockSeat, 0.4, 0.4);
  const note = addMesh(new THREE.PlaneGeometry(0.34, 0.42), mat({ map: paperTex(['~~~~', '~~~~~', '~~~']) }), -4.2, 0.76, 4.15);
  note.rotation.x = -1.1;
  makeInteractable(note, 'Read Captain Reyes\' note', () => showNote('A note on a rock',
    'Day 13 — This cave drinks sunlight!\n\nThe sun-mirror on the wall shines a beam.\nTurn the four mirrors to guide the light\ninto the great crystal on the far wall.\n\nThen watch the walls… — A.R.', null, null, 'cave'));

  // beam source (sun disc on the left wall)
  const disc = addMesh(new THREE.CircleGeometry(0.32, 32), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }), -5.83, 1.3, 3);
  disc.rotation.y = Math.PI / 2;
  addMesh(new THREE.TorusGeometry(0.36, 0.06, 8, 32), mat({ color: 0xffc23d, metalness: 0.8, roughness: 0.3, emissive: 0x553300 }), -5.82, 1.3, 3).rotation.y = Math.PI / 2;
  sprite(TX.glow, 0xffd27a, 1.6, -5.6, 1.3, 3, 0.8);
  pointLight(0xffd27a, 3, 5, -5.2, 1.4, 3);
  makeInteractable(disc, 'The sun-mirror', () => toast('Sunlight from far above is focused into a beam here.'));

  // mirrors
  anim.mirrors = [];
  const mirrorTex = canvasTex(128, 128, (g) => {
    const gr = g.createLinearGradient(0, 0, 128, 128); gr.addColorStop(0, '#e9f6ff'); gr.addColorStop(0.5, '#9fb8d0'); gr.addColorStop(1, '#dfeeff');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.moveTo(20, 128); g.lineTo(50, 128); g.lineTo(128, 50); g.lineTo(128, 20); g.fill();
    g.beginPath(); g.moveTo(0, 70); g.lineTo(0, 85); g.lineTo(85, 0); g.lineTo(70, 0); g.fill();
  });
  BEAM.mirrors.forEach((p, i) => {
    const ped = addMesh(new THREE.CylinderGeometry(0.22, 0.3, 0.8, 12), mat({ map: TX.cave, color: 0xb0b8d0 }), p.x, 0.4, p.z);
    addCollider(p.x - 0.32, p.x + 0.32, p.z - 0.32, p.z + 0.32);
    const piv = new THREE.Group(); piv.position.set(p.x, 1.3, p.z); scene.add(piv);
    const frame = mat({ color: 0xffc23d, metalness: 0.85, roughness: 0.3 });
    box(0.78, 0.78, 0.06, frame, 0, 0, 0, piv);
    const glass = box(0.66, 0.66, 0.08, new THREE.MeshStandardMaterial({ map: mirrorTex, emissive: 0xffffff, emissiveMap: mirrorTex, emissiveIntensity: 0.45, metalness: 0.9, roughness: 0.1 }), 0, 0, 0, piv);
    box(0.06, 0.45, 0.06, frame, 0, -0.6, 0, piv);
    piv.rotation.y = state.mirrors ? (state.mirrors[i] ? Math.PI / 4 : -Math.PI / 4) : 0;
    anim.mirrors.push(piv);
    const lbl = () => !state.doorA ? null : state.beamSolved ? 'The mirror is locked in place' : 'Turn the mirror';
    piv.children.forEach(c => makeInteractable(c, lbl, () => !state.beamSolved && socket.emit('mirror', i)));
    makeInteractable(ped, lbl, () => !state.beamSolved && socket.emit('mirror', i));
    void glass;
  });

  // target: the great crystal
  const big = crystalCluster(5.35, 0.5, 3, 0x7af7ff, 2.2, false);
  box(0.8, 0.5, 1.0, rock, 5.5, 0.25, 3);
  addCollider(4.9, 6, 2.4, 3.6);
  anim.bigCrystal = big;
  anim.bigGlow = sprite(TX.glow, 0x7af7ff, 3, 5.3, 1.4, 3, 0.15);
  anim.bigLight = pointLight(0x7af7ff, 0, 10, 4.8, 1.6, 3);
  big.g.children.forEach(c => makeInteractable(c, 'The great crystal', () => toast(state.beamSolved ? 'The crystal hums with sunlight!' : 'A giant crystal. It looks like it wants light…')));

  // beam group (rebuilt on state changes)
  anim.beam = new THREE.Group(); scene.add(anim.beam);
  anim.beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  anim.beamGlowMat = new THREE.MeshBasicMaterial({ color: 0xffb84a, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
  anim.beamEnd = sprite(TX.glow, 0xfff1b0, 0.8, 0, 1.3, 0, 0.9);

  // glyph message (lights up when the beam is solved)
  const gTex = textTex(['THE TWIN STONES AWAKEN', 'TWO EXPLORERS MUST', 'STAND AS ONE'], { w: 1024, h: 340, color: '#ffe7a0', font: 'bold 70px Cinzel, serif', lineH: 96, glow: '#ff9d00' });
  anim.glyphs = [];
  for (const x of [-3.5, 3.5]) {
    const m = addMesh(new THREE.PlaneGeometry(4, 1.33), new THREE.MeshBasicMaterial({ map: gTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), x, 2.6, -4.82);
    anim.glyphs.push(m);
    makeInteractable(m, () => state.beamSolved ? 'Read the glowing writing' : null, () => showGlyph('THE TWIN STONES AWAKEN.\nTWO EXPLORERS MUST STAND AS ONE —\nONE ON THE SUN, ONE ON THE MOON.'));
  }

  // twin pressure stones
  anim.plates = {};
  for (const [kind, x] of [['sun', -2.5], ['moon', 2.5]]) {
    const pt = plateTex(kind);
    const p = addMesh(new THREE.CylinderGeometry(0.85, 0.9, 0.08, 40), [mat({ color: 0x5c5444 }), mat({ map: pt, emissive: 0xffffff, emissiveMap: pt, emissiveIntensity: 0.1 }), mat({ color: 0x5c5444 })], x, 0.04, -3);
    anim.plates[kind] = { mesh: p, wasOn: false, glow: sprite(TX.glow, kind === 'sun' ? 0xffcf5c : 0xbcd2ff, 2.2, x, 0.3, -3, 0) };
    makeInteractable(p, kind === 'sun' ? 'A sun stone' : 'A moon stone', () => toast(`A round stone with a ${kind} carved into it. It sinks a little when you stand on it.`));
  }
}

// ---------------- ROOM 3: CELESTIAL VAULT ----------------
const PLANETS = [
  { key: 'jupiter', r: 0.42, x: -4.2, z: -7.3, letter: 'T', desc: 'A giant planet with orange and cream stripes and a big red spot.' },
  { key: 'mercury', r: 0.12, x: 4.2, z: -7.3, letter: 'Q', desc: 'A small, grey planet covered in craters.' },
  { key: 'earth', r: 0.24, x: -4.4, z: -12.6, letter: 'E', desc: 'A blue planet with green land and swirling white clouds. It looks like home!' },
  { key: 'venus', r: 0.23, x: 4.4, z: -12.6, letter: 'U', desc: 'A pale yellow planet wrapped in thick clouds.' },
  { key: 'mars', r: 0.17, x: 2.9, z: -9.8, letter: 'S', desc: 'A dusty, rusty red planet.' }
];
function buildVault() {
  pointLight(0xffd9a0, 8, 12, 0, 3.6, -10);
  pointLight(0x6d8cff, 5, 8, -4, 2.8, -8);
  pointLight(0x9d7cff, 4, 8, 4, 2.8, -12.5);
  const gold = mat({ color: 0xffc23d, metalness: 0.9, roughness: 0.25, emissive: 0x442200 });

  // armillary sphere with a little golden sun
  box(0.9, 0.9, 0.9, texMat(TX.vault, 0.3, 0.3), 0, 0.45, -10);
  addCollider(-0.5, 0.5, -10.5, -9.5);
  const arm = new THREE.Group(); arm.position.set(0, 1.55, -10); scene.add(arm);
  addMesh(new THREE.SphereGeometry(0.16, 20, 16), new THREE.MeshBasicMaterial({ color: 0xffe080 }), 0, 0, 0, arm);
  sprite(TX.glow, 0xffc040, 1.4, 0, 1.55, -10, 0.7);
  const rings = [];
  for (const [r, tilt] of [[0.42, 0.3], [0.55, -0.6], [0.66, 1.2]]) {
    const ring = new THREE.Group(); ring.rotation.x = tilt; arm.add(ring);
    addMesh(new THREE.TorusGeometry(r, 0.02, 8, 48), gold, 0, 0, 0, ring).rotation.x = Math.PI / 2;
    addMesh(new THREE.SphereGeometry(0.04, 10, 8), mat({ color: 0x9fc4ff, emissive: 0x3355aa }), r, 0, 0, ring);
    rings.push(ring);
  }
  anim.rings = rings;
  const note = addMesh(new THREE.PlaneGeometry(0.34, 0.42), mat({ map: paperTex(['~~~~', '~~~~~', '~~~']) }), 0, 0.91, -9.6);
  note.rotation.x = -Math.PI / 2;
  const vaultNote = () => showNote('A note on the golden rings', 'Day 14 — The Sun Door needs a password.\n\nEach planet hides a letter.\nLine them up the way they travel\naround the Sun — nearest first.\n\nSo close to the Sunstone now! — A.R.', null, null, 'vault');
  makeInteractable(note, 'Read Captain Reyes\' last note', vaultNote);
  arm.traverse(o => o.isMesh && makeInteractable(o, 'Read Captain Reyes\' last note', vaultNote));

  // planets
  anim.planets = [];
  const pedMat = texMat(TX.vault, 0.4, 0.4);
  for (const p of PLANETS) {
    addMesh(new THREE.CylinderGeometry(0.3, 0.38, 1.1, 20), pedMat, p.x, 0.55, p.z);
    addMesh(new THREE.CylinderGeometry(0.36, 0.36, 0.06, 20), gold, p.x, 1.12, p.z);
    addCollider(p.x - 0.38, p.x + 0.38, p.z - 0.38, p.z + 0.38);
    const tex = planetTex(p.key);
    const pl = addMesh(new THREE.SphereGeometry(p.r, 32, 20), mat({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25, roughness: 0.8 }), p.x, 1.2 + p.r + 0.05, p.z);
    anim.planets.push(pl);
    sprite(TX.glow, 0xbcd2ff, p.r * 5, p.x, 1.25 + p.r, p.z, 0.18);
    const plaque = addMesh(new THREE.PlaneGeometry(0.28, 0.28), mat({ map: textTex([p.letter], { w: 128, h: 128, bg: '#8a6420', color: '#fff0b8', font: 'bold 86px Cinzel, serif', lineH: 100 }), metalness: 0.5, roughness: 0.4, emissive: 0x332200 }), 0, 0.75, 0);
    const dir = new THREE.Vector3(-p.x, 0, -10 - p.z).normalize();
    plaque.position.set(p.x + dir.x * 0.37, 0.75, p.z + dir.z * 0.37);
    plaque.lookAt(p.x + dir.x * 2, 0.75, p.z + dir.z * 2);
    const inspect = () => showNote('A planet on a pedestal', null, tex.userData.canvas.toDataURL(), `${p.desc}\n\nThe golden plaque on its pedestal shows the letter "${p.letter}".`);
    makeInteractable(pl, 'Inspect the planet', inspect);
    makeInteractable(plaque, 'Read the plaque', inspect);
  }

  // treasure piles
  for (const [x, z] of [[-5.2, -14.3], [5.2, -5.7], [-5.3, -5.6]]) {
    for (let i = 0; i < 26; i++) {
      const c = addMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 12), gold, x + rand(-0.35, 0.35), rand(0.01, 0.25), z + rand(-0.35, 0.35));
      c.rotation.set(rand(-0.6, 0.6), 0, rand(-0.6, 0.6));
    }
    addCollider(x - 0.4, x + 0.4, z - 0.4, z + 0.4);
  }

  // golden tablet (password console) next to the Sun Door
  box(0.7, 1.0, 0.5, texMat(TX.vault, 0.3, 0.3), 2.6, 0.5, -14.4);
  addCollider(2.25, 2.95, -14.65, -14.15);
  const scrTex = textTex(['SPEAK THE', 'PASSWORD', '_ _ _ _ _'], { w: 512, h: 320, bg: '#3a2608', color: '#ffd77a', font: 'bold 54px Cinzel, serif', lineH: 82, glow: '#ff9d00' });
  const screen = addMesh(new THREE.PlaneGeometry(0.62, 0.4), new THREE.MeshBasicMaterial({ map: scrTex }), 2.6, 1.2, -14.25);
  screen.rotation.x = -0.5;
  box(0.72, 0.05, 0.5, gold, 2.6, 1.0, -14.4);
  anim.consoleScreen = screen; anim.consoleTexOrig = scrTex;
  sprite(TX.glow, 0xffc040, 1.2, 2.6, 1.3, -14.1, 0.35);
  makeInteractable(screen, () => state.consoleSolved ? 'The Sun Door is open — go!' : 'Use the golden tablet', () => !state.consoleSolved && showWordInput());
}

// ---------------- OUTSIDE (exit) ----------------
function buildOutside() {
  const leafy = mat({ map: canvasTex(256, 256, (g) => { g.fillStyle = '#245a2a'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 300; i++) { g.fillStyle = hsl(rand(90, 135), 50, rand(22, 45)); g.beginPath(); g.ellipse(rand(0, 256), rand(0, 256), rand(6, 16), rand(3, 7), rand(0, 3), 0, 7); g.fill(); } }) });
  solid(box(T, H, 5, leafy, -1.6, H / 2, -17.5), T / 2, 2.5);
  solid(box(T, H, 5, leafy, 1.6, H / 2, -17.5), T / 2, 2.5);
  solid(box(3.2, H, T, new THREE.MeshBasicMaterial({ map: skyTex() }), 0, H / 2, -20), 1.6, T / 2);
  addMesh(new THREE.PlaneGeometry(3.2, 5), texMat(grassTex(), 2, 3), 0, 0.01, -17.5).rotation.x = -Math.PI / 2;
  addMesh(new THREE.PlaneGeometry(3.2, 5), new THREE.MeshBasicMaterial({ color: 0x9fd6ff }), 0, H, -17.5).rotation.x = Math.PI / 2;
  anim.exitLight = pointLight(0xfff0c8, 0, 16, 0, 2.5, -17);
  // the Sunstone
  anim.sunstone = addMesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffa000, emissiveIntensity: 2, roughness: 0.1, flatShading: true }), 0, 1.4, -18.6);
  sprite(TX.glow, 0xffd27a, 2.2, 0, 1.4, -18.6, 0.8);
}

// ---------------- PARTICLES & EFFECTS ----------------
const bursts = [];
function buildParticles() {
  // floating dust / fireflies everywhere
  const N = 420, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  anim.dustVel = [];
  for (let i = 0; i < N; i++) {
    const z = rand(-15, 15);
    pos.set([rand(-5.7, 5.7), rand(0.2, 3.8), z], i * 3);
    const c = new THREE.Color(z > 5 ? 0xffd48a : z > -5 ? 0x9ff0ff : 0xffe8b0);
    col.set([c.r, c.g, c.b], i * 3);
    anim.dustVel.push([rand(-0.08, 0.08), rand(-0.03, 0.06), rand(-0.08, 0.08), rand(0, 6.28)]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  anim.dust = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.06, map: TX.spark, vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(anim.dust);

  // embers rising from braziers
  const E = 80, ep = new Float32Array(E * 3);
  anim.emberData = [];
  for (let i = 0; i < E; i++) {
    const f = anim.flames[i % anim.flames.length];
    anim.emberData.push({ f, life: rand(0, 1.5), vy: rand(0.4, 1), vx: rand(-0.1, 0.1) });
    ep.set([f.x, 1.2, f.z], i * 3);
  }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  anim.embers = new THREE.Points(eg, new THREE.PointsMaterial({ size: 0.05, map: TX.spark, color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(anim.embers);
}
function burst(pos, color, count = 70, speed = 2.5) {
  const p = new Float32Array(count * 3), v = [];
  for (let i = 0; i < count; i++) {
    p.set([pos.x, pos.y, pos.z], i * 3);
    const dir = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(0.4, 1) * speed);
    v.push(dir);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ size: 0.1, map: TX.spark, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const pts = new THREE.Points(geo, m); scene.add(pts);
  bursts.push({ pts, v, life: 0 });
}
function updateEffects(dt, t) {
  const dp = anim.dust.geometry.attributes.position;
  for (let i = 0; i < anim.dustVel.length; i++) {
    const v = anim.dustVel[i];
    let x = dp.getX(i) + (v[0] + Math.sin(t * 0.5 + v[3]) * 0.05) * dt, y = dp.getY(i) + v[1] * dt, z = dp.getZ(i) + v[2] * dt;
    if (y > 3.9) y = 0.2; if (y < 0.1) y = 3.8;
    if (x > 5.8) x = -5.8; if (x < -5.8) x = 5.8;
    dp.setXYZ(i, x, y, z);
  }
  dp.needsUpdate = true;
  const ep = anim.embers.geometry.attributes.position;
  anim.emberData.forEach((e, i) => {
    e.life += dt;
    if (e.life > 1.6) { e.life = 0; ep.setXYZ(i, e.f.x + rand(-0.1, 0.1), 1.15, e.f.z + rand(-0.1, 0.1)); }
    else ep.setXYZ(i, ep.getX(i) + e.vx * dt + Math.sin(t * 3 + i) * 0.003, ep.getY(i) + e.vy * dt, ep.getZ(i));
  });
  ep.needsUpdate = true;
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]; b.life += dt;
    const a = b.pts.geometry.attributes.position;
    b.v.forEach((v, k) => { v.y -= 2.2 * dt; v.multiplyScalar(0.985); a.setXYZ(k, a.getX(k) + v.x * dt, a.getY(k) + v.y * dt, a.getZ(k) + v.z * dt); });
    a.needsUpdate = true;
    b.pts.material.opacity = Math.max(0, 1 - b.life / 1.8);
    if (b.life > 1.8) { scene.remove(b.pts); b.pts.geometry.dispose(); bursts.splice(i, 1); }
  }
  // flames flicker
  for (const f of anim.flames) {
    f.layers.forEach((s, k) => {
      const n = Math.sin(t * (9 + k * 3) + f.seed) * 0.08 + Math.sin(t * 23 + f.seed * 2) * 0.04;
      s.scale.set((0.45 - k * 0.08) * (1 + n), (0.75 - k * 0.1) * (1 + n * 1.5), 1);
    });
    if (f.light) f.light.intensity = 6.5 + Math.sin(t * 11 + f.seed) * 0.8 + Math.random() * 0.6;
  }
  for (const v of anim.vines) v.g.rotation.z = Math.sin(t * 0.8 + v.seed) * 0.05;
  anim.shaft.material.opacity = 0.06 + Math.sin(t * 0.7) * 0.02;
}

function updateBeam() {
  const g = anim.beam;
  while (g.children.length) { const c = g.children.pop(); c.geometry.dispose(); }
  if (!state.mirrors) return;
  const { pts, hit } = traceBeam(state.mirrors);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1); if (len < 0.01) continue;
    for (const [r, m] of [[0.035, anim.beamMat], [0.11, anim.beamGlowMat]]) {
      const c = addMesh(new THREE.CylinderGeometry(r, r, len, 8, 1, true), m, (x1 + x2) / 2, 1.3, (z1 + z2) / 2, g);
      if (Math.abs(x2 - x1) > 0.01) c.rotation.z = Math.PI / 2; else c.rotation.x = Math.PI / 2;
    }
  }
  const end = pts[pts.length - 1];
  anim.beamEnd.position.set(end[0], 1.3, end[1]);
  anim.beamHit = hit;
}

// ======================================================================
//  PLAYER, CONTROLS, CAMERA
// ======================================================================
const me = { x: 0, z: 12.5, y: 0, vy: 0, yaw: 0, pitch: 0, bob: 0, stepDist: 0 };
const R = 0.3;
const keys = new Set();
let pointerLocked = false, uiOpen = false, shake = 0;
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const look = { id: null, lx: 0, ly: 0 };

function collide() {
  for (let pass = 0; pass < 2; pass++) for (const c of colliders) {
    if (c.active && !c.active()) continue;
    const nx = Math.max(c.minX, Math.min(me.x, c.maxX)), nz = Math.max(c.minZ, Math.min(me.z, c.maxZ));
    const dx = me.x - nx, dz = me.z - nz, d2 = dx * dx + dz * dz;
    if (d2 >= R * R) continue;
    if (d2 > 1e-9) { const d = Math.sqrt(d2); me.x = nx + (dx / d) * R; me.z = nz + (dz / d) * R; }
    else {
      const pushes = [[me.x - c.minX + R, -1, 0], [c.maxX - me.x + R, 1, 0], [me.z - c.minZ + R, 0, -1], [c.maxZ - me.z + R, 0, 1]];
      pushes.sort((a, b) => a[0] - b[0]);
      me.x += pushes[0][1] * pushes[0][0]; me.z += pushes[0][2] * pushes[0][0];
    }
  }
}
function jump() { if (me.y <= 0.001 && !uiOpen) { me.vy = 4.6; sfx('jump'); } }
function updateMovement(dt) {
  let f = 0, s = 0;
  if (!uiOpen && document.activeElement !== $('chatInput')) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
    f += -joy.y; s += joy.x;
  }
  const len = Math.hypot(f, s); if (len > 1) { f /= len; s /= len; }
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(joy.x, joy.y) > 0.92;
  const speed = run ? 4.8 : 3.0;
  const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw), rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
  const ox = me.x, oz = me.z;
  me.x += (fx * f + rx * s) * speed * dt; collide();
  me.z += (fz * f + rz * s) * speed * dt; collide();
  // jumping
  if (me.y > 0 || me.vy > 0) {
    me.vy -= 13 * dt; me.y += me.vy * dt;
    if (me.y <= 0) { me.y = 0; me.vy = 0; sfx('land'); }
  }
  const moved = Math.hypot(me.x - ox, me.z - oz);
  if (me.y === 0 && moved > 0.001) {
    me.bob += moved * 3.2; me.stepDist += moved;
    if (me.stepDist > (run ? 1.3 : 1.0)) { me.stepDist = 0; sfx('step'); }
  }
  shake = Math.max(0, shake - dt * 0.8);
  const sx = (Math.random() - 0.5) * shake * 0.08, sy = (Math.random() - 0.5) * shake * 0.08;
  camera.position.set(me.x + sx, 1.6 + me.y + (moved > 0.001 && me.y === 0 ? Math.sin(me.bob) * 0.04 : 0) + sy, me.z);
  camera.rotation.set(me.pitch, me.yaw, 0, 'YXZ');
}

document.addEventListener('mousemove', e => {
  if (!pointerLocked || uiOpen) return;
  me.yaw -= e.movementX * 0.0022;
  me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - e.movementY * 0.0022));
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = !!renderer && document.pointerLockElement === renderer.domElement;
  updateClickOverlay();
});
let dragLook = false, lockFails = 0;
function lockPointer() {
  if (isTouch || !renderer || dragLook) return;
  try { const r = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => lockFailed()); } catch (e) { lockFailed(); }
}
// some browsers / embedded pages block mouse capture: fall back to click-and-drag to look
function lockFailed() {
  if (++lockFails < 2 || dragLook) return;
  dragLook = true; updateClickOverlay();
  toast('Hold the mouse button and drag to look around');
}
document.addEventListener('pointerlockerror', () => { lockFails++; lockFailed(); });
document.addEventListener('mousemove', e => {
  if (!dragLook || !(e.buttons & 1) || uiOpen || !inGame) return;
  me.yaw -= e.movementX * 0.004;
  me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - e.movementY * 0.004));
});
function updateClickOverlay() {
  $('clickToPlay').classList.toggle('hidden', isTouch || dragLook || pointerLocked || uiOpen || !inGame || ended || document.activeElement === $('chatInput'));
}
$('clickToPlay').addEventListener('click', () => { initAudio(); lockPointer(); });

document.addEventListener('keydown', e => {
  if (!inGame || ended) return;
  if (document.activeElement === $('chatInput')) {
    if (e.key === 'Enter') {
      const t = $('chatInput').value.trim();
      if (t) socket.emit('chat', t);
      $('chatInput').value = ''; $('chatInput').blur(); $('chatInput').classList.remove('show');
      lockPointer();
    } else if (e.key === 'Escape') { $('chatInput').blur(); $('chatInput').classList.remove('show'); }
    return;
  }
  if (uiOpen) {
    if (e.key === 'Escape') closeModal();
    else if (keypadState && /^[0-9]$/.test(e.key)) keypadPress(e.key);
    else if (keypadState && e.key === 'Backspace') keypadPress('C');
    else if (keypadState && e.key === 'Enter') keypadPress('OK');
    return;
  }
  keys.add(e.code);
  if (e.code === 'KeyE') interact();
  if (e.code === 'Space') { e.preventDefault(); jump(); }
  if (e.code === 'KeyH') showHint();
  if (e.code === 'KeyJ') showJournal();
  if (e.code === 'Digit1') sendEmote('wave');
  if (e.code === 'Digit2') sendEmote('cheer');
  if (e.code === 'Digit3') sendEmote('think');
  if (e.code === 'KeyT' || e.key === 'Enter') { e.preventDefault(); openChat(); }
});
document.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
$('chatInput').addEventListener('blur', updateClickOverlay);
function openChat() {
  if (document.pointerLockElement) document.exitPointerLock();
  $('chatInput').classList.add('show'); $('chatInput').focus();
}
let lastEmote = 0;
function sendEmote(e) {
  if (performance.now() - lastEmote < 1200) return;
  lastEmote = performance.now();
  socket.emit('emote', e);
}
document.querySelectorAll('#emotes button').forEach(b => b.addEventListener('click', () => { initAudio(); sendEmote(b.dataset.emote); }));

function setupTouch() {
  if (!isTouch) return;
  $('touchUI').classList.remove('hidden');
  const el = renderer.domElement;
  el.addEventListener('touchstart', e => {
    initAudio();
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.42 && joy.id === null) {
        joy.id = t.identifier; joy.ox = t.clientX; joy.oy = t.clientY;
        const b = $('joyBase'); b.style.left = (t.clientX - 65) + 'px'; b.style.top = (t.clientY - 65) + 'px'; b.style.bottom = 'auto';
      } else if (look.id === null) { look.id = t.identifier; look.lx = t.clientX; look.ly = t.clientY; }
    }
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) {
        let dx = (t.clientX - joy.ox) / 55, dy = (t.clientY - joy.oy) / 55;
        const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
        joy.x = dx; joy.y = dy;
        $('joyKnob').style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
      } else if (t.identifier === look.id) {
        me.yaw -= (t.clientX - look.lx) * 0.006;
        me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - (t.clientY - look.ly) * 0.006));
        look.lx = t.clientX; look.ly = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });
  const end = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) {
        joy.id = null; joy.x = joy.y = 0; $('joyKnob').style.transform = '';
        const b = $('joyBase'); b.style.left = ''; b.style.top = ''; b.style.bottom = '';
      }
      if (t.identifier === look.id) look.id = null;
    }
  };
  el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  $('tUse').addEventListener('click', interact);
  $('tJump').addEventListener('click', jump);
  $('tChat').addEventListener('click', openChat);
}

// ======================================================================
//  INTERACTION
// ======================================================================
const raycaster = new THREE.Raycaster(); raycaster.far = 3.3;
const CENTER = new THREE.Vector2(0, 0);
let rayTargets = [], focused = null;
const labelOf = o => (typeof o.userData.label === 'function' ? o.userData.label() : o.userData.label);
function updateInteraction() {
  focused = null;
  if (!uiOpen) {
    raycaster.setFromCamera(CENTER, camera);
    for (const h of raycaster.intersectObjects(rayTargets, false)) {
      if (interactSet.has(h.object)) {
        const lbl = labelOf(h.object);
        if (lbl) { focused = { obj: h.object, label: lbl }; break; }
        continue;
      }
      break;
    }
  }
  const p = $('prompt');
  if (focused) {
    p.textContent = focused.label;
    const k = document.createElement('kbd'); k.textContent = isTouch ? 'USE' : 'E'; p.append(k);
    p.classList.remove('hidden');
  } else p.classList.add('hidden');
  $('crosshair').classList.toggle('active', !!focused);
}
function interact() {
  if (!focused || uiOpen) return;
  const a = focused.obj.userData.action;
  if (typeof a === 'function') { sfx('click'); a(); }
}

// ======================================================================
//  MODALS: notes, keypad, password, hints, journal
// ======================================================================
let keypadState = null;
const journal = [];
function updateJournalCount() { $('journalCount').textContent = journal.length; }
function openModal(title) {
  uiOpen = true; keys.clear(); joy.x = joy.y = 0;
  if (document.pointerLockElement) document.exitPointerLock();
  $('mTitle').textContent = title; $('mBody').innerHTML = '';
  $('modal').classList.remove('hidden');
  updateClickOverlay();
  return $('mBody');
}
function closeModal() {
  if (!uiOpen) return;
  uiOpen = false; keypadState = null;
  $('modal').classList.add('hidden');
  if (inGame && !ended) lockPointer();
  updateClickOverlay();
}
$('modalClose').onclick = closeModal;
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });

function showNote(title, paperText, img, desc, journalKey) {
  sfx('page');
  const body = openModal(title);
  if (img) { const i = document.createElement('img'); i.src = img; i.className = 'modal-img'; body.append(i); }
  if (desc) { const d = document.createElement('p'); d.className = 'desc'; d.textContent = desc; body.append(d); }
  if (paperText) { const p = document.createElement('div'); p.className = 'paper'; p.textContent = paperText; body.append(p); }
  if (journalKey && !journal.some(j => j.key === journalKey)) {
    journal.push({ key: journalKey, title, text: paperText }); updateJournalCount();
    toast('📖 Added to your journal (press J)');
  }
}
function showGlyph(text) {
  sfx('page');
  const body = openModal('Glowing temple writing');
  const d = document.createElement('div'); d.className = 'glyph'; d.textContent = text; body.append(d);
  if (!journal.some(j => j.key === 'glyph')) { journal.push({ key: 'glyph', title: 'Glowing temple writing', text }); updateJournalCount(); }
}
function showJournal() {
  if (!inGame || ended) return;
  const body = openModal('📖 Your Journal');
  if (!journal.length) { const p = document.createElement('p'); p.className = 'desc'; p.textContent = 'Nothing yet! Notes and clues you read will be saved here.'; body.append(p); return; }
  for (const j of journal) {
    const e = document.createElement('div'); e.className = 'journal-entry';
    const h = document.createElement('h4'); h.textContent = j.title;
    const p = document.createElement('div'); p.className = j.key === 'glyph' ? 'glyph' : 'paper'; p.textContent = j.text;
    e.append(h, p); body.append(e);
  }
}
$('journalBtn').onclick = () => { initAudio(); showJournal(); };

function showKeypad(lock, title) {
  const body = openModal(title);
  keypadState = { lock, value: '' };
  const p = document.createElement('p'); p.className = 'desc'; p.style.textAlign = 'center'; p.textContent = 'Enter a 4-digit code'; body.append(p);
  const disp = document.createElement('div'); disp.className = 'keypad-display'; disp.id = 'kpDisp';
  for (let i = 0; i < 4; i++) disp.append(document.createElement('span'));
  const pad = document.createElement('div'); pad.className = 'keypad';
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK']) {
    const b = document.createElement('button'); b.textContent = k;
    if (k === 'OK') b.className = 'k-ok'; if (k === 'C') b.className = 'k-clr';
    b.onclick = () => keypadPress(k);
    pad.append(b);
  }
  body.append(disp, pad);
}
function renderKeypad() {
  if (!keypadState || !$('kpDisp')) return;
  const spans = $('kpDisp').children;
  for (let i = 0; i < 4; i++) spans[i].textContent = keypadState.value[i] || '';
}
function keypadPress(k) {
  if (!keypadState || keypadState.busy) return;
  const disp = $('kpDisp'); disp.classList.remove('wrong');
  if (k === 'C') { keypadState.value = ''; sfx('click'); }
  else if (k === 'OK') {
    if (keypadState.value.length < 4) return;
    keypadState.busy = true;
    const st = keypadState;
    socket.emit('code', { lock: st.lock, value: st.value }, res => {
      st.busy = false;
      if (keypadState !== st) return;
      if (res.ok) { disp.classList.add('right'); setTimeout(closeModal, 700); }
      else { disp.classList.add('wrong'); st.value = ''; setTimeout(renderKeypad, 350); }
    });
    return;
  } else if (keypadState.value.length < 4) { keypadState.value += k; sfx('key'); }
  renderKeypad();
}
function showWordInput() {
  const body = openModal('The Golden Tablet');
  const p = document.createElement('p'); p.className = 'desc'; p.style.textAlign = 'center'; p.textContent = 'SPEAK THE PASSWORD (5 letters)';
  const inp = document.createElement('input'); inp.className = 'word-input'; inp.maxLength = 5; inp.autocomplete = 'off';
  const btn = document.createElement('button'); btn.className = 'btn primary'; btn.textContent = '☀️ Open the Sun Door';
  const submit = () => {
    const v = inp.value.trim().toUpperCase();
    if (v.length !== 5) { inp.classList.add('wrong'); sfx('wrong'); setTimeout(() => inp.classList.remove('wrong'), 400); return; }
    socket.emit('code', { lock: 'console', value: v }, res => {
      if (res.ok) closeModal();
      else { inp.classList.add('wrong'); inp.value = ''; setTimeout(() => inp.classList.remove('wrong'), 400); }
    });
  };
  btn.onclick = submit;
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') submit(); else if (e.key === 'Escape') closeModal(); else if (e.key.length === 1) sfx('key'); });
  body.append(p, inp, btn);
  setTimeout(() => inp.focus(), 50);
}

const HINTS = [
  ['The stone tablet near the start has a riddle about the four gems on the left wall.', 'Fire = red, sky = blue, sun = yellow, forest = green. Press red → blue → yellow → green.'],
  ['The journal page in the chest says to count the animal carvings on the walls of this hall. Check every wall!', 'There are 3 birds, 1 snake, 4 monkeys and 2 jaguars. The code is 3142.'],
  ['Click the mirrors to turn them. Follow the sunbeam and steer it into the big crystal on the right wall.', 'The beam should go: back-left mirror → front-left mirror → front-right mirror → back-right mirror → crystal.'],
  ['Read the glowing writing near the stone gate.', 'Two explorers stand on the sun stone and the moon stone at the same time. (Playing solo? One stone is enough.)'],
  ['Every planet\'s pedestal shows a letter. Captain Reyes\' note by the golden rings tells you the order.', 'From the Sun: Mercury (Q), Venus (U), Earth (E), Mars (S), Jupiter (T) → QUEST.'],
  ['Walk through the Sun Door together into the daylight!']
];
let hintStep = {};
function stage(s = state) {
  if (!s.doorA) return s.chestOpen ? 1 : 0;
  if (!s.beamSolved) return 2;
  if (!s.doorB) return 3;
  if (!s.consoleSolved) return 4;
  return 5;
}
function showHint() {
  if (!inGame || ended) return;
  initAudio(); sfx('hint');
  const st = stage(), list = HINTS[st], step = hintStep[st] || 0;
  const body = openModal('💡 Hint');
  list.slice(0, Math.max(1, step)).forEach((h, i) => {
    const d = document.createElement('div'); d.className = 'hint-text'; d.textContent = (list.length > 1 ? `Hint ${i + 1}: ` : '') + h; body.append(d);
  });
  if (step === 0) { hintStep[st] = 1; socket.emit('hint'); }
  if ((hintStep[st] || 0) < list.length) {
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Show a bigger hint';
    b.onclick = () => { hintStep[st] = (hintStep[st] || 1) + 1; socket.emit('hint'); showHint(); };
    body.append(b);
  }
}
$('hintBtn').onclick = showHint;

// ======================================================================
//  STATE + OTHER PLAYERS
// ======================================================================
const OBJECTIVES = [
  'Explore the Entrance Hall. Captain Reyes left clues behind…',
  'The chest is open! Find the code for the stone door.',
  'Guide the sunbeam into the great crystal.',
  'The twin stones have awakened — work together!',
  'The planets hold the password to the Sun Door.',
  'The Sun Door is open! Everyone step into the daylight together.'
];
let prevState = null;
function applyState(s) {
  state = s;
  if (s.serverNow) serverOffset = s.serverNow - Date.now();
  hostId = s.hostId;
  if (s.teamName) { $('hudLabel').textContent = 'Team'; $('hudCode').textContent = s.teamName; }
  if (!renderer) return;
  const p = prevState || s;
  doors.doorA.open = !!s.doorA; doors.doorB.open = !!s.doorB; doors.exit.open = !!s.consoleSolved;
  for (const [c, g] of Object.entries(anim.gems)) g.lit = !!s.chestOpen || (s.gemSeq || []).includes(c);
  // celebration effects on transitions
  if (prevState) {
    if ((s.gemSeq || []).length > (p.gemSeq || []).length) { const g = anim.gems[s.gemSeq[s.gemSeq.length - 1]]; if (g) burst(g.gem.position, g.gem.material.color, 25, 1.2); }
    if (s.chestOpen && !p.chestOpen) { burst(anim.chestPos, 0xffd27a, 120, 3); flash(); }
    if (s.doorA && !p.doorA) { shake = 1; burst(new THREE.Vector3(0, 1.5, 5), 0xffe0a0, 90, 2.5); }
    if (s.beamSolved && !p.beamSolved) { burst(new THREE.Vector3(5.2, 1.4, 3), 0x7af7ff, 150, 3.5); flash(); }
    if (s.doorB && !p.doorB) { shake = 1; burst(new THREE.Vector3(0, 1.5, -5), 0xbcd2ff, 90, 2.5); }
    if (s.consoleSolved && !p.consoleSolved) { shake = 0.8; flash(); burst(new THREE.Vector3(0, 1.5, -15), 0xfff1b0, 160, 3.5); }
    if (stage(s) !== stage(p)) { $('objective').parentElement.classList.remove('pulse'); void $('objective').offsetWidth; $('objective').parentElement.classList.add('pulse'); }
  }
  $('objective').textContent = OBJECTIVES[stage(s)];
  if (s.mirrors) s.mirrors.forEach((v, i) => (anim.mirrors[i].userData.target = v ? Math.PI / 4 : -Math.PI / 4));
  updateBeam();
  if (s.consoleSolved && !anim.consoleDone) {
    anim.consoleDone = true;
    anim.consoleScreen.material.map = anim.consoleTexDone || (anim.consoleTexDone = textTex(['THE DOOR', 'IS OPEN', 'Q U E S T'], { w: 512, h: 320, bg: '#3a2608', color: '#fff4c8', font: 'bold 54px Cinzel, serif', lineH: 82, glow: '#ff9d00' }));
  }
  if (!s.consoleSolved && anim.consoleDone) { anim.consoleDone = false; anim.consoleScreen.material.map = anim.consoleTexOrig; }
  prevState = JSON.parse(JSON.stringify(s));
}
function flash() { const f = $('flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 60); }

const avatars = {};
function nameSprite(name, color) {
  const tex = canvasTex(256, 64, (g, w) => {
    g.font = '800 30px Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText(name).width + 30;
    g.fillStyle = 'rgba(16,32,28,0.75)'; g.beginPath(); g.roundRect((w - tw) / 2, 8, tw, 48, 24); g.fill();
    g.fillStyle = color; g.fillText(name, w / 2, 33);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(1.1, 0.275, 1);
  return sp;
}
const emojiTex = {};
function showBubble(a, emoji, secs = 2.5) {
  if (!emojiTex[emoji]) emojiTex[emoji] = canvasTex(128, 128, g => {
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(64, 60, 50, 0, 7); g.fill();
    g.beginPath(); g.moveTo(50, 100); g.lineTo(64, 124); g.lineTo(76, 100); g.fill();
    g.font = '60px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(emoji, 64, 64);
  });
  if (a.bubble) a.group.remove(a.bubble);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTex[emoji], depthWrite: false }));
  s.scale.set(0.5, 0.5, 1); s.position.y = 2.5;
  a.group.add(s); a.bubble = s; a.bubbleUntil = performance.now() + secs * 1000;
}
function showEmote(id, e) {
  const emoji = { wave: '👋', cheer: '🎉', think: '🤔' }[e];
  sfx('pop');
  if (id === socket.id) { toast(`You: ${emoji}`); return; }
  const a = avatars[id]; if (!a) return;
  showBubble(a, emoji); a.emote = e; a.emoteT = 0;
}
function makeAvatar(p) {
  const model = buildAvatar(p.color, p.hat);
  const sp = nameSprite(p.name, p.color); sp.position.y = 2.15; model.group.add(sp);
  const shadow = addMesh(new THREE.CircleGeometry(0.35, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }), 0, 0.02, 0, model.group);
  shadow.rotation.x = -Math.PI / 2;
  model.group.position.set(p.x, p.y || 0, p.z);
  scene.add(model.group);
  return { ...model, tx: p.x, ty: p.y || 0, tz: p.z, tyaw: p.yaw, tpitch: p.pitch, yaw: p.yaw, walk: 0, emote: null, emoteT: 0 };
}
function removeAvatar(id) { if (avatars[id]) { scene.remove(avatars[id].group); delete avatars[id]; } }
let lastPlayers = [];
function updatePlayers(arr) {
  lastPlayers = arr;
  if (!renderer) return;
  const seen = new Set();
  for (const p of arr) {
    if (p.id === socket.id) {
      if (!spawned) { me.x = p.x; me.z = p.z; me.yaw = 0; me.pitch = 0; spawned = true; }
      continue;
    }
    seen.add(p.id);
    if (!avatars[p.id]) avatars[p.id] = makeAvatar(p);
    Object.assign(avatars[p.id], { tx: p.x, ty: p.y || 0, tz: p.z, tyaw: p.yaw, tpitch: p.pitch });
  }
  for (const id of Object.keys(avatars)) if (!seen.has(id)) removeAvatar(id);
  renderTeam(arr);
}
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
function updateAvatars(dt, now) {
  for (const a of Object.values(avatars)) {
    const k = Math.min(1, dt * 10);
    const ox = a.group.position.x, oz = a.group.position.z;
    a.group.position.x += (a.tx - ox) * k;
    a.group.position.z += (a.tz - oz) * k;
    a.group.position.y += (a.ty - a.group.position.y) * k;
    a.yaw = lerpAngle(a.yaw, a.tyaw, k);
    a.group.rotation.y = a.yaw;
    a.head.rotation.x = (a.tpitch || 0) * 0.5;
    const speed = Math.hypot(a.group.position.x - ox, a.group.position.z - oz) / Math.max(dt, 1e-4);
    a.walk += dt * Math.min(speed, 5) * 3;
    const swing = speed > 0.2 ? Math.sin(a.walk) * 0.6 : 0;
    a.legs[0].rotation.x = swing; a.legs[1].rotation.x = -swing;
    a.arms[0].rotation.x = -swing * 0.8; a.arms[1].rotation.x = swing * 0.8;
    a.arms[0].rotation.z = 0; a.arms[1].rotation.z = 0;
    if (a.emote) {
      a.emoteT += dt;
      if (a.emote === 'wave') { a.arms[1].rotation.z = 2.6; a.arms[1].rotation.x = 0; a.arms[1].rotation.y = Math.sin(a.emoteT * 12) * 0.4; }
      if (a.emote === 'cheer') { a.arms[0].rotation.z = -2.7; a.arms[1].rotation.z = 2.7; a.group.position.y = Math.abs(Math.sin(a.emoteT * 8)) * 0.25; }
      if (a.emote === 'think') { a.head.rotation.z = Math.sin(a.emoteT * 2) * 0.25; a.arms[1].rotation.x = -2.2; }
      if (a.emoteT > 2.2) { a.emote = null; a.head.rotation.z = 0; a.arms[1].rotation.y = 0; }
    }
    if (a.bubble && now > a.bubbleUntil) { a.group.remove(a.bubble); a.bubble = null; }
    if (a.bubble) a.bubble.position.y = 2.5 + Math.sin(now / 200) * 0.04;
  }
}

// ======================================================================
//  MAIN LOOP
// ======================================================================
let lastSend = 0;
function sendMove(now) {
  // teams on one device only need a few updates per second (keeps the free server relaxed)
  const gap = Object.keys(avatars).length ? 100 : 333;
  if (now - lastSend < gap || !spawned) return;
  lastSend = now;
  socket.emit('move', { x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch });
}
const seenRooms = new Set();
function roomCheck() {
  const z = me.z;
  const r = z > 5 ? 0 : z > -5 ? 1 : z > -15 ? 2 : 3;
  if (seenRooms.has(r)) return;
  seenRooms.add(r);
  const names = [['The Entrance Hall', 'Chamber I'], ['The Crystal Cavern', 'Chamber II'], ['The Celestial Vault', 'Chamber III'], ['Daylight!', 'You made it out']];
  const el = $('roomTitle');
  el.innerHTML = '';
  const sm = document.createElement('small'); sm.textContent = names[r][1];
  el.append(sm, document.createTextNode(names[r][0]));
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  sfx('room');
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime, now = performance.now();
  if (!inGame) return;
  updateMovement(dt);
  roomCheck();

  for (const d of Object.values(doors)) {
    const target = d.open ? 4.7 : 1.5;
    d.group.position.y += (target - d.group.position.y) * Math.min(1, dt * 1.6);
  }
  // gems
  for (const g of Object.values(anim.gems)) {
    const tgt = g.lit ? 1.6 : 0.25 + Math.sin(t * 2) * 0.1;
    g.gem.material.emissiveIntensity += (tgt - g.gem.material.emissiveIntensity) * Math.min(1, dt * 6);
    g.halo.material.opacity = g.lit ? 0.7 : 0.15;
    g.gem.rotation.x = t * (g.lit ? 2 : 0.5);
    g.gem.position.x += ((g.lit ? -5.7 : -5.62) - g.gem.position.x) * Math.min(1, dt * 8);
  }
  anim.lid.rotation.x += ((state.chestOpen ? -1.9 : 0) - anim.lid.rotation.x) * Math.min(1, dt * 3);
  anim.chestGlow.material.opacity = state.chestOpen ? 0.5 + Math.sin(t * 3) * 0.15 : 0;
  anim.kpGem.material.color.setHex(state.doorA ? 0x3ddc97 : (Math.sin(t * 3) > 0 ? 0xff5555 : 0x772222));
  // mirrors & beam
  anim.mirrors.forEach(m => { if (m.userData.target !== undefined) m.rotation.y += (m.userData.target - m.rotation.y) * Math.min(1, dt * 8); });
  anim.beam.visible = !!state.doorA || me.z < 5.5;
  anim.beamMat.opacity = 0.8 + Math.sin(t * 8) * 0.15;
  anim.beamGlowMat.opacity = 0.2 + Math.sin(t * 5) * 0.08;
  anim.beamEnd.scale.setScalar(0.7 + Math.sin(t * 10) * 0.15);
  const solved = !!state.beamSolved;
  anim.bigCrystal.m.emissiveIntensity += ((solved ? 2.2 : 0.4) - anim.bigCrystal.m.emissiveIntensity) * Math.min(1, dt * 2);
  anim.bigGlow.material.opacity = solved ? 0.7 + Math.sin(t * 3) * 0.15 : 0.15;
  anim.bigLight.intensity += ((solved ? 8 : 0) - anim.bigLight.intensity) * Math.min(1, dt * 2);
  for (const g of anim.glyphs) g.material.opacity += ((solved ? 0.95 : 0) - g.material.opacity) * Math.min(1, dt * 1.2);
  // pressure plates
  const everyone = [{ x: me.x, z: me.z }, ...Object.values(avatars).map(a => ({ x: a.group.position.x, z: a.group.position.z }))];
  for (const [kind, pl] of Object.entries(anim.plates)) {
    const px = kind === 'sun' ? -2.5 : 2.5;
    const on = everyone.some(p => Math.hypot(p.x - px, p.z + 3) < 0.95);
    if (on && !pl.wasOn) sfx('plate');
    pl.wasOn = on;
    const tgt = state.doorB ? 1.4 : on ? (solved ? 1.2 : 0.4) : (solved ? 0.35 + Math.sin(t * 2.5) * 0.15 : 0.08);
    pl.mesh.material[1].emissiveIntensity += (tgt - pl.mesh.material[1].emissiveIntensity) * Math.min(1, dt * 5);
    pl.mesh.position.y += ((on ? 0.015 : 0.04) - pl.mesh.position.y) * Math.min(1, dt * 10);
    pl.glow.material.opacity = solved ? (on || state.doorB ? 0.6 : 0.2) : 0;
  }
  // vault
  anim.planets.forEach((p, i) => (p.rotation.y = t * (0.25 + i * 0.07)));
  anim.rings.forEach((r, i) => (r.rotation.y = t * (0.3 + i * 0.2) * (i % 2 ? -1 : 1)));
  anim.exitLight.intensity += ((state.consoleSolved ? 22 : 0) - anim.exitLight.intensity) * Math.min(1, dt * 1.5);
  anim.sunstone.rotation.y = t * 1.5; anim.sunstone.position.y = 1.4 + Math.sin(t * 2) * 0.1;

  updateEffects(dt, t);
  updateAvatars(dt, now);
  updateInteraction();
  if (composer) composer.render(); else renderer.render(scene, camera);
  sendMove(now);
  if (state.startTime) $('timer').textContent = fmtTime((state.endTime || Date.now() + serverOffset) - state.startTime);
}

function init3D() {
  renderer = new THREE.WebGLRenderer({ antialias: !isTouch, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('canvasWrap').append(renderer.domElement);
  camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 60);
  buildWorld();
  scene.add(camera);
  rayTargets = [...new Set([...interactables, ...occluders])];
  if (!isTouch) {
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.82));
      composer.addPass(new OutputPass());
    } catch (e) { composer = null; }
  }
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    if (composer) composer.setSize(innerWidth, innerHeight);
  });
  renderer.domElement.addEventListener('click', () => { if (!uiOpen && !ended) lockPointer(); });
  setupTouch();
  applyState(state);
  updatePlayers(lastPlayers);
  animate();
}

function startGame() {
  if (ended) return;
  showScreen('game');
  preview.running = false;
  inGame = true;
  initAudio();
  if (!renderer) init3D(); else applyState(state);
  updateClickOverlay();
  if (isTouch) toast('Drag the left side to move, the right side to look. Tap USE to interact.');
  else toast('Click the screen, then WASD + mouse to explore. Press E to inspect things!');
}

// debug hook used for automated testing
window.__game = { me, socket, get state() { return state; }, interact, get focused() { return focused; } };
