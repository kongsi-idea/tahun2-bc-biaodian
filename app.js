'use strict';
/* 标点小蛇闯关 · 二年级华文 · 陈晓琪老师
 * 贪吃蛇 + 标点填空。题库见 js/questions.js（不在这里改题）。 */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const LEVELS = {
  easy: { name: '简单', speed: 520 },
  medium: { name: '中等', speed: 450 },
  hard: { name: '挑战', speed: 380 },
};
const PNAME = { '。': '句号', '，': '逗号', '？': '问号', '！': '叹号', '、': '顿号', '：': '冒号', '“': '前引号', '”': '后引号' };
const PUN_RE = /[。，？！、：“”]/g;
const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const STUN_MS = 3000;

/* ───────────────────────── 音效（WebAudio 合成，用完即断开） ───────────────────────── */
const Sound = {
  on: true, ctx: null, nbuf: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) this.ctx = new AC(); } catch (e) { /* 没声音也能玩 */ }
  },
  tone(freq, dur, { type = 'sine', vol = 0.15, slide = 1, delay = 0 } = {}) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.onended = () => { o.disconnect(); g.disconnect(); };
    o.start(t); o.stop(t + dur + 0.03);
  },
  noise(dur, { vol = 0.2, from = 2000, to = 2000, delay = 0, type = 'bandpass' } = {}) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    if (!this.nbuf) {
      this.nbuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
      const d = this.nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = c.createBufferSource(); s.buffer = this.nbuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(c.destination);
    s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
    s.start(t); s.stop(t + dur + 0.02);
  },
  turn() { this.tone(520, 0.05, { type: 'triangle', vol: 0.05, slide: 1.15 }); },
  eat() { this.tone(520, 0.1, { type: 'triangle', vol: 0.15, slide: 1.6 }); this.tone(880, 0.14, { type: 'triangle', vol: 0.12, delay: 0.07 }); },
  click() { this.noise(0.05, { vol: 0.35, from: 3200, to: 1400 }); this.tone(190, 0.07, { type: 'square', vol: 0.07, slide: 0.6 }); },
  unpick() { this.tone(500, 0.08, { type: 'triangle', vol: 0.09, slide: 0.75 }); },
  good() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.24, { type: 'triangle', vol: 0.14, delay: i * 0.085 })); },
  bad() { this.tone(330, 0.2, { type: 'sine', vol: 0.13 }); this.tone(262, 0.32, { type: 'sine', vol: 0.13, delay: 0.16 }); },
  bump() { this.tone(130, 0.22, { type: 'sine', vol: 0.3, slide: 0.5 }); this.noise(0.12, { vol: 0.15, from: 500, to: 160, type: 'lowpass' }); },
};

