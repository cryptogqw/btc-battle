// 战场动画 WebGL 版（PixiJS）：模拟逻辑完全沿用 battle.js 的 Battle（前线、兵力、炮弹、爆炸都由行情驱动），这里只负责绘制。绘制。
// 奇幻战场：人族（蓝金，左）对兽族（红黑，右），步兵/弓兵/骑兵由 3D 模型渲染的精灵图，背景见 fantasy-art.js。
// PixiJS 按需动态加载；加载失败、WebGL 不可用或显卡上下文丢失时自动退回经典 Canvas 2D 版；?fx=classic 强制经典版。
import { Battle, COL, colOf, clamp, lerp, rand, TAU, makeGlow, makeSmoke } from './battle.js?v=6f65a61e';
import { t as tr } from './i18n.js?v=6f65a61e';
import { drawSkyGround, drawFarLayer, drawNearLayer, drawForeground, towerTex } from './fantasy-art.js?v=6f65a61e';

const ASSET_V = '3';
// 手绘（ChatGPT）新素材：覆盖对应阵营的兵种；ONLY 表示该阵营暂时只显示这个兵种（其余兵种的新素材画好前，避免两种画风混在一起）
const EXTRA = { blue: ['human_inf', 'human_arc', 'human_cav'], red: [] };
const ONLY = {}; // 军队贴图版本号（更新 assets/units 后加一）
const UNIT_K = 0.42; // 精灵像素 → 战场单位（sc=1 时）
const PIXI_URL = './vendor/pixi.js?v=6f65a61e';

// ---------- 小工具 ----------
function rng32(seed) { // 固定种子随机数：同一屏幕尺寸下背景每次生成都一样，窗口缩放时不会“换一座城”
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
const hexCache = new Map();
function hexNum(s) {
  let v = hexCache.get(s);
  if (v == null) { v = parseInt(String(s).replace('#', '').slice(0, 6), 16) || 0xffffff; hexCache.set(s, v); }
  return v;
}
const rgbNum = (a) => (a[0] << 16) | (a[1] << 8) | a[2];
function mixNum(a, b, k) {
  const r = lerp(a >> 16, b >> 16, k), g = lerp((a >> 8) & 255, (b >> 8) & 255, k), bl = lerp(a & 255, b & 255, k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

// 精灵对象池：每帧按顺序取用，用不完的隐藏；避免每帧创建/销毁对象造成卡顿
class Pool {
  constructor(P, parent, tex, blend) { this.P = P; this.parent = parent; this.tex = tex; this.blend = blend; this.items = []; this.n = 0; }
  begin() { this.n = 0; }
  get(tex) {
    let s = this.items[this.n];
    if (!s) {
      s = new this.P.Sprite(tex || this.tex); s.anchor.set(0.5);
      if (this.blend) s.blendMode = this.blend;
      this.parent.addChild(s); this.items.push(s);
    }
    const t = tex || this.tex; if (s.texture !== t) s.texture = t;
    s.visible = true; s.alpha = 1; s.rotation = 0; s.tint = 0xffffff;
    this.n++; return s;
  }
  end() { for (let i = this.n; i < this.items.length; i++) this.items[i].visible = false; }
}

// ---------- 静态贴图 ----------
function glowTex(r, g, b, size = 64) { return makeGlow(r, g, b, size); }
function lineTex() { // 横向细线（两端柔和），用于子弹轨迹、火花
  const c = mk(32, 4), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 32, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.25, '#fff'); g.addColorStop(1, '#fff');
  x.fillStyle = g; x.fillRect(0, 1, 32, 2); return c;
}
function fadeLineTex() { // 一端实一端透明，用于冲锋速度线
  const c = mk(64, 2), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 2); return c;
}
function ringTex() {
  const c = mk(128, 128), x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.lineWidth = 5; x.beginPath(); x.arc(64, 64, 60, 0, TAU); x.stroke();
  x.globalAlpha = 0.35; x.lineWidth = 12; x.beginPath(); x.arc(64, 64, 56, 0, TAU); x.stroke();
  return c;
}
function shadowTex() {
  const c = mk(64, 32), x = c.getContext('2d');
  const g = x.createRadialGradient(32, 16, 0, 32, 16, 32); g.addColorStop(0, 'rgba(0,0,0,0.7)'); g.addColorStop(0.6, 'rgba(0,0,0,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.setTransform(1, 0, 0, 0.5, 0, 8); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c;
}
function craterTex() { // 弹坑：中心焦黑、边缘一圈翻起的泥土
  const c = mk(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(5,4,4,0.85)'); g.addColorStop(0.45, 'rgba(12,10,9,0.75)'); g.addColorStop(0.62, 'rgba(58,46,36,0.55)');
  g.addColorStop(0.75, 'rgba(30,24,20,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const R = rng32(7);
  for (let i = 0; i < 40; i++) { const a = R() * TAU, d = 30 + R() * 30; x.fillStyle = `rgba(${R() < 0.5 ? '20,16,14' : '70,58,46'},${0.3 + R() * 0.4})`; x.fillRect(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 2 + R() * 4, 2 + R() * 3); }
  return c;
}
function smokeCloudTex() { // 浓烟团（取代经典版的紫色云）
  const c = mk(256, 96), x = c.getContext('2d'); const R = rng32(3);
  for (let i = 0; i < 22; i++) {
    const cx = 30 + R() * 196, cy = 34 + R() * 34, r = 16 + R() * 30;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(60,56,58,0.5)'); g.addColorStop(1, 'rgba(40,36,38,0)');
    x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  return c;
}
function edgeTex(inner = 0.35) { // 屏幕边缘发光（中心透明），着色后用于总攻氛围
  const c = mk(256, 256), x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 128 * inner, 128, 128, 181); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,1)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256); return c;
}
function vGradTex(stops) { // 竖向渐变条
  const c = mk(2, 128), x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 128);
  for (const [k, col] of stops) g.addColorStop(k, col);
  x.fillStyle = g; x.fillRect(0, 0, 2, 128); return c;
}
function skyGlowTex() { // 竖向渐变 × 横向渐变：左侧透明，右侧（兽族）最亮
  const c = mk(128, 128), x = c.getContext('2d');
  const v = x.createLinearGradient(0, 0, 0, 128); v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.55, 'rgba(255,255,255,0.25)'); v.addColorStop(1, '#fff');
  x.fillStyle = v; x.fillRect(0, 0, 128, 128);
  x.globalCompositeOperation = 'destination-in';
  const h = x.createLinearGradient(0, 0, 128, 0); h.addColorStop(0, 'rgba(0,0,0,0.12)'); h.addColorStop(0.45, 'rgba(0,0,0,0.3)'); h.addColorStop(1, '#000');
  x.fillStyle = h; x.fillRect(0, 0, 128, 128); return c;
}
function hGradTex(c0, c1) {
  const c = mk(128, 2), x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, c0); g.addColorStop(1, c1); x.fillStyle = g; x.fillRect(0, 0, 128, 2); return c;
}
function arrowTex() { // 箭：木杆 + 箭头 + 尾羽（朝 +x）
  const c = mk(48, 8), x = c.getContext('2d');
  x.fillStyle = '#d9c9a6'; x.fillRect(6, 3, 34, 2); x.fillStyle = '#e8eef5'; x.beginPath(); x.moveTo(48, 4); x.lineTo(39, 0.5); x.lineTo(39, 7.5); x.closePath(); x.fill();
  x.fillStyle = '#f4f1ea'; x.beginPath(); x.moveTo(0, 0.5); x.lineTo(9, 3); x.lineTo(0, 3.5); x.moveTo(0, 7.5); x.lineTo(9, 5); x.lineTo(0, 4.5); x.fill();
  return c;
}

