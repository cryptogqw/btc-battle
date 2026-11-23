// 战场动画：Canvas 2D，蓝军（多）在左，红军（空）在右
import { t as tr, fmtUsd } from './i18n.js?v=4315b376';
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

const COL = {
  blue: { main: '#3b82f6', light: '#93c5fd', dark: '#1e3a8a', armor: '#1d4ed8', glow: [80, 150, 255] },
  red: { main: '#ef4444', light: '#fca5a5', dark: '#7f1d1d', armor: '#b91c1c', glow: [255, 80, 70] },
};

const colOf = (side) => COL[side] || COL.blue;

function makeGlow(r, g, b, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); const h = size / 2;
  const gr = x.createRadialGradient(h, h, 0, h, h, h);
  gr.addColorStop(0, `rgba(255,255,255,1)`);
  gr.addColorStop(0.18, `rgba(${r},${g},${b},0.9)`);
  gr.addColorStop(0.5, `rgba(${r},${g},${b},0.25)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr; x.fillRect(0, 0, size, size); return c;
}
function makeCloud() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const cx = rand(40, 216), cy = rand(26, 40), r = rand(14, 30);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(120,110,170,0.35)'); g.addColorStop(1, 'rgba(120,110,170,0)');
    x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  return c;
}
function makeSmoke(size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); const h = size / 2;
  const gr = x.createRadialGradient(h, h, 0, h, h, h);
  gr.addColorStop(0, 'rgba(70,70,85,0.55)'); gr.addColorStop(0.6, 'rgba(50,50,65,0.25)'); gr.addColorStop(1, 'rgba(40,40,50,0)');
  x.fillStyle = gr; x.fillRect(0, 0, size, size); return c;
}

const RM = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export class Battle {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.front = 0.5; this.frontTarget = 0.5; this.surge = null; this.surgeT = 0;
    this.soldiers = []; this.bullets = []; this.shells = []; this.parts = []; this.smoke = [];
    this.rings = []; this.texts = []; this.scorch = []; this.streaks = []; this.embers = [];
    this.shake = 0; this.flash = 0; this.flashCol = '255,255,255'; this.t = 0;
    this.pending = { blue: 0, red: 0 }; this.intensity = 0; this.queue = [];
    this.th = { small: 4000, shell: 50000, heavy: 250000, whale: 1e6 }; this.activity = { blue: 0, red: 0 }; this.popAcc = { blue: 0, red: 0 }; this.zoom = 1; this.celebrateT = 0;
    this.sprites = {
      blue: makeGlow(...COL.blue.glow), red: makeGlow(...COL.red.glow),
      fire: makeGlow(255, 160, 50), white: makeGlow(255, 240, 220), smoke: makeSmoke(), cloud: makeCloud(),
    };
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    if (window.ResizeObserver) new ResizeObserver(this.resize).observe(canvas);
    this.resize();
    this._initWeather();
    for (let i = 0; i < 40; i++) this.embers.push(this._ember(true));
  }

  // ---------- 布局 ----------
  resize() {
    const r = (this.sizeEl || this.cv).getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!r.width || !r.height) return;
    this.W = r.width; this.H = r.height; this.dpr = dpr;
    if (!this.sizeEl) { this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr); }
    const oT = this.laneTop, oB = this.laneBot, oW = this.W0;
    this.horizon = this.H * 0.4; this.laneTop = this.H * 0.52; this.laneBot = this.H * 0.93;
    if (oT != null && oB > oT) for (const s of this.soldiers) { s.y = this.laneTop + (s.y - oT) / (oB - oT) * (this.laneBot - this.laneTop); if (oW) s.x *= this.W / oW; }
    this.W0 = this.W;
    this.baseL = Math.max(34, this.W * 0.055); this.baseR = this.W - this.baseL;
    this.N = Math.round(clamp(this.W / 16, 22, 70));
    this._buildArt();
  }
  // 经典 Canvas 2D 版的预渲染图层（WebGL 版会覆盖这个方法）
  _buildArt() {
    this._bg = this._renderBg();
    const strip = (c0, c1) => { const c = document.createElement('canvas'); c.width = 128; c.height = 1; const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 128, 0); g.addColorStop(0, c0); g.addColorStop(1, c1); x.fillStyle = g; x.fillRect(0, 0, 128, 1); return c; };
    this._tintB = strip('rgba(37,99,235,0.28)', 'rgba(37,99,235,0.05)');
    this._tintR = strip('rgba(220,38,38,0.05)', 'rgba(220,38,38,0.28)');
    { // 暗角（半分辨率预渲染）
      const c = document.createElement('canvas'); const W = this.W, H = this.H; c.width = Math.ceil(W / 2); c.height = Math.ceil(H / 2);
      const x = c.getContext('2d'); x.scale(0.5, 0.5);
      const v = x.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.4, W / 2, H * 0.55, Math.max(W, H) * 0.8);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)'); x.fillStyle = v; x.fillRect(0, 0, W, H);
      this._vig = c;
    }
  }
  scaleAt(y) { return 0.55 + 0.75 * clamp((y - this.horizon) / (this.H - this.horizon), 0, 1.2); }
  frontX(y = 0) {
    const f = this.W * clamp(0.5 + (this.front - 0.5) * 1.5, 0.15, 0.85);
    return f + Math.sin(y * 0.045 + this.t * 2.2) * 5 + Math.sin(y * 0.11 - this.t * 3.1) * 3;
  }

  _renderBg() {
    const { W, H } = this; const c = document.createElement('canvas');
    c.width = Math.round(W * this.dpr); c.height = Math.round(H * this.dpr);
    const x = c.getContext('2d'); x.scale(this.dpr, this.dpr);
    const sky = x.createLinearGradient(0, 0, 0, this.horizon);
    sky.addColorStop(0, '#05070f'); sky.addColorStop(0.6, '#0d1230'); sky.addColorStop(1, '#2a1838');
    x.fillStyle = sky; x.fillRect(0, 0, W, this.horizon + 2);
    // 星空
    for (let i = 0; i < W * 0.12; i++) {
      x.fillStyle = `rgba(255,255,255,${rand(0.15, 0.7)})`;
      const s = Math.random() < 0.1 ? 1.6 : 0.9;
      x.fillRect(Math.random() * W, Math.random() * this.horizon * 0.85, s, s);
    }
    // 月亮
    const mg = x.createRadialGradient(W * 0.5, H * 0.13, 0, W * 0.5, H * 0.13, H * 0.2);
    mg.addColorStop(0, 'rgba(255,240,210,0.9)'); mg.addColorStop(0.12, 'rgba(255,220,170,0.6)');
    mg.addColorStop(0.13, 'rgba(255,200,140,0.12)'); mg.addColorStop(1, 'rgba(255,200,140,0)');
    x.fillStyle = mg; x.fillRect(0, 0, W, this.horizon);
    // 远山两层（独立图层，用于视差）
    const PAD = this.PAD = 90;
    const mtn = (base, amp, col, seed, rim) => {
      const m = document.createElement('canvas');
      m.width = Math.round((W + PAD * 2) * this.dpr); m.height = Math.round((this.horizon + 4) * this.dpr);
      const y2 = m.getContext('2d'); y2.scale(this.dpr, this.dpr);
      y2.fillStyle = col; y2.beginPath(); y2.moveTo(0, this.horizon + 4);
      const pts = [];
      for (let px = 0; px <= W + PAD * 2 + 10; px += 8) {
        const y = base - amp * (0.5 + 0.3 * Math.sin(px * 0.008 + seed) + 0.2 * Math.sin(px * 0.023 + seed * 2) + 0.1 * Math.sin(px * 0.07 + seed));
        y2.lineTo(px, y); pts.push([px, y]);
      }
      y2.lineTo(W + PAD * 2 + 10, this.horizon + 4); y2.closePath(); y2.fill();
      y2.strokeStyle = rim; y2.lineWidth = 1; y2.beginPath(); pts.forEach(([a, b], i) => i ? y2.lineTo(a, b) : y2.moveTo(a, b)); y2.stroke();
      return m;
    };
    this._mtnFar = mtn(this.horizon, H * 0.17, '#15163a', 1.3, 'rgba(160,140,255,0.18)');
    this._mtnNear = mtn(this.horizon + 2, H * 0.09, '#0b0c1e', 4.1, 'rgba(255,150,170,0.12)');
    // 地面
    const g = x.createLinearGradient(0, this.horizon, 0, H);
    g.addColorStop(0, '#1a1426'); g.addColorStop(0.35, '#121522'); g.addColorStop(1, '#07080f');
    x.fillStyle = g; x.fillRect(0, this.horizon, W, H - this.horizon);
    // 透视网格
    x.strokeStyle = 'rgba(140,160,255,0.06)'; x.lineWidth = 1;
    for (let i = -20; i <= 20; i++) {
      x.beginPath(); x.moveTo(W / 2 + i * W * 0.02, this.horizon); x.lineTo(W / 2 + i * W * 0.14, H); x.stroke();
    }
    for (let i = 1; i < 9; i++) {
      const yy = this.horizon + (H - this.horizon) * Math.pow(i / 9, 1.8);
      x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy); x.stroke();
    }
    return c;
  }

  _initWeather() {
    const W = this.W || 800;
    this.clouds = Array.from({ length: 7 }, () => ({ x: rand(-100, W + 100), y: rand(0.04, 0.26), w: rand(140, 320), h: rand(30, 60), v: rand(4, 12), a: rand(0.18, 0.4) }));
    this.fog = Array.from({ length: 9 }, () => ({ x: rand(-100, W + 100), w: rand(180, 380), h: rand(40, 80), v: rand(-8, 8), a: rand(0.25, 0.5) }));
    this.bolts = [];
  }
  _drawClouds(off) {
    const { ctx, H } = this;
    for (const c of this.clouds) {
      ctx.globalAlpha = c.a;
      ctx.drawImage(this.sprites.cloud, c.x - c.w / 2 - off, c.y * H - c.h / 2, c.w, c.h);
    }
    ctx.globalAlpha = 1;
  }
  _drawLightning() {
    const { ctx } = this;
    for (const b of this.bolts) {
      const k = b.life / b.max;
      ctx.globalCompositeOperation = 'lighter';
      for (const [w, a] of [[6, 0.15], [2, 0.9]]) {
        ctx.strokeStyle = `rgba(${b.col},${a * k})`; ctx.lineWidth = w; ctx.beginPath();
        b.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  _bolt(side) {
    let x = rand(this.W * 0.15, this.W * 0.85), y = 0; const pts = [[x, y]];
    while (y < this.horizon - 10) { y += rand(10, 26); x += rand(-22, 22); pts.push([x, y]); }
    const col = side === 'red' ? '255,190,180' : '190,215,255';
    this.bolts.push({ pts, life: 0.22, max: 0.22, col });
    this.flash = Math.max(this.flash, 0.18); this.flashCol = col;
  }
  /** 每方近期真实主动成交活跃度（0=无成交，1≈常态，上限 2） */
  setActivity(blue, red) { this.activity.blue = clamp(blue, 0, 2); this.activity.red = clamp(red, 0, 2); }
  setThresholds(th) { Object.assign(this.th, th); }
  /** 行情天气目标值（0~1）：storm 暴风雨 / erupt 火山喷发 / blood 血月 / glory 圣光 / fog 薄雾，tone 24h 色调（-1~1）。经典版不绘制 */
  setWeather(w) { this.wxT = w; }
  /** 镜头跟随前线（仅 WebGL 版） */
  setCamFollow(on) { this.camFollow = !!on; }
  reset() {
    this.bullets = []; this.shells = []; this.parts = []; this.texts = []; this.queue = []; this.rings = [];
    this.pending = { blue: 0, red: 0 }; this.front = this.frontTarget = 0.5; this.surge = null;
  }
  // 胜利烟花
  celebrate(side) {
    this.celebrateT = 4; this.celebrateSide = side;
  }
  _firework(side) {
    const x = rand(this.W * 0.1, this.W * 0.9), y = rand(this.H * 0.06, this.horizon * 0.85);
    const c = side === 'blue' ? ['#93c5fd', '#60a5fa', '#e0f2fe', '#fbbf24'] : ['#fca5a5', '#f87171', '#fee2e2', '#fbbf24'];
    this.parts.push({ type: 'glow', spr: side, x, y, vx: 0, vy: 0, life: 0.5, max: 0.5, size: 90, add: true, grow: 1 });
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * TAU, sp = rand(90, 190);
      this.parts.push({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.8, 1.4), max: 1.4, col: c[i % c.length], w: 2, light: true });
    }
  }

  // ---------- 对外接口 ----------
  setFront(v) { this.frontTarget = clamp(v, 0.04, 0.96); }
  setSurge(side) { this.surge = side; }
  /** side: 'buy'|'sell'; usd: 成交额 */
  fire(side, usd, qty) {
    if (this.queue.length > 300) this.queue.shift();
    this.queue.push({ side: side === 'buy' ? 'blue' : 'red', usd, qty });
  }

  // ---------- 士兵 ----------
  _spawnSoldier(side, atBase = true) {
    const y = rand(this.laneTop, this.laneBot);
    const base = side === 'blue' ? this.baseL : this.baseR;
    const fx = this.frontX(y);
    const d = Math.pow(Math.random(), 1.7);
    const x = atBase ? base + (side === 'blue' ? rand(-10, 20) : rand(-20, 10)) : lerp(fx, base, d * 0.8 + 0.1);
    this.soldiers.push({ side, x, y, d, phase: rand(0, TAU), speed: rand(28, 48), cool: rand(0.3, 2.5), dead: false, dieT: 0, hit: 0, rot: 0 });
  }
  _killNear(side, x, y, r) { // 杀死 side 一方在 (x,y) 半径内的士兵
    let k = 0;
    for (const s of this.soldiers) {
      if (s.dead || s.side !== side) continue;
      const dx = s.x - x, dy = (s.y - y) * 1.6;
      if (dx * dx + dy * dy < r * r) { s.dead = true; s.dieT = 0; s.vx = Math.sign(dx || 1) * rand(30, 90); s.vy = -rand(40, 120); k++; }
    }
    return k;
  }

  // ---------- 弹药 ----------
  _bullet(side, sx, sy, tx, ty, big = false) {
    const dx = tx - sx, dy = ty - sy, d = Math.hypot(dx, dy) || 1, sp = big ? 900 : rand(650, 900);
    this.bullets.push({ side, x: sx, y: sy, vx: dx / d * sp, vy: dy / d * sp, life: d / sp, big });
  }
  _shell(side, usd, kind) {
    const blue = side === 'blue';
    const sx = blue ? this.baseL + 18 : this.baseR - 18, sy = this.H * 0.6;
    const ty = rand(this.laneTop, this.laneBot);
    const fx = this.frontX(ty);
    const ebase = blue ? this.baseR : this.baseL;
    const tx = lerp(fx + (blue ? 20 : -20), ebase, Math.pow(Math.random(), 1.3) * 0.85);
    const T = kind === 'whale' ? 0.9 : rand(0.85, 1.35);
    const s = { side, usd, kind, sx, sy, tx, ty, t: 0, T, x: sx, y: sy, h: this.H * (kind === 'whale' ? 0 : rand(0.25, 0.42)) };
    if (kind === 'whale') { // 空袭：从天而降
      s.sx = blue ? rand(-60, this.W * 0.2) : rand(this.W * 0.8, this.W + 60); s.sy = -40;
    } else {
      this._muzzle(sx, sy, side, kind === 'heavy' ? 1.6 : 1);
      this.onCast && this.onCast(side, kind, !!this._mini); // 施法 / 发射音效
    }
    this.shells.push(s);
  }
  _muzzle(x, y, side, k = 1) {
    this.parts.push({ type: 'glow', spr: 'fire', x, y, vx: 0, vy: 0, life: 0.18, max: 0.18, size: 34 * k, add: true });
    for (let i = 0; i < 6 * k; i++) this._smoke(x, y, rand(6, 12) * k, rand(-20, 20), rand(-30, -10));
  }
  _smoke(x, y, size, vx = rand(-12, 12), vy = rand(-26, -8), life = rand(1.4, 2.6)) {
    if (this.smoke.length > 220) this.smoke.shift();
    this.smoke.push({ x, y, vx, vy, size, life, max: life, rot: rand(0, TAU) });
  }
  explode(x, y, side, power, opts = {}) {
    // power: 1(小) ~ 10(巨鲸)
    const enemy = side === 'blue' ? 'red' : 'blue';
    const R = 14 + power * 9;
    const spr = side;
    this.parts.push({ type: 'glow', spr: 'white', x, y, vx: 0, vy: 0, life: 0.25, max: 0.25, size: R * 2.2, add: true });
    this.parts.push({ type: 'glow', spr: 'fire', x, y, vx: 0, vy: 0, life: 0.55, max: 0.55, size: R * 3, add: true, grow: 1.5 });
    this.parts.push({ type: 'glow', spr, x, y, vx: 0, vy: 0, life: 0.8, max: 0.8, size: R * 3.4, add: true, grow: 1.2 });
    const n = Math.min(14 + power * 10, 90);
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI, TAU) + rand(-0.3, 0.3), sp = rand(60, 160) * (0.6 + power * 0.25);
      this.parts.push({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.4, 1.0), max: 1, col: Math.random() < 0.5 ? '#ffd27a' : colOf(side).light, w: rand(1, 2.4) });
    }
    for (let i = 0; i < Math.min(4 + power * 2, 20); i++) {
      const a = rand(Math.PI * 1.1, Math.PI * 1.9), sp = rand(80, 220);
      this.parts.push({ type: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.8, 1.6), max: 1.6, s: rand(1.5, 3.5), rot: rand(0, TAU), vr: rand(-10, 10) });
    }
    for (let i = 0; i < Math.min(5 + power * 3, 28); i++) this._smoke(x + rand(-R, R) * 0.6, y - rand(0, R * 0.6), rand(R * 0.5, R * 1.1), rand(-20, 20), rand(-40, -12), rand(1.6, 3.4));
    this.rings.push({ x, y, r: 4, max: R * (opts.whale ? 6 : 2.6), life: opts.whale ? 0.9 : 0.5, t: 0, col: colOf(side).glow });
    if (this.scorch.length > 40) this.scorch.shift();
    this.scorch.push({ x, y, r: R * 0.9, life: 14 });
    this.shake = Math.max(this.shake, Math.min(2 + power * 1.5, 18));
    if (power >= 6) { this.flash = Math.min(0.55, 0.15 + power * 0.04); this.flashCol = side === 'blue' ? '150,190,255' : '255,160,150'; }
    this._killNear(enemy, x, y, R * 1.1);
  }
  _ember(init) {
    return { x: rand(0, this.W || 800), y: init ? rand(0, this.H || 400) : (this.H || 400) + 5, vy: rand(-12, -30), vx: rand(-6, 6), s: rand(0.6, 1.8), a: rand(0.2, 0.7), ph: rand(0, TAU) };
  }

  // ---------- 主循环 ----------
  start() {
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      if (this.W) { this.update(dt); this.draw(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  _processQueue() {
    // 每帧最多处理一定数量，防止切回标签页时爆发
    let budget = 40;
    while (this.queue.length && budget-- > 0) {
      const { side, usd } = this.queue.shift();
      this.intensity = Math.min(this.intensity + Math.log10(usd + 10) * 0.08, 6);
      if (usd >= this.th.whale) {
        this._shell(side, usd, 'whale');
        this.onWhale && this.onWhale(side, usd);
      } else if (usd >= this.th.heavy) this._shell(side, usd, 'heavy');
      else if (usd >= this.th.shell) this._shell(side, usd, 'shell');
      else {
        this.pending[side] += usd;
        if (usd >= this.th.small * 2) this._reinforce(side); // 中等成交 → 增援（确定性）
      }
    }
    // 小额成交 → 前线步枪齐射（节流）
    for (const side of ['blue', 'red']) {
      let shots = 0;
      while (this.pending[side] > this.th.small && shots < 3) {
        this.pending[side] -= this.th.small; shots++;
        this._rifle(side);
      }
      this.pending[side] = Math.min(this.pending[side], 60000);
    }
  }
  _reinforce(side) {
    const alive = this.soldiers.filter(s => !s.dead && s.side === side).length;
    if (alive < this.N * 1.15) this._spawnSoldier(side, true);
  }
  _rifle(side) {
    const cands = this.soldiers.filter(s => !s.dead && s.side === side);
    if (!cands.length) return;
    // 选择靠近前线的士兵
    let best = cands[(Math.random() * cands.length) | 0];
    for (let i = 0; i < 3; i++) {
      const c = cands[(Math.random() * cands.length) | 0];
      if (Math.abs(c.x - this.frontX(c.y)) < Math.abs(best.x - this.frontX(best.y))) best = c;
    }
    this._shoot(best);
  }
  _shoot(s) {
    const sc = this.scaleAt(s.y), dir = s.side === 'blue' ? 1 : -1;
    const sx = s.x + dir * 12 * sc, sy = s.y - 13 * sc;
    const ty = clamp(s.y + rand(-30, 30), this.laneTop, this.laneBot);
    const tx = this.frontX(ty) + dir * rand(15, 120);
    this._bullet(s.side, sx, sy, tx, ty - 10 * this.scaleAt(ty));
    this.parts.push({ type: 'glow', spr: 'fire', x: sx, y: sy, vx: 0, vy: 0, life: 0.07, max: 0.07, size: 14 * sc, add: true });
    s.recoil = 0.12;
  }

  update(dt) {
    this.t += dt;
    this.front = lerp(this.front, this.frontTarget, 1 - Math.exp(-dt * 1.4));
    this.intensity *= Math.exp(-dt * 0.8);
    this.surgeT = this.surge ? Math.min(this.surgeT + dt * 2, 1) : Math.max(this.surgeT - dt * 1.5, 0);
    if (this.surge) this.lastSurge = this.surge;
    this._processQueue();

    // 兵力目标：随战力变化
    const share = { blue: this.front, red: 1 - this.front };
    for (const side of ['blue', 'red']) {
      const alive = this.soldiers.filter(s => !s.dead && s.side === side);
      const target = Math.round(this.N * (0.3 + 0.9 * share[side]));
      // 兵力向战力目标收敛（固定节奏，不随机）
      this.popAcc[side] += dt;
      if (alive.length < target && this.popAcc[side] >= 0.16) { this.popAcc[side] = 0; this._spawnSoldier(side, this.soldiers.length > 0); }
      if (alive.length > target + 3 && this.popAcc[side] >= 0.5) {
        this.popAcc[side] = 0;
        // 战损：前线士兵阵亡
        let f = alive[0];
        for (const s of alive) if (Math.abs(s.x - this.frontX(s.y)) < Math.abs(f.x - this.frontX(f.y))) f = s;
        f.dead = true; f.dieT = 0; f.vx = (side === 'blue' ? -1 : 1) * rand(20, 60); f.vy = -rand(30, 80);
        this.parts.push({ type: 'glow', spr: side === 'blue' ? 'red' : 'blue', x: f.x, y: f.y - 12, vx: 0, vy: 0, life: 0.2, max: 0.2, size: 26, add: true });
      }
    }

    // 士兵移动 / 射击
    for (const s of this.soldiers) {
      if (s.dead) {
        s.dieT += dt; s.x += (s.vx || 0) * dt * Math.max(0, 1 - s.dieT * 2); s.rot = Math.min(s.dieT * 4, Math.PI / 2) * (s.side === 'blue' ? -1 : 1);
        continue;
      }
      const blue = s.side === 'blue', dir = blue ? 1 : -1;
      const fx = this.frontX(s.y), base = blue ? this.baseL : this.baseR;
      const surging = this.surge === s.side && !s.hold; // 弓兵（hold）不参与冲锋
      const depth = surging ? s.d * 0.35 : s.d;
      let tx = fx - dir * (12 + depth * Math.abs(fx - base) * 0.82);
      if (surging) tx += dir * 10 * Math.sin(this.t * 3 + s.phase);
      const dx = tx - s.x, sp = s.speed * (surging ? 2.2 : 1) * (Math.abs(dx) > 80 ? 1.6 : 1) * (s.ranged && dx * dir < 0 ? 0.45 : 1); // 弓兵后撤慢
      s.moving = Math.abs(dx) > 3;
      s.x += clamp(dx, -sp * dt, sp * dt);
      s.phase += dt * (s.moving ? 11 : 2.5) * (surging ? 1.4 : 1);
      s.facing = s.moving ? Math.sign(dx) : dir;
      if (s.recoil) s.recoil = Math.max(0, s.recoil - dt);
      if (s.ranged && (fx - s.x) * dir < 10) { // 敌军冲到弓兵阵中：弓兵被击倒
        s.dead = true; s.dieT = 0; s.vx = -dir * rand(20, 50); s.vy = -rand(30, 70);
        this.parts.push({ type: 'glow', spr: blue ? 'red' : 'blue', x: s.x, y: s.y - 12, vx: 0, vy: 0, life: 0.2, max: 0.2, size: 26, add: true });
        continue;
      }
      const nearFront = Math.abs(s.x - fx) < 70 || s.ranged; // 弓兵在后排也持续放箭
      // 待机射击频率 ∝ 该方近 10 秒真实主动成交额；无成交时几乎不开火
      s.cool -= dt * (s.ranged ? Math.max(this.activity[s.side] || 0, 0.3) : (this.activity[s.side] || 0)); // 弓兵保底射速：后排一直有箭雨
      if (!nearFront && s.cool < 0) s.cool = 0;
      if (nearFront && s.cool <= 0) { this._shoot(s); s.cool = rand(0.9, 1.8); }
    }
    this.soldiers = this.soldiers.filter(s => !s.dead || s.dieT < 2.2);

    // 子弹
    for (const b of this.bullets) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) {
        for (let i = 0; i < 4; i++) this.parts.push({ type: 'spark', x: b.x, y: b.y, vx: rand(-80, 80), vy: rand(-110, -20), life: rand(0.15, 0.35), max: 0.35, col: colOf(b.side).light, w: 1.2 });
        if (Math.random() < 0.06) this._killNear(b.side === 'blue' ? 'red' : 'blue', b.x, b.y + 10, 9);
      }
    }
    this.bullets = this.bullets.filter(b => b.life > 0);
    if (this.bullets.length > 400) this.bullets.splice(0, this.bullets.length - 400);

    // 炮弹
    for (const s of this.shells) {
      s.t += dt; const k = Math.min(s.t / s.T, 1);
      const px = s.x, py = s.y;
      if (s.kind === 'whale' || s.fall) { const e = k * k; s.x = lerp(s.sx, s.tx, e); s.y = lerp(s.sy, s.ty, e); }
      else { s.x = lerp(s.sx, s.tx, k); s.y = lerp(s.sy, s.ty, k) - s.h * 4 * k * (1 - k); }
      s.ang = Math.atan2(s.y - py, s.x - px);
      const trailN = s.kind === 'whale' ? 4 : s.kind === 'heavy' ? 2 : 1;
      for (let i = 0; i < trailN; i++) {
        this.parts.push({ type: 'glow', spr: s.side, x: s.x + rand(-2, 2), y: s.y + rand(-2, 2), vx: rand(-10, 10), vy: rand(-10, 10), life: 0.35, max: 0.35, size: s.kind === 'whale' ? 30 : s.kind === 'heavy' ? 18 : 12, add: true });
        if (s.kind !== 'shell' && Math.random() < 0.6) this._smoke(s.x, s.y, s.kind === 'whale' ? 12 : 7, rand(-8, 8), rand(-8, 4), 1.2);
      }
      if (k >= 1) {
        s.done = true;
        const power = s.power != null ? s.power : s.kind === 'whale' ? clamp(6 + Math.log10(s.usd / this.th.whale) * 4, 6, 10) : s.kind === 'heavy' ? clamp(3 + Math.log10(s.usd / this.th.heavy) * 3, 3, 5.5) : clamp(1 + Math.log10(s.usd / this.th.shell) * 2, 1, 2.8);
        this.explode(s.x, s.y, s.side, power, { whale: s.kind === 'whale' });
        if (s.kind !== 'whale' && this.onBoom) this.onBoom(s.side, power); // 巨鲸的落地声已包含在它自己的音效里
        // 伤害数字
        const lvl = s.kind === 'whale' ? 3 : s.kind === 'heavy' ? 2 : 1;
        if (!s.noText) this.texts.push({ x: s.x + rand(-10, 10), y: s.y - 24, vx: rand(-14, 14), txt: (lvl === 3 ? tr('crit') : '-') + fmtUsd(s.usd), side: s.side, life: 1.4 + lvl * 0.3, max: 1.4 + lvl * 0.3, lvl });
        if (s.kind === 'whale') { this.zoom = 1.07; this.shake = Math.max(this.shake, 22); }
      }
    }
    this.shells = this.shells.filter(s => !s.done);

    // 前线火花（交战激烈程度）
    const rate = this.intensity * 14; // 只由真实成交强度驱动
    if (Math.random() < rate * dt) {
      const y = rand(this.laneTop, this.laneBot), x = this.frontX(y);
      for (let i = 0; i < 3; i++) this.parts.push({ type: 'spark', x, y: y - rand(0, 20), vx: rand(-90, 90), vy: rand(-140, -30), life: rand(0.3, 0.6), max: 0.6, col: Math.random() < 0.5 ? '#bcd4ff' : '#ffc0b8', w: 1.4 });
      if (Math.random() < 0.3) this._smoke(x, y - 10, rand(8, 16));
    }

    // 粒子
    for (const p of this.parts) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'spark' || p.type === 'debris') { p.vy += 320 * dt; p.vx *= 0.985; }
      if (p.type === 'debris') { p.rot += p.vr * dt; if (p.y > this.H) p.life = 0; }
    }
    this.parts = this.parts.filter(p => p.life > 0);
    if (this.parts.length > 1400) this.parts.splice(0, this.parts.length - 1400);
    for (const s of this.smoke) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.99; s.size += dt * 10; }
    this.smoke = this.smoke.filter(s => s.life > 0);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter(r => r.t < r.life);
    for (const t of this.texts) { t.life -= dt; t.y -= dt * (22 + t.lvl * 6); t.x += (t.vx || 0) * dt; }
    for (const c of this.clouds) { c.x += c.v * dt; if (c.x - c.w / 2 > this.W + 120) c.x = -c.w / 2 - 120; }
    for (const f of this.fog) { f.x += f.v * dt; if (f.x > this.W + 250) f.x = -250; if (f.x < -250) f.x = this.W + 250; }
    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter(b => b.life > 0);
    if (this.surgeT > 0.5 && Math.random() < dt * 0.35) this._bolt(this.lastSurge);
    if (this.celebrateT > 0) { this.celebrateT -= dt; if (Math.random() < dt * 4) this._firework(this.celebrateSide); }
    this.zoom = 1 + (this.zoom - 1) * Math.exp(-dt * 4);
    this.texts = this.texts.filter(t => t.life > 0);
    for (const s of this.scorch) s.life -= dt;
    this.scorch = this.scorch.filter(s => s.life > 0);
    for (const e of this.embers) { e.x += (e.vx + Math.sin(this.t + e.ph) * 6) * dt; e.y += e.vy * dt; if (e.y < -5) Object.assign(e, this._ember(false)); }

    // 冲锋速度线
    if (this.surgeT > 0.2 && Math.random() < dt * 30 * this.surgeT) {
      const side = this.lastSurge || this.surge || 'blue', dir = side === 'blue' ? 1 : -1;
      this.streaks.push({ x: dir > 0 ? -100 : this.W + 100, y: rand(this.H * 0.15, this.H * 0.95), v: dir * rand(900, 1500), len: rand(60, 180), side, life: 1.5 });
    }
    for (const s of this.streaks) { s.x += s.v * dt; s.life -= dt; }
    this.streaks = this.streaks.filter(s => s.life > 0);

    this.shake *= Math.exp(-dt * 7); this.flash *= Math.exp(-dt * 5);
    if (RM && RM.matches) { this.shake = 0; this.zoom = 1; this.flash = Math.min(this.flash, 0.12); } // 系统“减少动态效果”：不震屏、不缩放、弱闪光
  }

  // ---------- 绘制 ----------
  draw() {
    const { ctx, W, H, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    ctx.save(); ctx.translate(sx, sy);
    if (this.zoom > 1.001) { ctx.translate(W / 2, H / 2); ctx.scale(this.zoom, this.zoom); ctx.translate(-W / 2, -H / 2); }
    ctx.drawImage(this._bg, -6, -6, W + 12, H + 12);
    // 视差：镜头随前线推进方向平移
    const cam = (this.front - 0.5) * 120;
    this._drawClouds(cam * 0.15);
    ctx.drawImage(this._mtnFar, -this.PAD - cam * 0.25, 0, W + this.PAD * 2, this.horizon + 4);
    ctx.drawImage(this._mtnNear, -this.PAD - cam * 0.5, 0, W + this.PAD * 2, this.horizon + 4);
    this._drawLightning();
    // 地平线雾
    for (const f of this.fog) {
      ctx.globalAlpha = f.a; ctx.drawImage(this.sprites.smoke, f.x - f.w / 2 - cam * 0.6, this.horizon - f.h * 0.45, f.w, f.h);
    }
    ctx.globalAlpha = 1;

    // 领地色调
    const fx = this.frontX(this.H * 0.7);
    ctx.drawImage(this._tintB, 0, this.horizon - 40, fx, H);
    ctx.drawImage(this._tintR, fx, this.horizon - 40, W - fx, H);

    // 弹坑
    for (const s of this.scorch) {
      const a = Math.min(1, s.life / 4) * 0.55;
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.beginPath(); ctx.ellipse(s.x, s.y + 2, s.r, s.r * 0.32, 0, 0, TAU); ctx.fill();
    }

    this._drawBase('blue'); this._drawBase('red');
    this._drawFrontLine();

    // 士兵按 y 排序（远小近大）
    this.soldiers.sort((a, b) => a.y - b.y);
    for (const s of this.soldiers) this._drawSoldier(s);

    // 烟雾
    for (const s of this.smoke) {
      const a = Math.min(1, s.life / s.max * 1.4) * 0.8;
      ctx.globalAlpha = a; ctx.drawImage(this.sprites.smoke, s.x - s.size, s.y - s.size, s.size * 2, s.size * 2);
    }
    ctx.globalAlpha = 1;

    // 发光层（叠加混合）
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.bullets) {
      const len = 0.03;
      ctx.strokeStyle = b.side === 'blue' ? 'rgba(147,197,253,0.95)' : 'rgba(252,165,165,0.95)';
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * len, b.y - b.vy * len); ctx.stroke();
      ctx.drawImage((this.sprites[b.side] || this.sprites.blue), b.x - 6, b.y - 6, 12, 12);
    }
    for (const p of this.parts) {
      const k = clamp(p.life / p.max, 0, 1);
      if (p.type === 'glow') {
        const sz = p.size * (p.grow ? 1 + (1 - k) * p.grow : 1);
        ctx.globalAlpha = k; ctx.drawImage((this.sprites[p.spr] || this.sprites.white), p.x - sz / 2, p.y - sz / 2, sz, sz);
      } else if (p.type === 'spark') {
        ctx.globalAlpha = k; ctx.strokeStyle = p.col; ctx.lineWidth = p.w;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
      }
    }
    for (const s of this.shells) {
      const big = s.kind === 'whale' ? 3 : s.kind === 'heavy' ? 2 : 1.3;
      ctx.globalAlpha = 1;
      ctx.drawImage(this.sprites.white, s.x - 8 * big, s.y - 8 * big, 16 * big, 16 * big);
      ctx.drawImage((this.sprites[s.side] || this.sprites.blue), s.x - 16 * big, s.y - 16 * big, 32 * big, 32 * big);
    }
    for (const r of this.rings) {
      const k = r.t / r.life, rad = lerp(r.r, r.max, 1 - Math.pow(1 - k, 3));
      ctx.globalAlpha = (1 - k) * 0.8; ctx.strokeStyle = `rgb(${r.col.join(',')})`; ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, rad * 0.4, 0, 0, TAU); ctx.stroke();
    }
    // 速度线
    for (const s of this.streaks) {
      const c = colOf(s.side).glow;
      const gr = ctx.createLinearGradient(s.x, 0, s.x - Math.sign(s.v) * s.len, 0);
      gr.addColorStop(0, `rgba(${c.join(',')},${0.55 * this.surgeT})`); gr.addColorStop(1, `rgba(${c.join(',')},0)`);
      ctx.globalAlpha = 1; ctx.strokeStyle = gr; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - Math.sign(s.v) * s.len, s.y); ctx.stroke();
    }
    // 余烬
    for (const e of this.embers) {
      ctx.globalAlpha = e.a * (0.6 + 0.4 * Math.sin(this.t * 3 + e.ph));
      ctx.fillStyle = e.x < fx ? '#93c5fd' : '#fca5a5'; ctx.fillRect(e.x, e.y, e.s, e.s);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // 碎片
    ctx.fillStyle = '#2a2a35';
    for (const p of this.parts) if (p.type === 'debris') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.s, -p.s / 2, p.s * 2, p.s); ctx.restore();
    }
    // 飘字
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.life / t.max;
      const age = t.max - t.life, pop = age < 0.18 ? 0.6 + (age / 0.18) * 0.7 : age < 0.3 ? 1.3 - (age - 0.18) / 0.12 * 0.3 : 1;
      ctx.globalAlpha = Math.min(1, k * 2.5);
      const fs = [0, 13, 17, 26][t.lvl || 1] * pop;
      ctx.font = `900 ${fs}px "JetBrains Mono", monospace`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(t.txt, t.x, t.y);
      ctx.fillStyle = t.lvl === 3 ? '#fde68a' : t.side === 'blue' ? '#bfdbfe' : '#fecaca'; ctx.fillText(t.txt, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // 冲锋氛围 & 闪光
    if (this.surgeT > 0) {
      const c = COL[this.lastSurge || 'blue'].glow, pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(${c.join(',')},${(0.22 + 0.12 * pulse) * this.surgeT})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
    if (this.flash > 0.01) { ctx.fillStyle = `rgba(${this.flashCol},${this.flash})`; ctx.fillRect(0, 0, W, H); }
    // 暗角
    ctx.drawImage(this._vig, 0, 0, W, H);
  }

  _drawFrontLine() {
    const { ctx } = this; const top = this.horizon - 10, bot = this.H;
    const pts = [];
    for (let y = top; y <= bot; y += 6) pts.push([this.frontX(y), y]);
    const x0 = this.frontX(this.H * 0.7);
    ctx.globalCompositeOperation = 'lighter';
    const passes = [[20, 0.09], [5, 0.45], [1.5, 0.9]];
    for (const [w, a] of passes) {
      const g = ctx.createLinearGradient(x0 - 20, 0, x0 + 20, 0);
      g.addColorStop(0, `rgba(80,150,255,${a})`); g.addColorStop(0.5, `rgba(255,255,255,${a})`); g.addColorStop(1, `rgba(255,80,70,${a})`);
      ctx.strokeStyle = g; ctx.lineWidth = w; ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    // 前线根部的光晕
    const fy = this.H * 0.75;
    ctx.globalAlpha = 0.5 + this.intensity * 0.05;
    ctx.drawImage(this.sprites.white, x0 - 50, fy - 90, 100, 180);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  _drawBase(side) {
    const { ctx, H } = this; const blue = side === 'blue';
    const c = colOf(side); const x = blue ? this.baseL : this.baseR; const by = H * 0.66;
    const w = clamp(this.W * 0.05, 30, 54), h = clamp(H * 0.32, 80, 170);
    // 底部光晕
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6;
    ctx.drawImage(this.sprites[side], x - w * 2, by - h * 0.9, w * 4, h * 1.6);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // 塔身
    const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    g.addColorStop(0, '#0b1020'); g.addColorStop(blue ? 0.85 : 0.15, c.dark); g.addColorStop(1, '#0b1020');
    ctx.fillStyle = g; ctx.beginPath();
    ctx.moveTo(x - w / 2 - 6, by); ctx.lineTo(x - w / 2, by - h); 
    const cren = 4; const cw = w / (cren * 2 - 1);
    for (let i = 0; i < cren * 2 - 1; i++) {
      const cx = x - w / 2 + i * cw; const up = i % 2 === 0;
      ctx.lineTo(cx, by - h - (up ? 8 : 0)); ctx.lineTo(cx + cw, by - h - (up ? 8 : 0));
    }
    ctx.lineTo(x + w / 2, by - h); ctx.lineTo(x + w / 2 + 6, by); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = c.main; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8; ctx.stroke(); ctx.globalAlpha = 1;
    // 窗户发光
    for (let i = 0; i < 3; i++) {
      const wy = by - h * (0.3 + i * 0.22); const fl = 0.6 + 0.4 * Math.sin(this.t * 4 + i * 2 + (blue ? 0 : 1));
      ctx.fillStyle = `rgba(${c.glow.join(',')},${fl})`; ctx.fillRect(x - 3, wy, 6, 10);
    }
    // 大炮
    const cy = H * 0.6, dir = blue ? 1 : -1;
    ctx.save(); ctx.translate(x + dir * 10, cy); ctx.rotate(dir * -0.6); ctx.fillStyle = '#20263a';
    ctx.fillRect(dir > 0 ? 0 : -26, -4, 26, 8); ctx.restore();
    ctx.fillStyle = '#151a2b'; ctx.beginPath(); ctx.arc(x + dir * 10, cy + 3, 7, 0, TAU); ctx.fill();
    // 旗帜
    const px = x, py = by - h - 8;
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 46); ctx.stroke();
    const fw = 40, fh = 26;
    ctx.fillStyle = c.main; ctx.beginPath(); ctx.moveTo(px, py - 46);
    for (let i = 0; i <= 10; i++) { const k = i / 10; ctx.lineTo(px + dir * fw * k, py - 46 + Math.sin(this.t * 5 - k * 4) * 3 * k); }
    for (let i = 10; i >= 0; i--) { const k = i / 10; ctx.lineTo(px + dir * fw * k, py - 46 + fh + Math.sin(this.t * 5 - k * 4) * 3 * k); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '900 15px -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(blue ? tr('flagL') : tr('flagS'), px + dir * fw * 0.5, py - 46 + fh / 2 + Math.sin(this.t * 5 - 2) * 1.5);
  }

  _drawSoldier(s) {
    const { ctx } = this; const c = colOf(s.side); const sc = this.scaleAt(s.y);
    const fade = s.dead ? clamp(1 - (s.dieT - 1.2), 0, 1) : 1;
    if (fade <= 0) return;
    const face = s.facing || (s.side === 'blue' ? 1 : -1);
    ctx.save(); ctx.globalAlpha = fade;
    ctx.translate(s.x, s.y);
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(0, 0, 8 * sc, 2.6 * sc, 0, 0, TAU); ctx.fill();
    ctx.scale(sc * face, sc);
    if (s.dead) ctx.rotate(-Math.abs(s.rot));
    const walk = s.moving && !s.dead ? Math.sin(s.phase) : 0;
    const bob = s.dead ? 0 : (s.moving ? Math.abs(Math.cos(s.phase)) * 1.5 : Math.sin(s.phase) * 0.5);
    const rc = s.recoil ? s.recoil * 12 : 0;
    ctx.translate(0, -bob);
    // 腿
    ctx.strokeStyle = '#0f1424'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(walk * 5, 0); ctx.moveTo(0, -9); ctx.lineTo(-walk * 5, 0); ctx.stroke();
    // 身体（铠甲）
    ctx.fillStyle = c.armor; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-4.5, -20, 9, 12, 3) : ctx.rect(-4.5, -20, 9, 12); ctx.fill();
    ctx.fillStyle = c.light; ctx.globalAlpha = fade * 0.6; ctx.fillRect(1.5, -19, 2, 10); ctx.globalAlpha = fade;
    // 枪
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-2 - rc * 0.2, -15); ctx.lineTo(12 - rc * 0.3, -15 - (s.moving ? 2 : 0)); ctx.stroke();
    // 头盔
    ctx.fillStyle = '#f1d3b3'; ctx.beginPath(); ctx.arc(0, -24, 3.6, 0, TAU); ctx.fill();
    ctx.fillStyle = c.main; ctx.beginPath(); ctx.arc(0, -25, 4.4, Math.PI, TAU); ctx.fill();
    ctx.fillRect(-4.4, -25.5, 9.6, 1.6);
    // 护目镜发光
    ctx.fillStyle = c.light; ctx.fillRect(1.2, -24.5, 3, 1.4);
    ctx.restore();
    if (this.surge === s.side && !s.dead) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45 * this.surgeT;
      ctx.drawImage(this.sprites[s.side], s.x - 14 * sc, s.y - 30 * sc, 28 * sc, 36 * sc);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }
}

export { fmtUsd, COL, colOf, clamp, lerp, rand, TAU, RM, makeGlow, makeSmoke, makeCloud };