/* ───────────────────────── 朗读：预录 mp3 优先，没有才退回 speechSynthesis ───────────────────────── */
const VOICE = 'zh-CN-XiaoxiaoNeural';
const NOVELTY_VOICES = /Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox/i;
const VOICE_RANK = [/Xiaoxiao.*Natural|Xiaoxiao Online/i, /Google 普通话|Google.*(Mandarin|中国)/i, /Xiaoxiao|Xiaoyi|Yunxi/i, /Huihui/i, /Tingting|婷婷/i, /Lili|李莉/i, /Yaoyao|Kangkang/i];
function clipKey(voice, text) {
  // FNV-1a 32 位（UTF-8），gen-voice.py 用同一个算法算档名
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(voice + '|' + text)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const Voice = {
  voice: null, audio: null,
  pick() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices().filter(v => /^zh[-_](CN|Hans|SG|MY)/i.test(v.lang) && !NOVELTY_VOICES.test(v.name));
    this.voice = null;
    for (const re of VOICE_RANK) { const v = vs.find(x => re.test(x.name)); if (v) { this.voice = v; break; } }
    if (!this.voice) this.voice = vs[0] || null;
  },
  say(text, force = false) {
    this.stop();
    if (!text || (!force && !Sound.on)) return;
    const key = clipKey(VOICE, text);
    if (window.VOICE_CLIPS && window.VOICE_CLIPS[key]) {
      const au = new Audio(`audio/${key}.mp3`);
      this.audio = au;
      au.play().catch(() => { if (this.audio === au) this.tts(text); });
      return;
    }
    this.tts(text);
  },
  tts(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    if (!this.voice) this.pick();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; u.rate = 0.9; u.pitch = 1;
    if (this.voice) u.voice = this.voice;
    speechSynthesis.speak(u);
  },
  stop() {
    if (this.audio) { this.audio.pause(); this.audio = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  },
};
if ('speechSynthesis' in window) { Voice.pick(); speechSynthesis.onvoiceschanged = () => Voice.pick(); }
window.addEventListener('pagehide', () => Voice.stop());

/* ───────────────────────── 题目工具 ───────────────────────── */
function qParts(q) {
  const out = []; let last = 0;
  q.replace(/_(\d+)_/g, (m, n, off) => {
    if (off > last) out.push({ t: 'text', v: q.slice(last, off) });
    out.push({ t: 'slot', i: +n - 1 }); last = off + m.length; return m;
  });
  if (last < q.length) out.push({ t: 'text', v: q.slice(last) });
  return out;
}
const plainText = it => it.q.replace(/_\d+_/g, '').replace(PUN_RE, '');          // 无标点原句（点喇叭读）
const fullText = it => it.q.replace(/_(\d+)_/g, (m, n) => it.a[n - 1]);          // 完整句（答题后读）
const fullHTML = it => qParts(it.q).map(p => p.t === 'text' ? esc(p.v) : `<b class="pk">${esc(it.a[p.i])}</b>`).join('');
function allVoiceLines() {
  const out = new Map();
  const add = text => out.set(VOICE + '|' + text, { text, voice: VOICE, key: clipKey(VOICE, text) });
  for (const lv of Object.keys(PUNCT.BANK)) for (const it of PUNCT.BANK[lv]) { add(plainText(it)); add(fullText(it)); }
  return [...out.values()];
}
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ───────────────────────── 状态 ───────────────────────── */
const G = {
  screen: 'home', level: 'easy',
  cols: 20, rows: 14, cell: 40, dpr: 1,
  playing: false, waiting: true, modal: null,
  qs: [], qi: 0, right: 0, wrong: 0, wrongItems: [], practice: false,
  snake: [], prevHead: null, prevTail: null, dir: DIRS.right, queue: [], grow: 0, acc: 0, speed: 520,
  fruits: [], stunLeft: 0, pulseAt: -1e9, shakeAt: -1e9,
  quiz: null,
};
const cv = $('#board'), ctx = cv.getContext('2d');
const IMG = {};
['snake-head', 'snake-body', 'snake-tail', 'fruit-apple', 'fruit-orange', 'fruit-pear', 'star', 'maple-board'].forEach(n => {
  const im = new Image(); im.src = `assets/${n}.png`.replace('maple-board.png', 'maple-board.jpg'); IMG[n] = im;
});
let boardBG = null;

/* ───────────────────────── 屏幕切换 ───────────────────────── */
function showScreen(name) {
  G.screen = name;
  $('#home').classList.toggle('is-active', name === 'home');
  $('#game').classList.toggle('is-active', name === 'game');
  document.body.dataset.screen = name;
  if (name === 'game') requestAnimationFrame(fit);
}
function openModal(id) { const m = $(id); m.hidden = false; requestAnimationFrame(() => m.classList.add('is-open')); }
function closeModal(id) { const m = $(id); m.classList.remove('is-open'); m.hidden = true; }

/* ───────────────────────── 排版 ───────────────────────── */
function gridDims() { return window.innerWidth < window.innerHeight ? { cols: 12, rows: 16 } : { cols: 20, rows: 14 }; }
function fit() {
  if (G.screen !== 'game') return;
  const { cols, rows } = gridDims();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const portrait = cols === 12;
  document.body.classList.toggle('portrait', portrait);
  const hud = $('.hud').getBoundingClientRect().height;
  const dp = $('#dpad').getBoundingClientRect();
  const frameB = vw < 600 ? 9 : 14;
  document.documentElement.style.setProperty('--frame', frameB + 'px');
  let availW, availH;
  if (portrait) { availW = vw - 20; availH = vh - hud - dp.height - 34; }
  else { availW = vw - (vw < 900 ? 2 * 14 + 200 : 2 * 216); availH = vh - hud - 28; }
  let cell = Math.floor(Math.min((availW - 2 * frameB) / cols, (availH - 2 * frameB) / rows));
  cell = Math.max(14, cell);
  const changed = cols !== G.cols || rows !== G.rows;
  G.cols = cols; G.rows = rows; G.cell = cell;
  G.dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = cols * cell, h = rows * cell;
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  cv.width = Math.round(w * G.dpr); cv.height = Math.round(h * G.dpr);
  buildBoardBG();
  if (changed && G.snake.length) { placeSnakeStart(); G.fruits = []; while (G.fruits.length < 3) spawnFruit(); }
  if (!G.snake.length) { /* 还没开局 */ }
}
function buildBoardBG() {
  const w = cv.width, h = cv.height, c = G.cell * G.dpr;
  const o = document.createElement('canvas'); o.width = w; o.height = h;
  const x = o.getContext('2d');
  const im = IMG['maple-board'];
  if (im.complete && im.naturalWidth) {
    const r = Math.max(w / im.naturalWidth, h / im.naturalHeight);
    x.drawImage(im, (w - im.naturalWidth * r) / 2, (h - im.naturalHeight * r) / 2, im.naturalWidth * r, im.naturalHeight * r);
  } else { x.fillStyle = '#E8C39E'; x.fillRect(0, 0, w, h); }
  for (let r = 0; r < G.rows; r++) for (let q = 0; q < G.cols; q++) {
    x.fillStyle = (r + q) % 2 ? 'rgba(110,69,34,0.05)' : 'rgba(255,248,232,0.06)';
    x.fillRect(q * c, r * c, c, c);
  }
  x.strokeStyle = 'rgba(110,69,34,0.10)'; x.lineWidth = Math.max(1, G.dpr * 0.8);
  x.beginPath();
  for (let q = 1; q < G.cols; q++) { x.moveTo(q * c, 0); x.lineTo(q * c, h); }
  for (let r = 1; r < G.rows; r++) { x.moveTo(0, r * c); x.lineTo(w, r * c); }
  x.stroke();
  boardBG = o;
}
IMG['maple-board'].onload = () => { if (G.screen === 'game') buildBoardBG(); };
let rzT = 0;
window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(fit, 60); });
window.addEventListener('orientationchange', () => setTimeout(fit, 200));