// 士兵帧：沿用经典版的造型，预渲染成贴图（行走 8 帧 + 站立 + 开火），每帧只需摆放精灵，比逐帧矢量绘制快得多
const SR = 3, SW = 24, SH = 34, SOX = 7, SOY = 31;
function soldierFrame(side, walk, moving, rc) {
  const c = mk(SW * SR, SH * SR), ctx = c.getContext('2d'); const col = COL[side];
  ctx.scale(SR, SR); ctx.translate(SOX, SOY);
  ctx.strokeStyle = '#0f1424'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(walk * 5, 0); ctx.moveTo(0, -9); ctx.lineTo(-walk * 5, 0); ctx.stroke();
  ctx.fillStyle = col.armor; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-4.5, -20, 9, 12, 3) : ctx.rect(-4.5, -20, 9, 12); ctx.fill();
  ctx.fillStyle = col.light; ctx.globalAlpha = 0.6; ctx.fillRect(1.5, -19, 2, 10); ctx.globalAlpha = 1;
  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(-2 - rc * 0.2, -15); ctx.lineTo(12 - rc * 0.3, -15 - (moving ? 2 : 0)); ctx.stroke();
  ctx.fillStyle = '#f1d3b3'; ctx.beginPath(); ctx.arc(0, -24, 3.6, 0, TAU); ctx.fill();
  ctx.fillStyle = col.main; ctx.beginPath(); ctx.arc(0, -25, 4.4, Math.PI, TAU); ctx.fill();
  ctx.fillRect(-4.4, -25.5, 9.6, 1.6);
  ctx.fillStyle = col.light; ctx.fillRect(1.2, -24.5, 3, 1.4);
  return c;
}

// ---------- WebGL 版战场 ----------
export class GLBattle extends Battle {
  constructor(canvas) {
    super(canvas);
    const q = new URLSearchParams(location.search).get('fx');
    this.fxMode = q === 'classic' ? 'classic' : 'gl';
    if (this.fxMode === 'gl') this._initGL().catch((e) => { console.warn('WebGL 战场初始化失败，使用经典版', e); this._glFail(); });
  }