/* ───────────────────────── 开局 ───────────────────────── */
function startRound(level, items) {
  Voice.stop();
  G.level = level; G.speed = LEVELS[level].speed;
  G.practice = !!items;
  G.qs = items ? shuffle(items) : shuffle(PUNCT.BANK[level]).slice(0, PUNCT.ROUND_SIZE[level]);
  G.qi = 0; G.right = 0; G.wrong = 0; G.wrongItems = [];
  G.grow = 0; G.acc = 0; G.queue = []; G.stunLeft = 0; G.modal = null; G.quiz = null;
  ['#quiz', '#result', '#review', '#lesson'].forEach(closeModal);
  showScreen('game');
  fit();
  G.cols = gridDims().cols; G.rows = gridDims().rows;
  G.snake = []; placeSnakeStart(3);
  G.fruits = []; while (G.fruits.length < 3) spawnFruit();
  G.playing = true; G.waiting = true;
  setBoardMsg('按方向键、WASD，或在棋盘上滑动，小蛇就出发！');
  $('#stunChip').hidden = true;
  updateHUD();
}
function placeSnakeStart(len) {
  len = len || (G.snake.length + G.grow);
  G.grow = 0;
  const rowY = Math.floor(G.rows / 2) - 1, hx = Math.min(G.cols - 5, Math.max(3, len - 1));
  const s = []; let x = hx, y = rowY, step = -1;
  for (let i = 0; i < len; i++) {
    s.push({ x, y });
    if (x + step < 0 || x + step > hx) { y += 1; step = -step; } else x += step;
  }
  // 每行折返时第一格已换行；长蛇会在下一行向右延伸，不会和头所在行重叠
  G.snake = s; G.prevHead = s[0]; G.prevTail = null; G.dir = DIRS.right; G.queue = []; G.acc = 0;
}
function spawnFruit() {
  const kinds = ['apple', 'orange', 'pear'];
  const used = new Set(G.fruits.map(f => f.kind));
  const kind = kinds.find(k => !used.has(k)) || kinds[Math.floor(Math.random() * 3)];
  const head = G.snake[0] || { x: 0, y: 0 };
  for (let tries = 0; tries < 400; tries++) {
    const x = Math.floor(Math.random() * G.cols), y = Math.floor(Math.random() * G.rows);
    if (G.snake.some(c => c.x === x && c.y === y)) continue;
    if (G.fruits.some(f => f.x === x && f.y === y)) continue;
    if (Math.abs(x - head.x) + Math.abs(y - head.y) < 4 && tries < 300) continue;
    G.fruits.push({ x, y, kind, phase: Math.random() * 6.28 }); return;
  }
}

/* ───────────────────────── 输入 ───────────────────────── */
function steer(name) {
  if (G.screen !== 'game' || !G.playing || G.modal || G.stunLeft > 0) return;
  Sound.init();
  const d = DIRS[name];
  const ref = G.queue.length ? G.queue[G.queue.length - 1] : G.dir;
  if (G.waiting) { G.waiting = false; setBoardMsg(''); if (d.x + ref.x === 0 && d.y + ref.y === 0) return; }
  if (d === ref) return;
  if (d.x + ref.x === 0 && d.y + ref.y === 0) return;          // 不能掉头
  if (G.queue.length >= 2) return;
  G.queue.push(d); Sound.turn();
}
const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right' };
window.addEventListener('keydown', e => {
  if (G.modal === 'quiz') {
    if (e.key === 'Enter' && G.quiz) { const b = G.quiz.done ? $('#qNext') : $('#qSubmit'); if (!b.disabled && !b.hidden && document.activeElement.tagName !== 'BUTTON') b.click(); }
    return;
  }
  const n = KEYMAP[e.key];
  if (n && G.screen === 'game') { e.preventDefault(); steer(n); }
});
$$('.dp').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); steer(b.dataset.dir); }));
// 棋盘滑动
let sw = null;
cv.addEventListener('pointerdown', e => { sw = { x: e.clientX, y: e.clientY, id: e.pointerId }; Sound.init(); try { cv.setPointerCapture(e.pointerId); } catch (_) { } });
cv.addEventListener('pointermove', e => {
  if (!sw || e.pointerId !== sw.id) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
  if (Math.hypot(dx, dy) < 24) return;
  steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  sw.x = e.clientX; sw.y = e.clientY;
});
const endSwipe = () => { sw = null; };
cv.addEventListener('pointerup', endSwipe); cv.addEventListener('pointercancel', endSwipe);

/* ───────────────────────── 游戏循环 ───────────────────────── */
const canRun = () => G.screen === 'game' && G.playing && !document.hidden && !G.modal;
function setBoardMsg(t) { const m = $('#boardMsg'); m.hidden = !t; m.textContent = t || ''; }
function update(dt) {
  if (!canRun()) return;
  if (G.stunLeft > 0) {
    G.stunLeft -= dt;
    if (G.stunLeft <= 0) { G.stunLeft = 0; $('#stunChip').hidden = true; G.acc = 0; }
    else { $('#stunChip b').textContent = Math.ceil(G.stunLeft / 1000); }
    return;
  }
  if (G.waiting) return;
  G.acc += dt;
  if (G.acc >= G.speed) { G.acc -= G.speed; tick(); }
}
function crash(kind) {
  Sound.bump(); G.shakeAt = performance.now();
  placeSnakeStart();
  G.stunLeft = STUN_MS; G.crashKind = kind;
  const chip = $('#stunChip'); chip.hidden = false; $('#stunChip b').textContent = '3';
  $('#stunChip span').textContent = kind === 'wall' ? '撞到墙了，晕晕的…' : '撞到自己了，晕晕的…';
  updateHUD();
}
function tick() {
  if (G.queue.length) G.dir = G.queue.shift();
  const h = G.snake[0], nx = h.x + G.dir.x, ny = h.y + G.dir.y;
  if (nx < 0 || ny < 0 || nx >= G.cols || ny >= G.rows) return crash('wall');
  const grow = G.grow > 0;
  const occ = grow ? G.snake : G.snake.slice(0, -1);
  if (occ.some(c => c.x === nx && c.y === ny)) return crash('self');
  G.prevHead = h;
  G.snake.unshift({ x: nx, y: ny });
  if (grow) { G.grow--; G.prevTail = G.snake[G.snake.length - 1]; } else G.prevTail = G.snake.pop();
  const fi = G.fruits.findIndex(f => f.x === nx && f.y === ny);
  if (fi >= 0) {
    G.fruits.splice(fi, 1);
    Sound.eat();
    G.acc = G.speed - 0.5;           // 画面停在「头刚到」的位置
    G.modal = 'pending';
    setTimeout(() => { if (G.modal === 'pending') openQuiz(); }, 200);
  }
}

/* ───────────────────────── 蛇的绘制（沿路径等距排列） ───────────────────────── */
function snakeLayout(t) {
  const s = G.snake, n = s.length;
  const ph = G.prevHead || s[0];
  const H = { x: ph.x + (s[0].x - ph.x) * t, y: ph.y + (s[0].y - ph.y) * t };
  let tailEnd = G.prevTail;
  if (!tailEnd) { const a = s[n - 1], b = s[Math.max(0, n - 2)]; tailEnd = n > 1 ? { x: a.x + (a.x - b.x), y: a.y + (a.y - b.y) } : a; }
  const pts = [H]; for (let i = 1; i < n; i++) pts.push(s[i]); pts.push(tailEnd);
  const legs = []; let tot = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); legs.push(l); tot += l; }
  const at = d => {
    d = Math.max(0, Math.min(tot, d));
    for (let i = 0; i < legs.length; i++) {
      if (d <= legs[i] || i === legs.length - 1) { const f = legs[i] ? Math.min(1, d / legs[i]) : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f }; }
      d -= legs[i];
    }
    return pts[0];
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = i, p = at(d), a = at(d - 0.32), b = at(d + 0.32);
    let ang = Math.atan2(a.y - b.y, a.x - b.x);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.05) ang = Math.atan2(G.dir.y, G.dir.x);
    out.push({ x: p.x, y: p.y, ang, kind: i === 0 ? 'head' : i === n - 1 ? 'tail' : 'body' });
  }
  return out;
}
const SPR = { body: [1.25, 0.95, 0], head: [1.36, 1.14, 0.12], tail: [1.4, 0.56, -0.12] };
function drawPiece(c, im, x, y, ang, w, h, ox, dx) {
  if (!im.complete || !im.naturalWidth) return;
  ctx.save(); ctx.translate(x + dx, y); ctx.rotate(ang);
  if (Math.cos(ang) < -0.01) ctx.scale(1, -1);
  ctx.drawImage(im, (-w / 2 + ox), -h / 2, w, h);
  ctx.restore();
}
function drawSnake(now, t) {
  const c = G.cell, pcs = snakeLayout(t);
  const pulse = Math.max(0, 1 - (now - G.pulseAt) / 500);
  const dz = G.stunLeft > 0 ? Math.sin(now / 90) * 0.04 : 0;
  // 1) 贴地阴影（把精灵画到画布外，只留下阴影）
  const BIG = 4000;
  ctx.save();
  ctx.shadowColor = 'rgba(36,22,9,0.34)'; ctx.shadowBlur = c * 0.22 * G.dpr;
  ctx.shadowOffsetX = (BIG + c * 0.10) * G.dpr; ctx.shadowOffsetY = c * 0.14 * G.dpr;
  for (let i = pcs.length - 1; i >= 0; i--) {
    const p = pcs[i], sp = SPR[p.kind];
    drawPiece(c, IMG['snake-' + p.kind], (p.x + 0.5) * c, (p.y + 0.5) * c, p.ang, sp[0] * c, sp[1] * c, sp[2] * c, -BIG);
  }
  ctx.restore();
  // 2) 本体：尾 → 身 → 头
  for (let i = pcs.length - 1; i >= 0; i--) {
    const p = pcs[i], sp = SPR[p.kind];
    const k = 1 + (p.kind === 'tail' ? pulse * 0.25 : 0);
    drawPiece(c, IMG['snake-' + p.kind], (p.x + 0.5) * c, (p.y + 0.5) * c + dz * c * (p.kind === 'head' ? 1 : 0), p.ang, sp[0] * c * 1 * k, sp[1] * c * k, sp[2] * c, 0);
  }
  if (G.stunLeft > 0) {                      // 头上转圈的小星星
    const h = pcs[0];
    for (let k = 0; k < 3; k++) {
      const a = now / 380 + k * 2.09, sx = (h.x + 0.5) * c + Math.cos(a) * c * 0.55, sy = (h.y + 0.5) * c - c * 0.62 + Math.sin(a) * c * 0.16;
      const sz = c * 0.34; if (IMG.star.complete) ctx.drawImage(IMG.star, sx - sz / 2, sy - sz / 2, sz, sz * 0.95);
    }
  }
}
function drawFruits(now) {
  const c = G.cell;
  for (const f of G.fruits) {
    const im = IMG['fruit-' + f.kind]; if (!im.complete || !im.naturalWidth) continue;
    const bob = REDUCED ? 0 : Math.sin(now / 420 + f.phase) * Math.min(4, c * 0.08);
    const h = c * 0.92, w = h * im.naturalWidth / im.naturalHeight;
    const cx = (f.x + 0.5) * c, cy = (f.y + 0.5) * c;
    ctx.save(); ctx.fillStyle = 'rgba(36,22,9,0.28)';
    ctx.beginPath(); ctx.ellipse(cx + c * 0.06, cy + c * 0.36, w * 0.38, c * 0.09, 0, 0, 6.3); ctx.fill(); ctx.restore();
    ctx.save(); ctx.shadowColor = 'rgba(36,22,9,0.25)'; ctx.shadowBlur = 4 * G.dpr; ctx.shadowOffsetX = 2 * G.dpr; ctx.shadowOffsetY = 3 * G.dpr;
    ctx.drawImage(im, cx - w / 2, cy - h / 2 - bob - c * 0.04, w, h); ctx.restore();
  }
}
function draw(now) {
  const c = G.cell;
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (boardBG) ctx.drawImage(boardBG, 0, 0, cv.width / G.dpr, cv.height / G.dpr);
  if (!G.snake.length) return;
  const t = (G.modal || G.waiting || G.stunLeft > 0) ? (G.modal ? 1 : 0) : Math.min(1, G.acc / G.speed);
  drawFruits(now);
  drawSnake(now, t);
  if (now - G.shakeAt < 380) $('#frame').style.transform = `translateX(${Math.sin((now - G.shakeAt) / 25) * 5 * (1 - (now - G.shakeAt) / 380)}px)`;
  else if ($('#frame').style.transform) $('#frame').style.transform = '';
}
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(100, now - lastT); lastT = now;
  if (G.screen === 'game') { update(dt); draw(now); }
}
requestAnimationFrame(frame);