  async _initGL() {
    const P = await import(PIXI_URL);
    const glc = document.createElement('canvas'); glc.className = 'battle-gl'; glc.setAttribute('aria-hidden', 'true');
    this.cv.after(glc);
    const r0 = this.cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderer = await P.autoDetectRenderer({
      preference: 'webgl', canvas: glc, width: Math.max(1, r0.width), height: Math.max(1, r0.height), resolution: dpr,
      antialias: dpr < 2, background: '#05070f', autoDensity: false, powerPreference: 'high-performance', hello: false,
    });
    glc.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('WebGL 上下文丢失，切换经典版'); this._glFail(); });
    this.P = P; this.R = renderer; this.glc = glc;
    this._buildScene();
    this.cv.style.display = 'none'; this.sizeEl = glc;
    this.gl = true;
    this._loadUnits().catch((e) => console.warn('写实单位贴图加载失败，沿用简笔士兵', e));
    if (window.ResizeObserver) new ResizeObserver(() => this.gl && this.resize()).observe(glc);
    this.resize();
  }
  async _loadUnits() {
    const P = this.P, base = './assets/units/';
    const img = (src) => new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => (im.naturalWidth ? res(im) : rej(new Error('empty'))); im.onerror = rej; im.src = src; });
    const armies = {};
    for (const [side, name] of [['blue', 'human'], ['red', 'orc']]) {
      const meta = await fetch(`${base}army_${name}.json?v=${ASSET_V}`).then((r) => r.json());
      let im; try { im = await img(`${base}army_${name}.avif?v=${ASSET_V}`); } catch { im = await img(`${base}army_${name}.png?v=${ASSET_V}`); }
      const source = P.Texture.from(im, true).source; const [cw, ch] = meta.cell; const units = {};
      for (const [u, ud] of Object.entries(meta.units)) {
        const clips = {};
        for (const [k, c] of Object.entries(ud.clips)) clips[k] = { ...c, tex: Array.from({ length: c.n }, (_, i) => new P.Texture({ source, frame: new P.Rectangle(i * cw, c.row * ch, cw, ch) })) };
        units[u] = { clips, ax: ud.anchor_x / cw, ay: meta.foot_y / ch, anchorPx: ud.anchor_x, k: ud.k, footY: meta.foot_y };
      }
      for (const extra of EXTRA[side]) {
        try {
          const em = await fetch(`${base}${extra}.json?v=${ASSET_V}`).then((r) => r.json());
          let ei; try { ei = await img(`${base}${extra}.avif?v=${ASSET_V}`); } catch { ei = await img(`${base}${extra}.png?v=${ASSET_V}`); }
          const es = P.Texture.from(ei, true).source; const [ew, eh] = em.cell;
          for (const [u, ud] of Object.entries(em.units)) {
            const clips = {};
            for (const [k, c] of Object.entries(ud.clips)) clips[k] = { ...c, tex: Array.from({ length: c.n }, (_, i) => new P.Texture({ source: es, frame: new P.Rectangle(i * ew, c.row * eh, ew, eh) })) };
            units[u] = { clips, ax: ud.anchor_x / ew, ay: em.foot_y / eh, anchorPx: ud.anchor_x, k: ud.k, footY: em.foot_y };
          }
        } catch (e) { console.warn('新素材加载失败', extra, e); }
      }
      armies[side] = { meta, units };
    }
    if (this.gl) this.units = armies;
  }
  _spawnSoldier(side, atBase) {
    super._spawnSoldier(side, atBase);
    const s = this.soldiers[this.soldiers.length - 1];
    if (this._ut(s) === 'arc') { s.hold = s.ranged = true; s.d = Math.max(s.d, 0.55); }
  }
  // 兵种：后排弓兵，前排剑盾步兵，少量骑兵（纯视觉分配，不影响战力计算）
  _ut(s) { if (this.units && ONLY[s.side]) return (s.ut = ONLY[s.side]); if (!s.ut) s.ut = Math.random() < 0.14 ? 'cav' : (s.d > 0.5 ? 'arc' : 'inf'); return s.ut; }
  // 弓兵射箭（抛物线）；步兵、骑兵近身劈砍（不画弹道，只在交锋处溅火花）
  _shoot(s) {
    if (!this.gl || !this.units) return super._shoot(s);
    const A = this.units[s.side], ut = this._ut(s), sc = this.scaleAt(s.y), dir = s.side === 'blue' ? 1 : -1, k = UNIT_K * sc;
    const ty = clamp(s.y + rand(-30, 30), this.laneTop, this.laneBot);
    let sx, sy, tx;
    if (ut === 'arc') {
      const U = A.units.arc, pts = U.clips.shoot.pt || [], m = pts[Math.min(2, pts.length - 1)] || [U.anchorPx + 30, A.meta.foot_y - 70];
      sx = s.x + dir * (m[0] - U.anchorPx) * k; sy = s.y + (m[1] - A.meta.foot_y) * k;
      const fxT = this.frontX(ty), deep = Math.abs((s.side === 'blue' ? this.baseR : this.baseL) - fxT);
      tx = fxT + dir * rand(20, Math.max(140, deep * 0.85));
      this._melee = false;
    } else {
      sx = s.x + dir * 18 * sc; sy = s.y - 30 * sc; tx = this.frontX(ty) + dir * rand(5, 40); this._melee = true;
    }
    this._bullet(s.side, sx, sy, tx, ty - 18 * this.scaleAt(ty));
    this._melee = false;
    s.recoil = 0.12; s.atkT = this.t;
  }
  _bullet(side, sx, sy, tx, ty, big) {
    super._bullet(side, sx, sy, tx, ty, big);
    const b = this.bullets[this.bullets.length - 1];
    if (b && this.gl) { b.T = b.life; b.melee = !!this._melee; b.arc = Math.min(80, Math.hypot(tx - sx, ty - sy) * 0.28); }
  }
  _glFail() {
    this.gl = false;
    if (this.glc) { this.glc.remove(); this.glc = null; }
    try { this.R && this.R.destroy(); } catch {}
    this.R = null; this.sizeEl = null; this.cv.style.display = '';
    this.resize();
  }

  _buildScene() {
    const P = this.P, C = () => new P.Container();
    const T = (c) => P.Texture.from(c, true);
    this.tx = {
      blue: T(glowTex(...COL.blue.glow)), red: T(glowTex(...COL.red.glow)), fire: T(glowTex(255, 160, 50)), white: T(glowTex(255, 240, 220)),
      smoke: T(makeSmoke()), cloud: T(smokeCloudTex()), line: T(lineTex()), fline: T(fadeLineTex()), ring: T(ringTex()),
      shadow: T(shadowTex()), crater: T(craterTex()), edge: T(edgeTex()), arrow: T(arrowTex()),
      skyGlow: T(skyGlowTex()),
      tintB: T(hGradTex('rgba(37,99,235,0.16)', 'rgba(37,99,235,0.02)')), tintR: T(hGradTex('rgba(220,38,38,0.02)', 'rgba(220,38,38,0.16)')),
      px: P.Texture.WHITE,
    };
    this.tx.soldier = {};
    for (const side of ['blue', 'red']) {
      const f = { walk: [] };
      for (let i = 0; i < 8; i++) f.walk.push(T(soldierFrame(side, Math.sin(i / 8 * TAU), true, 0)));
      f.idle = T(soldierFrame(side, 0, false, 0)); f.shoot = T(soldierFrame(side, 0, false, 1.4));
      this.tx.soldier[side] = f;
    }
    const stage = this.stage = C(), world = this.world = C(), screen = C();
    stage.addChild(world, screen);
    const L = this.L = {};
    const add = (name, parent = world) => (L[name] = C(), parent.addChild(L[name]), L[name]);
    for (const n of ['bg', 'sky', 'clouds', 'far', 'fires', 'near', 'nearFires', 'bolts', 'fog', 'tint', 'craters', 'lights', 'bases', 'front', 'units', 'smoke', 'fg', 'fx', 'debris', 'texts']) add(n);
    const S = (tex, parent, blend) => { const s = new P.Sprite(tex); if (blend) s.blendMode = blend; parent.addChild(s); return s; };
    this.sp = {
      bg: S(P.Texture.EMPTY, L.bg), skyGlow: S(this.tx.skyGlow, L.sky, 'add'),
      far: S(P.Texture.EMPTY, L.far), near: S(P.Texture.EMPTY, L.near), fg: S(P.Texture.EMPTY, L.fg),
      tintB: S(this.tx.tintB, L.tint), tintR: S(this.tx.tintR, L.tint),
      frontGlow: null,
      surge: S(this.tx.edge, screen), flash: S(P.Texture.WHITE, screen), vig: S(P.Texture.EMPTY, screen),
    };
    this.gBolts = new P.Graphics(); this.gBolts.blendMode = 'add'; L.bolts.addChild(this.gBolts);
    this.gFront = new P.Graphics(); this.gFront.blendMode = 'add'; L.front.addChild(this.gFront);
    this.sp.frontGlow = S(this.tx.white, L.front, 'add'); this.sp.frontGlow.anchor.set(0.5);
    const pool = (parent, tex, blend) => new Pool(P, parent, tex, blend);
    this.pl = {
      clouds: pool(L.clouds, this.tx.cloud), fires: pool(L.fires, this.tx.fire, 'add'), nearFires: pool(L.nearFires, this.tx.fire, 'add'),
      plumes: pool(L.fires, this.tx.smoke), fog: pool(L.fog, this.tx.smoke),
      craters: pool(L.craters, this.tx.crater), craterGlow: pool(L.craters, this.tx.fire, 'add'), 
      baseGlow: pool(L.bases, this.tx.blue, 'add'), shadows: pool(L.units, this.tx.shadow), soldiers: pool(L.units, this.tx.soldier.blue.idle),
      unitGlow: pool(L.units, this.tx.blue, 'add'), smoke: pool(L.smoke, this.tx.smoke),
      bulletLines: pool(L.debris, this.tx.arrow), glows: pool(L.fx, this.tx.white, 'add'), sparks: pool(L.fx, this.tx.line, 'add'),
      shells: pool(L.fx, this.tx.white, 'add'), rings: pool(L.fx, this.tx.ring, 'add'), streaks: pool(L.fx, this.tx.fline, 'add'),
      embers: pool(L.fx, P.Texture.WHITE, 'add'), debris: pool(L.debris, P.Texture.WHITE),
    };
    // 大本营塔楼与旗帜
    this.bases = {};
    for (const side of ['blue', 'red']) {
      const b = { body: S(P.Texture.EMPTY, L.bases), flag: new P.Graphics(), mast: new P.Graphics(),
        label: new P.Text({ text: '', style: { fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif', fontSize: 15, fontWeight: '900', fill: '#ffffff' } }) };
      b.label.anchor.set(0.5);
      L.bases.addChild(b.mast, b.flag, b.label);
      this.bases[side] = b;
    }
    this.textObjs = new Map();
    this.hz = []; this.plumes = []; this._lastNow = performance.now();
  }

  // 尺寸变化时重建背景贴图（经典版在 GL 就绪前仍会调用父类方法）
  _buildArt() {
    if (!this.gl) return super._buildArt();
    const { W, H, dpr, P } = this; if (!W || !H) return;
    if (this.R.width !== W || this.R.height !== H || this.R.resolution !== dpr) this.R.resize(W, H, dpr);
    const T = (c) => P.Texture.from(c, true);
    const swap = (sprite, c) => { const old = sprite.texture; sprite.texture = T(c); if (old && old !== P.Texture.EMPTY) old.destroy(true); };
    const hz = this.horizon, PAD = this.PADg = 110, s = dpr;
    const seed = 1000 + Math.round(W / 40); // 同一宽度区间背景固定
    // 天空 + 地面（左草地、右火山灰）+ 远处的投石车残骸
    {
      const c = mk(W * s, H * s), x = c.getContext('2d'); x.scale(s, s);
      this.wrecks = drawSkyGround(x, W, H, hz, this.laneTop, rng32(seed));
      swap(this.sp.bg, c);
    }
    // 远景：人族城堡 / 火山与黑色尖塔
    {
      const lw = W + PAD * 2, c = mk(lw * s, (hz + 4) * s), x = c.getContext('2d'); x.scale(s, s);
      this.farFires = drawFarLayer(x, lw, hz, H, W, PAD, rng32(seed + 1));
      swap(this.sp.far, c);
    }
    // 中景：松林 / 怪石枯树
    {
      const lw = W + PAD * 2, c = mk(lw * s, (hz + 4) * s), x = c.getContext('2d'); x.scale(s, s);
      this.nearFires = drawNearLayer(x, lw, hz, H, W, PAD, rng32(seed + 2));
      swap(this.sp.near, c);
    }
    // 前景：木栅栏 / 黑铁尖刺（贴着画面底边，中间留空不挡战斗）
    {
      const fh = Math.max(26, H * 0.1), lw = W + PAD * 2, c = mk(lw * s, (fh + 4) * s), x = c.getContext('2d'); x.scale(s, s);
      drawForeground(x, lw, fh, W, PAD, clamp(H / 420, 0.7, 1.3), rng32(seed + 3));
      this.fgH = fh + 4;
      swap(this.sp.fg, c);
    }
    // 大本营塔楼
    {
      const bw = clamp(W * 0.06, 38, 66), bh = clamp(H * 0.2, 56, 110), R = rng32(seed + 4);
      for (const side of ['blue', 'red']) { const b = towerTex(side, bw, bh, R, SR); this.bases[side].meta = b; swap(this.bases[side].body, b.c); }
      this.bunkerH = bh;
    }
    { // 暗角
      const c = mk(W / 2, H / 2), x = c.getContext('2d'); x.scale(0.5, 0.5);
      const v = x.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.4, W / 2, H * 0.55, Math.max(W, H) * 0.8);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)'); x.fillStyle = v; x.fillRect(0, 0, W, H);
      swap(this.sp.vig, c);
    }
  }

  draw() { if (this.gl) this._drawGL(); else super.draw(); }

  _drawGL() {
    const { W, H, sp, pl, tx } = this; if (!W || !this.wrecks) return;
    const now = performance.now(), dt = Math.min((now - this._lastNow) / 1000, 0.05); this._lastNow = now;
    const t = this.t, hz = this.horizon, PAD = this.PADg;
    for (const k in pl) pl[k].begin();
    // 镜头：震屏 + 巨鲸时轻微推近
    const shx = (Math.random() - 0.5) * this.shake, shy = (Math.random() - 0.5) * this.shake;
    this.world.pivot.set(W / 2, H / 2); this.world.position.set(W / 2 + shx, H / 2 + shy); this.world.scale.set(this.zoom);
    const cam = (this.front - 0.5) * 120;
    const surgeSide = this.lastSurge || 'blue';
    const smokeK = 1 + this.surgeT * 0.9 + Math.min(this.intensity, 6) * 0.1; // 战况越激烈，硝烟越浓

    sp.bg.position.set(-6, -6); sp.bg.width = W + 12; sp.bg.height = H + 12;
    // 天空火光：常态暗红，交战强度与总攻时更红（总攻时混入进攻方颜色）
    sp.skyGlow.position.set(-6, hz * 0.25); sp.skyGlow.width = W + 12; sp.skyGlow.height = hz * 0.78;
    sp.skyGlow.tint = mixNum(0xff4a1c, rgbNum(COL[surgeSide].glow), 0.35 * this.surgeT);
    sp.skyGlow.alpha = clamp(0.4 + this.intensity * 0.05 + this.surgeT * 0.4, 0, 0.95);
    // 浓烟云
    for (const c of this.clouds) { const s = pl.clouds.get(); s.position.set(c.x - cam * 0.15, c.y * H); s.width = c.w * 1.2; s.height = c.h * 1.4; s.alpha = Math.min(0.9, c.a * 1.4 * (0.8 + smokeK * 0.25)); s.tint = mixNum(0x6f7ca8, 0x8a4a40, clamp(c.x / W, 0, 1)); }
    // 远景 / 中景视差
    sp.far.position.set(-PAD - cam * 0.25, 0); sp.far.width = W + PAD * 2; sp.far.height = hz + 4;
    sp.near.position.set(-PAD - cam * 0.5, 0); sp.near.width = W + PAD * 2; sp.near.height = hz + 4;
    const fireAt = (pool, f, off, k) => { // 楼体火光闪烁（纯视觉）
      const fl = 0.65 + 0.2 * Math.sin(t * 9 + f.ph) + 0.15 * Math.sin(t * 23 + f.ph * 2);
      const s = pool.get(); s.position.set(f.x - PAD - off, f.y); s.width = s.height = 22 * f.s * k * (0.9 + fl * 0.2); s.alpha = clamp(fl * (f.warm ? 0.7 : 0.55 + this.intensity * 0.05), 0, 1);
      if (f.lava) s.tint = 0xff6a30; else if (f.warm) s.tint = 0xffd9a0;
    };
    for (const f of this.farFires) fireAt(pl.fires, f, cam * 0.25, 1);
    for (const f of this.nearFires) fireAt(pl.nearFires, f, cam * 0.5, 1.5);
    // 远处炮口闪光：频率只由真实成交强度决定
    if (Math.random() < this.intensity * 0.9 * dt) this.hz.push({ x: Math.random() < 0.5 ? rand(0, W * 0.3) : rand(W * 0.7, W), life: 0.3, max: 0.3, s: rand(0.6, 1.4), col: Math.random() < 0.5 ? 0xffb070 : 0xffe0b0 });
    for (const h of this.hz) { h.life -= dt; const s = pl.fires.get(); const k = h.life / h.max; s.position.set(h.x, hz - 2); s.width = 120 * h.s; s.height = 40 * h.s; s.alpha = k * k * 0.9; s.tint = h.col; }
    this.hz = this.hz.filter((h) => h.life > 0);
    // 烟柱：从着火的楼和残骸里升起
    const srcs = this.wrecks;
    if (this.plumes.length < 70 && Math.random() < dt * (2 + smokeK * 2)) {
      const lava = this.farFires.filter((q) => q.lava); const useFar = Math.random() < 0.55 && lava.length;
      const f = useFar ? lava[(Math.random() * Math.min(3, lava.length)) | 0] : srcs[(Math.random() * srcs.length) | 0];
      if (f) this.plumes.push({ x: useFar ? f.x - PAD : f.x, y: f.y, far: useFar, vx: rand(4, 12), vy: rand(-14, -8), size: (useFar ? 6 : 8) * (f.s || 1), life: rand(4, 7), max: 7 });
    }
    for (const p of this.plumes) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.size += dt * (p.far ? 4 : 6);
      const s = pl.plumes.get(); s.position.set(p.x - (p.far ? cam * 0.25 : 0), p.y); s.width = s.height = p.size * 2; s.alpha = Math.min(1, p.life / p.max * 1.5) * Math.min(1, (1 - p.life / p.max) * 4) * 0.8 * Math.min(1.4, smokeK * 0.8); s.tint = 0x8a807c; }
    this.plumes = this.plumes.filter((p) => p.life > 0);
    // 总攻闪电
    const gb = this.gBolts; gb.clear();
    for (const b of this.bolts) {
      const k = b.life / b.max, col = b.col.split(',').map(Number);
      for (const [w, a] of [[6, 0.15], [2, 0.9]]) { b.pts.forEach(([x, y], i) => (i ? gb.lineTo(x, y) : gb.moveTo(x, y))); gb.stroke({ width: w, color: rgbNum(col), alpha: a * k }); }
    }
    // 地平线硝烟
    for (const f of this.fog) { const s = pl.fog.get(); s.position.set(f.x - cam * 0.6, hz); s.width = f.w * 1.2; s.height = f.h * 1.2; s.alpha = Math.min(0.95, f.a * smokeK * 0.85); s.tint = mixNum(0x5d6a8a, 0x7a4038, clamp(f.x / W, 0, 1)); }
    // 领地色调
    const fx = this.frontX(H * 0.7);
    sp.tintB.position.set(0, hz); sp.tintB.width = fx; sp.tintB.height = H - hz;
    sp.tintR.position.set(fx, hz); sp.tintR.width = W - fx; sp.tintR.height = H - hz;
    // 弹坑：刚炸出时还冒着火星，随后慢慢变淡
    for (const c of this.scorch) {
      const s = pl.craters.get(); s.position.set(c.x, c.y + 2); s.width = c.r * 2.6; s.height = c.r * 0.9; s.alpha = Math.min(1, c.life / 4);
      const hot = clamp((c.life - 10) / 4, 0, 1);
      if (hot > 0) { const g = pl.craterGlow.get(); g.position.set(c.x, c.y); g.width = c.r * 2.2; g.height = c.r * 0.8; g.alpha = hot * (0.5 + 0.2 * Math.sin(t * 13 + c.x)); }
    }
    this._drawBasesGL(t);
    this._drawFrontGL(fx);
    // 士兵（远小近大，按 y 排序）
    this.soldiers.sort((a, b) => a.y - b.y);
    for (const s of this.soldiers) {
      const sc = this.scaleAt(s.y), fade = s.dead ? clamp(1 - (s.dieT - 1.2), 0, 1) : 1;
      if (fade <= 0) continue;
      const face = s.facing || (s.side === 'blue' ? 1 : -1);
      const A = this.units && this.units[s.side], U = A && A.units[this._ut(s)];
      if (U) { // 奇幻军队（3D 模型渲染的动作帧）
        const C = U.clips, ut = s.ut, atk = s.atkT != null ? this.t - s.atkT : 9;
        let clip, fi;
        if (s.dead) { clip = C.death; fi = Math.min(clip.n - 1, (s.dieT / (clip.dur || 1.1) * clip.n) | 0); }
        else if ((C.attack || C.shoot) && atk < ((C.attack || C.shoot).dur || 0.5)) { clip = C.attack || C.shoot; fi = Math.min(clip.n - 1, (atk / (clip.dur || 0.5) * clip.n) | 0); }
        else if (s.moving || ut === 'cav') { clip = (this.surge === s.side && C.run) ? C.run : C.walk; fi = s.moving ? ((((s.phase % TAU) + TAU) % TAU) / TAU * clip.n) | 0 : 0; }
        else if (C.defend && Math.abs(s.x - this.frontX(s.y)) < 70) { clip = C.defend; fi = Math.min(clip.n - 1, 2 + (((this.t * 1.5 + s.phase) | 0) % 2)); }
        else { clip = C.idle || C.walk; fi = ((this.t * 6 + s.phase) | 0) % clip.n; }
        const big = ut === 'cav' ? 2.2 : 1;
        const sh = pl.shadows.get(); sh.position.set(s.x - face * 2 * sc, s.y); sh.width = (s.dead ? 44 : 28) * sc * big; sh.height = 7 * sc * (ut === 'cav' ? 1.5 : 1); sh.alpha = fade * 0.9;
        const K = (U.k || UNIT_K) * sc, bob = (s.moving && !s.dead && U.k && ut === 'inf') ? Math.abs(Math.sin(s.phase)) * 1.2 * sc : 0;
        const u = pl.soldiers.get(clip.tex[fi]); u.anchor.set(U.ax, U.ay);
        u.position.set(s.x, s.y - bob); u.scale.set(K * face, K); u.alpha = fade;
        const depth = clamp((s.y - this.laneTop) / (this.laneBot - this.laneTop), 0, 1);
        u.tint = mixNum(0xb4b8c6, 0xffffff, depth); // 远处稍暗，增加纵深
      } else {
      const sh = pl.shadows.get(); sh.position.set(s.x, s.y); sh.width = 18 * sc; sh.height = 6 * sc; sh.alpha = fade;
      const fr = tx.soldier[s.side];
      const tex = s.dead ? fr.idle : s.recoil > 0.05 ? fr.shoot : s.moving ? fr.walk[(((s.phase % TAU) + TAU) % TAU / TAU * 8) | 0] : fr.idle;
      const bob = s.dead ? 0 : (s.moving ? Math.abs(Math.cos(s.phase)) * 1.5 : Math.sin(s.phase) * 0.5);
      const u = pl.soldiers.get(tex); u.anchor.set(SOX / SW, SOY / SH);
      u.position.set(s.x, s.y - bob * sc); u.scale.set(sc * face / SR, sc / SR); u.alpha = fade;
      u.rotation = s.dead ? -face * Math.abs(s.rot) : 0;
      }
      if (!U && this.surge === s.side && !s.dead) { const g = pl.unitGlow.get(tx[s.side]); g.position.set(s.x, s.y - 12 * sc); g.width = 28 * sc; g.height = 36 * sc; g.alpha = 0.45 * this.surgeT; }
    }
    // 硝烟
    for (const m of this.smoke) { const s = pl.smoke.get(); s.position.set(m.x, m.y); s.width = s.height = m.size * 2; s.alpha = Math.min(1, m.life / m.max * 1.4) * 0.8; s.rotation = m.rot; }
    // 前景工事（反向视差，增加纵深）
    sp.fg.position.set(-PAD + cam * 0.3, H - this.fgH + 2); sp.fg.width = W + PAD * 2; sp.fg.height = this.fgH;
    // 发光层
    for (const b of this.bullets) {
      if (b.melee) continue; // 近战劈砍不画弹道
      const T = b.T || 0.3, k = clamp(1 - b.life / T, 0, 1), arc = b.arc || 0;
      const y = b.y - arc * 4 * k * (1 - k), dy = b.vy - arc * 4 * (1 - 2 * k) / T; // 抛物线高度与切线方向
      const a = pl.bulletLines.get(tx.arrow); a.anchor.set(0.85, 0.5); a.position.set(b.x, y); a.width = 17; a.height = 3.2;
      a.rotation = Math.atan2(dy, b.vx); a.tint = b.side === 'blue' ? 0xfff4d8 : 0xffd0c0; a.alpha = 1;
    }
    for (const p of this.parts) {
      const k = clamp(p.life / p.max, 0, 1);
      if (p.type === 'glow') {
        const sz = p.size * (p.grow ? 1 + (1 - k) * p.grow : 1);
        const g = pl.glows.get(tx[p.spr] || tx.white); g.position.set(p.x, p.y); g.width = g.height = sz; g.alpha = k;
      } else if (p.type === 'spark') {
        const l = pl.sparks.get(); l.anchor.set(1, 0.5); l.position.set(p.x, p.y); l.width = Math.hypot(p.vx, p.vy) * 0.03 + 1; l.height = p.w * 1.3;
        l.rotation = Math.atan2(p.vy, p.vx); l.tint = hexNum(p.col); l.alpha = k;
      } else if (p.type === 'debris') {
        const d = pl.debris.get(); d.anchor.set(0.5); d.position.set(p.x, p.y); d.width = p.s * 2; d.height = p.s; d.rotation = p.rot; d.tint = 0x2a2a35;
      }
    }
    for (const s of this.shells) { // 投石车的燃烧巨石 / 天降陨火
      const big = s.kind === 'whale' ? 3 : s.kind === 'heavy' ? 2 : 1.3;
      const o = pl.shells.get(tx.fire); o.position.set(s.x, s.y); o.width = o.height = 40 * big; o.tint = 0xff7a30;
      const c = pl.shells.get(tx.white); c.position.set(s.x, s.y); c.width = c.height = 13 * big;
      const t2 = pl.shells.get(tx[s.side]); t2.position.set(s.x, s.y); t2.width = t2.height = 22 * big; t2.alpha = 0.55;
    }
    for (const r of this.rings) {
      const k = r.t / r.life, rad = lerp(r.r, r.max, 1 - Math.pow(1 - k, 3));
      const s = pl.rings.get(); s.position.set(r.x, r.y); s.width = rad * 2.1; s.height = rad * 0.84; s.alpha = (1 - k) * 0.8; s.tint = rgbNum(r.col);
    }
    for (const s of this.streaks) {
      const l = pl.streaks.get(); const dir = Math.sign(s.v); l.anchor.set(0, 0.5); l.position.set(s.x, s.y); l.scale.set(-dir * s.len / 64, 1); l.tint = rgbNum(colOf(s.side).glow); l.alpha = 0.55 * this.surgeT;
    }
    for (const e of this.embers) {
      const s = pl.embers.get(); s.anchor.set(0); s.position.set(e.x, e.y); s.width = s.height = e.s; s.tint = e.x < fx ? 0x93c5fd : 0xfca5a5;
      s.alpha = e.a * (0.6 + 0.4 * Math.sin(t * 3 + e.ph));
    }
    this._drawTextsGL();
    for (const k in pl) pl[k].end();
    // 屏幕层：总攻氛围、闪光、暗角
    const sv = sp.surge; sv.position.set(0, 0); sv.width = W; sv.height = H;
    sv.visible = this.surgeT > 0; sv.tint = rgbNum(COL[surgeSide].glow); sv.alpha = (0.22 + 0.12 * (0.5 + 0.5 * Math.sin(t * 6))) * this.surgeT;
    const fl = sp.flash; fl.position.set(0, 0); fl.width = W; fl.height = H; fl.visible = this.flash > 0.01; fl.alpha = this.flash;
    fl.tint = rgbNum(this.flashCol.split(',').map(Number));
    sp.vig.position.set(0, 0); sp.vig.width = W; sp.vig.height = H;
    this.R.render(this.stage);
  }

  _drawBasesGL(t) {
    const { H, pl, tx } = this;
    const by = H * 0.66;
    for (const side of ['blue', 'red']) {
      const b = this.bases[side], m = b.meta, blue = side === 'blue', dir = blue ? 1 : -1, x = blue ? this.baseL : this.baseR, c = colOf(side);
      const g = pl.baseGlow.get(tx[side]); g.position.set(x, by - 10); g.width = 150; g.height = 100; g.alpha = 0.4;
      b.body.anchor.set(m.ax / m.w, m.ay / m.h); b.body.position.set(x, by); b.body.scale.set(dir / SR, 1 / SR);
      // 火把 / 火盆
      for (const [ox, oy] of m.torches) {
        const f = 0.7 + 0.2 * Math.sin(t * 11 + ox) + 0.1 * Math.sin(t * 27 + oy);
        const w = pl.baseGlow.get(tx.fire); w.position.set(x + dir * ox, by + oy); w.width = w.height = (blue ? 26 : 34) * f; w.alpha = 0.85; w.tint = blue ? 0xffd08a : 0xff6a30;
      }
      // 旗杆 + 飘动的军旗
      const mx = x - dir * 4, top = by - this.bunkerH - 2, py = top - 46;
      b.mast.clear().moveTo(mx, top).lineTo(mx, py).stroke({ width: 2.2, color: blue ? 0xe2c27a : 0x3a2a2a });
      const fw = 40, fh = 26, pts = [];
      for (let i = 0; i <= 10; i++) { const k = i / 10; pts.push(mx + dir * fw * k, py + 4 + Math.sin(t * 5 - k * 4) * 3 * k); }
      for (let i = 10; i >= 0; i--) { const k = i / 10; pts.push(mx + dir * fw * k, py + 4 + fh + Math.sin(t * 5 - k * 4) * 3 * k); }
      b.flag.clear().poly(pts).fill({ color: blue ? 0x1e4fd8 : 0xa01510 }).stroke({ width: 1.5, color: blue ? 0xe8b83c : 0x111111 });
      const lab = blue ? tr('flagL') : tr('flagS'); if (b.label.text !== lab) b.label.text = lab;
      b.label.position.set(mx + dir * fw * 0.5, py + 4 + fh / 2 + Math.sin(t * 5 - 2) * 1.5);
    }
  }

  _drawFrontGL(x0) {
    const g = this.gFront, top = this.horizon - 10, bot = this.H; g.clear();
    const pts = []; for (let y = top; y <= bot; y += 6) pts.push(this.frontX(y), y);
    const line = (dx, w, color, alpha) => { g.moveTo(pts[0] + dx, pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] + dx, pts[i + 1]); g.stroke({ width: w, color, alpha }); };
    line(-5, 10, 0x5096ff, 0.12); line(5, 10, 0xff5046, 0.12);
    line(-1.5, 3, 0x5096ff, 0.45); line(1.5, 3, 0xff5046, 0.45); line(0, 1.5, 0xffffff, 0.9);
    const fg = this.sp.frontGlow; fg.position.set(x0, this.H * 0.75); fg.width = 100; fg.height = 180; fg.alpha = Math.min(1, 0.5 + this.intensity * 0.05);
  }

  _drawTextsGL() {
    const P = this.P, seen = new Set();
    for (const t of this.texts) {
      let o = this.textObjs.get(t);
      if (!o) {
        const fs = [0, 13, 17, 26][t.lvl || 1];
        o = new P.Text({ text: t.txt, style: { fontFamily: '"JetBrains Mono", monospace', fontSize: fs, fontWeight: '900', fill: t.lvl === 3 ? '#fde68a' : t.side === 'blue' ? '#bfdbfe' : '#fecaca', stroke: { color: '#000000', width: 4, alpha: 0.8 } } });
        o.anchor.set(0.5); this.L.texts.addChild(o); this.textObjs.set(t, o);
      }
      seen.add(t);
      const k = t.life / t.max, age = t.max - t.life;
      const pop = age < 0.18 ? 0.6 + (age / 0.18) * 0.7 : age < 0.3 ? 1.3 - (age - 0.18) / 0.12 * 0.3 : 1;
      o.position.set(t.x, t.y); o.scale.set(pop); o.alpha = Math.min(1, k * 2.5);
    }
    for (const [t, o] of this.textObjs) if (!seen.has(t)) { o.destroy(); this.textObjs.delete(t); }
  }
}