/* ───────────────────────── HUD ───────────────────────── */
function updateHUD() {
  const total = G.qs.length;
  $('#hudQ').innerHTML = `第 <b>${Math.min(G.qi + 1, total)}</b>／<b>${total}</b> 题`;
  const len = G.snake.length + G.grow;
  $('#hudLen').innerHTML = `蛇长 <b>${len}</b>`;
  $('#hudScore').innerHTML = `<svg class="ic-ok"><use href="#i-check"/></svg>答对 <b>${G.right}</b><i class="sep"></i><svg class="ic-bad"><use href="#i-cross"/></svg>答错 <b>${G.wrong}</b>`;
}
function bump(sel) { const e = $(sel); e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); }

/* ───────────────────────── 答题 ───────────────────────── */
const blockHTML = p => `<i class="st s1"></i><i class="st s2"></i><i class="st s3"></i><i class="st s4"></i><b>${esc(p)}</b>`;
function openQuiz() {
  if (G.qi >= G.qs.length) return;
  const it = G.qs[G.qi];
  G.modal = 'quiz';
  G.quiz = { item: it, slots: it.a.map(() => null), done: false, ok: null, busy: 0 };
  $('#qNo').textContent = `第 ${G.qi + 1} 题`;
  $('#qSentence').innerHTML = qParts(it.q).map(p => p.t === 'text'
    ? `<span class="tx">${esc(p.v)}</span>`
    : `<button type="button" class="slot" data-i="${p.i}" aria-label="第 ${p.i + 1} 个空格，空的"></button>`).join('');
  const tray = PUNCT.TRAY[G.level];
  $('#qTray').innerHTML = tray.map(p => `<div class="tcell"><button type="button" class="blk tray-blk" data-p="${esc(p)}" aria-label="${PNAME[p]} ${esc(p)}">${blockHTML(p)}</button><span class="tcap">${PNAME[p]}</span></div>`).join('');
  $('#qTray').hidden = false;
  const fb = $('#qFeedback'); fb.hidden = true; fb.innerHTML = ''; fb.className = 'feedback';
  $('#qSubmit').hidden = false; $('#qSubmit').disabled = true; $('#qNext').hidden = true;
  $('#quiz .plaque').classList.remove('is-ok', 'is-bad');
  openModal('#quiz');
  updateHUD();
  document.body.classList.add('modal-open');
}
function refreshSubmit() { $('#qSubmit').disabled = !G.quiz || G.quiz.done || G.quiz.slots.some(v => v === null) || G.quiz.busy > 0; }
function slotEl(i) { return $(`#qSentence .slot[data-i="${i}"]`); }
function paintSlot(i) {
  const el = slotEl(i), v = G.quiz.slots[i];
  el.classList.toggle('has', v !== null);
  if (v === null) { el.innerHTML = ''; el.setAttribute('aria-label', `第 ${i + 1} 个空格，空的`); return; }
  el.innerHTML = `<span class="blk in-slot">${blockHTML(v)}</span>`;
  el.setAttribute('aria-label', `第 ${i + 1} 个空格，放了${PNAME[v]}，点一下拿回来`);
  el.classList.remove('drop'); void el.offsetWidth; el.classList.add('drop');
}
function placeInto(p, i, fromRect) {
  const q = G.quiz; if (!q || q.done) return;
  q.slots[i] = p; q.busy++;
  const el = slotEl(i); el.classList.add('flying'); el.innerHTML = '';
  refreshSubmit();
  const finish = () => { el.classList.remove('flying'); q.busy--; paintSlot(i); Sound.click(); refreshSubmit(); };
  if (!fromRect || REDUCED) { finish(); return; }
  const to = el.getBoundingClientRect();
  const g = makeGhost(p, fromRect);
  const dx = to.left + to.width / 2 - (fromRect.left + fromRect.width / 2), dy = to.top + to.height / 2 - (fromRect.top + fromRect.height / 2);
  const an = g.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${dx}px,${dy - 14}px) scale(1.08)`, offset: 0.7 }, { transform: `translate(${dx}px,${dy}px) scale(0.96)` }], { duration: 230, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
  an.onfinish = () => { g.remove(); finish(); }; an.oncancel = () => { g.remove(); finish(); };
}
function makeGhost(p, rect) {
  const g = document.createElement('span');
  g.className = 'blk ghost'; g.innerHTML = blockHTML(p);
  g.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:90;pointer-events:none`;
  document.body.appendChild(g); return g;
}
function firstEmpty() { return G.quiz.slots.findIndex((v, i) => v === null && !slotEl(i).classList.contains('flying')); }
function nearestSlot(x, y) {
  let best = -1, bd = 44;
  G.quiz.slots.forEach((_, i) => {
    const r = slotEl(i).getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = i; }
  });
  return best;
}
// 托盘：点击（飞入最左空槽）或拖放
let drag = null;
$('#qTray').addEventListener('pointerdown', e => {
  const b = e.target.closest('.tray-blk'); if (!b || !G.quiz || G.quiz.done) return;
  Sound.init(); e.preventDefault();
  drag = { b, p: b.dataset.p, sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId, ghost: null, rect: b.getBoundingClientRect() };
});
window.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 7) {
    drag.moved = true; drag.ghost = makeGhost(drag.p, drag.rect); drag.ghost.classList.add('lifted'); drag.b.classList.add('away');
  }
  if (drag.moved) {
    drag.ghost.style.transform = `translate(${e.clientX - drag.sx}px,${e.clientY - drag.sy - 10}px) scale(1.12)`;
    const n = nearestSlot(e.clientX, e.clientY);
    $$('#qSentence .slot').forEach((s, i) => s.classList.toggle('hover', i === n));
  }
});
function endDrag(e, cancel) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  $$('#qSentence .slot').forEach(s => s.classList.remove('hover'));
  d.b.classList.remove('away');
  if (!G.quiz || G.quiz.done) { if (d.ghost) d.ghost.remove(); return; }
  if (d.moved) {
    const n = cancel ? -1 : nearestSlot(e.clientX, e.clientY);
    if (n >= 0) {
      const gr = d.ghost.getBoundingClientRect(); d.ghost.remove();
      placeInto(d.p, n, gr);
    } else {
      const g = d.ghost; const tx = d.rect.left - d.rect.left;
      g.animate([{ transform: g.style.transform, opacity: 1 }, { transform: 'translate(0,0) scale(1)', opacity: 0.2 }], { duration: 180, fill: 'forwards' }).onfinish = () => g.remove();
      Sound.unpick();
    }
  } else if (!cancel) {
    const i = firstEmpty(); if (i >= 0) placeInto(d.p, i, d.rect);
  }
}
window.addEventListener('pointerup', e => endDrag(e, false));
window.addEventListener('pointercancel', e => endDrag(e, true));
$('#qTray').addEventListener('click', e => {             // 键盘（Enter／空格）也能放
  if (e.detail !== 0) return;
  const b = e.target.closest('.tray-blk'); if (!b || !G.quiz || G.quiz.done) return;
  const i = firstEmpty(); if (i >= 0) placeInto(b.dataset.p, i, b.getBoundingClientRect());
});
$('#qSentence').addEventListener('click', e => {         // 点已放入的积木 → 退回
  const s = e.target.closest('.slot'); if (!s || !G.quiz || G.quiz.done) return;
  const i = +s.dataset.i; if (G.quiz.slots[i] === null || s.classList.contains('flying')) return;
  G.quiz.slots[i] = null; paintSlot(i); Sound.unpick(); refreshSubmit();
});
$('#qSpeak').addEventListener('click', () => { Sound.init(); if (G.quiz) Voice.say(G.quiz.done ? fullText(G.quiz.item) : plainText(G.quiz.item), true); });

const MARK_OK = '<span class="mark ok"><svg><use href="#i-check"/></svg></span>';
const MARK_BAD = '<span class="mark bad"><svg><use href="#i-cross"/></svg></span>';
$('#qSubmit').addEventListener('click', () => {
  const q = G.quiz; if (!q || q.done || q.slots.some(v => v === null)) return;
  q.done = true; q.busy = 0;
  const it = q.item;
  const marks = q.slots.map((v, i) => v === it.a[i]);
  q.ok = marks.every(Boolean);
  G.qi++;
  if (q.ok) G.right++; else { G.wrong++; G.wrongItems.push(it); }
  marks.forEach((m, i) => {
    const el = slotEl(i); el.classList.add('locked', m ? 'right' : 'wrong'); el.insertAdjacentHTML('beforeend', m ? MARK_OK : MARK_BAD);
    el.setAttribute('aria-label', `第 ${i + 1} 个空格，${m ? '放对了' : '放错了'}`);
  });
  $('#qTray').hidden = true;
  const plaque = $('#quiz .plaque'); plaque.classList.add(q.ok ? 'is-ok' : 'is-bad');
  const fb = $('#qFeedback'); fb.hidden = false; fb.className = 'feedback ' + (q.ok ? 'ok' : 'bad');
  fb.innerHTML = q.ok
    ? `<div class="fb-title"><span class="badge ok"><svg><use href="#i-check"/></svg></span><b>答对了！</b><span>小蛇长大一节</span></div><p class="fb-sent">${fullHTML(it)}</p><p class="fb-exp">${esc(it.exp)}</p>`
    : `<div class="fb-title"><span class="badge bad"><svg><use href="#i-cross"/></svg></span><b>再想想</b><span>看看正确的写法</span></div><p class="fb-sent">${fullHTML(it)}</p><p class="fb-exp">${esc(it.exp)}</p>`;
  $('#qSubmit').hidden = true; $('#qNext').hidden = false; $('#qNext').focus({ preventScroll: true });
  if (q.ok) { G.grow++; Sound.good(); burst(); } else { Sound.bad(); $$('#qSentence .slot.wrong').forEach(s => s.classList.add('shake')); }
  Voice.say(fullText(it));
  updateHUD();
});
function burst() {
  if (REDUCED) return;
  const slots = $$('#qSentence .slot'); const b = $('#quiz .plaque').getBoundingClientRect();
  const pts = slots.map(s => { const r = s.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  pts.forEach(([x, y]) => {
    for (let k = 0; k < 6; k++) {
      const im = document.createElement('img'); im.src = 'assets/star.png'; im.alt = ''; im.className = 'spark';
      const sz = 14 + Math.random() * 16; im.style.cssText = `left:${x - sz / 2}px;top:${y - sz / 2}px;width:${sz}px`;
      document.body.appendChild(im);
      const a = Math.random() * 6.28, r = 40 + Math.random() * 60;
      im.animate([{ transform: 'translate(0,0) scale(.4) rotate(0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * r}px,${Math.sin(a) * r - 30}px) scale(1) rotate(${Math.random() * 260 - 130}deg)`, opacity: 0 }], { duration: 750 + Math.random() * 400, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => im.remove();
    }
  });
}
$('#qNext').addEventListener('click', () => {
  Voice.stop();
  closeModal('#quiz'); document.body.classList.remove('modal-open');
  const q = G.quiz; G.quiz = null;
  if (G.qi >= G.qs.length) { G.modal = 'result'; setTimeout(showResult, 120); return; }
  while (G.fruits.length < 3) spawnFruit();
  G.modal = null;
  if (q && q.ok) { G.pulseAt = performance.now(); bump('#hudLen'); }
  updateHUD();
});
// 测试钩子：立刻弹出下一题
function forceQuestion() {
  if (G.screen !== 'game' || !G.playing || G.modal === 'quiz' || G.qi >= G.qs.length) return false;
  G.modal = 'pending'; G.waiting = false; setBoardMsg(''); openQuiz(); return true;
}

/* ───────────────────────── 结算 ───────────────────────── */
function starsFor(right, total) { const r = right / total; return r >= 0.9 ? 3 : r >= 0.7 ? 2 : 1; }
const CHEER = {
  3: '太厉害了！标点符号你都认得！',
  2: '很棒哦！再玩一次，可以拿到三颗星！',
  1: '没关系，错的题多看几遍，下次一定更好！',
};
function showResult() {
  const total = G.qs.length, n = starsFor(G.right, total);
  G.playing = false; G.modal = 'result';
  $('#rTitle').textContent = G.practice ? '错题练习完成' : `${LEVELS[G.level].name}关完成`;
  $('#rStars').innerHTML = [1, 2, 3].map(i => `<img class="rs ${i <= n ? 'on' : 'off'}" style="--d:${i * 0.22}s" src="assets/star.png" alt="${i <= n ? '得到的星星' : '没得到的星星'}">`).join('');
  $('#rStars').setAttribute('aria-label', `${n} 颗星`);
  $('#rLine').innerHTML = `蛇长 <b>${G.snake.length + G.grow}</b>　答对 <b>${G.right}</b> 题　答错 <b>${G.wrong}</b> 题`;
  $('#rCheer').textContent = G.wrong === 0 ? '全部答对！' + CHEER[3] : CHEER[n];
  $('#rReview').hidden = G.wrongItems.length === 0; $('#rRetry').hidden = G.wrongItems.length === 0;
  G.stars = n;
  openModal('#result'); Sound.good();
}
$('#rAgain').addEventListener('click', () => startRound(G.level));
$('#rRetry').addEventListener('click', () => startRound(G.level, G.wrongItems.slice()));
$('#rHome').addEventListener('click', goHome);
$('#rReview').addEventListener('click', () => {
  $('#rvList').innerHTML = G.wrongItems.map((it, i) => `<li><div class="rv-n">${i + 1}</div><div><p class="fb-sent">${fullHTML(it)}</p><p class="fb-exp">${esc(it.exp)}</p></div></li>`).join('');
  closeModal('#result'); openModal('#review');
});
$('#rvClose').addEventListener('click', () => { closeModal('#review'); openModal('#result'); });

/* ───────────────────────── 首页 / 小课堂 / 音效开关 ───────────────────────── */
function goHome() {
  Voice.stop(); G.playing = false; G.modal = null; G.quiz = null;
  ['#quiz', '#result', '#review', '#lesson'].forEach(closeModal);
  document.body.classList.remove('modal-open');
  $('#stunChip').hidden = true;
  showScreen('home');
}
$$('.lv').forEach(b => b.addEventListener('click', () => {
  G.level = b.dataset.level; Sound.init();
  $$('.lv').forEach(x => x.setAttribute('aria-checked', String(x === b)));
  Sound.turn();
}));
$('#btnStart').addEventListener('click', () => { Sound.init(); startRound(G.level); });
$('#btnBack').addEventListener('click', goHome);
const LESSON = [
  { g: '。', n: '句号', d: '一句话说完了，句末用句号。', ex: '我爱我的家人<b class="pk">。</b>' },
  { g: '？', n: '问号', d: '问问题的时候，句末用问号。', ex: '你今天开心吗<b class="pk">？</b>' },
  { g: '！', n: '叹号', d: '表示赞叹、惊讶或着急的心情。', ex: '天上的彩虹太美丽了<b class="pk">！</b>' },
  { g: '，', n: '逗号', d: '句子中间要停一下，用逗号。', ex: '下雨了<b class="pk">，</b>快跑！' },
  { g: '、', n: '顿号', d: '并排的词语中间，用顿号隔开。', ex: '妈妈买了苹果<b class="pk">、</b>香蕉和橙子。' },
  { g: '：“”', n: '冒号与引号', d: '冒号带出别人说的话，话要放进引号里。', ex: '妈妈问<b class="pk">：“</b>你饿了吗？<b class="pk">”</b>' },
];
$('#lsCards').innerHTML = LESSON.map(c => `<article class="card"><div class="card-top"><span class="blk big${c.g.length > 1 ? ' wide' : ''}">${c.g.length > 1 ? `<b>${esc(c.g)}</b>` : blockHTML(c.g)}</span><h3>${c.n}</h3></div><p class="card-d">${c.d}</p><p class="card-ex">${c.ex}</p></article>`).join('');
$('#btnLesson').addEventListener('click', () => { Sound.init(); openModal('#lesson'); });
$('#lsClose').addEventListener('click', () => closeModal('#lesson'));
function setSound(on) {
  Sound.on = on; if (!on) Voice.stop();
  ['#sndHome', '#sndGame'].forEach(s => {
    const b = $(s); b.setAttribute('aria-pressed', String(on));
    b.querySelector('use').setAttribute('href', on ? '#i-speaker' : '#i-mute'); b.querySelector('span').textContent = on ? '音效 开' : '音效 关';
  });
}
['#sndHome', '#sndGame'].forEach(s => $(s).addEventListener('click', () => { Sound.init(); setSound(!Sound.on); }));
document.addEventListener('visibilitychange', () => { if (document.hidden) Voice.stop(); });
window.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#lesson').hidden) closeModal('#lesson'); else if (!$('#review').hidden) { closeModal('#review'); openModal('#result'); } } });

/* ───────────────────────── 测试钩子 ───────────────────────── */
window.__biaodian = {
  allVoiceLines,
  forceQuestion,
  state() {
    return {
      screen: G.screen, level: G.level, qi: G.qi, total: G.qs.length,
      length: G.snake.length + G.grow, snakeCells: G.snake.length, right: G.right, wrong: G.wrong,
      modal: G.modal, stunLeft: G.stunLeft, waiting: G.waiting, dir: G.dir, queue: G.queue.length,
      cols: G.cols, rows: G.rows, cell: G.cell, head: G.snake[0], fruits: G.fruits.length, stars: G.stars,
      wrongItems: G.wrongItems.map(i => i.q), qs: G.qs.map(i => i.q), practice: G.practice,
      quiz: G.quiz ? { q: G.quiz.item.q, a: G.quiz.item.a, exp: G.quiz.item.exp, slots: G.quiz.slots.slice(), done: G.quiz.done, ok: G.quiz.ok } : null,
    };
  },
  // 测试用：把小蛇的头放到指定位置并朝向，方便测撞墙
  _place(x, y, dir) { G.snake[0] = { x, y }; G.prevHead = { x, y }; G.dir = DIRS[dir]; G.waiting = false; },
  _tick: () => tick(),
  _setFruits(a) { G.fruits = a.map((f, i) => ({ x: f[0], y: f[1], kind: ['apple', 'orange', 'pear'][i % 3], phase: i })); },
};
