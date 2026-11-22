// 战场动画 WebGL 版（PixiJS）：模拟逻辑完全沿用 battle.js 的 Battle（前线、兵力、炮弹、爆炸都由行情驱动），这里只负责绘制。
// 现代战场场景：废墟城市天际线、电塔、远处火光与炮口闪光、焦土地面与残骸、碉堡、探照灯、沙袋与铁丝网前景。
// PixiJS 按需动态加载；加载失败、WebGL 不可用或显卡上下文丢失时自动退回经典 Canvas 2D 版；?fx=classic 强制经典版。
import { Battle, COL, colOf, clamp, lerp, rand, TAU, makeGlow, makeSmoke } from './battle.js?v=dd45ca2d';
import { t as tr } from './i18n.js?v=dd45ca2d';

const ASSET_V = '1'; // 写实单位贴图版本号（更新 assets/units 后加一）
const UNIT_K = 0.37; // 精灵像素 → 战场单位（sc=1 时）
const PIXI_URL = './vendor/pixi.js?v=dd45ca2d';

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
function coneTex() { // 探照灯光柱：底部（灯头）最亮，向远处变淡变宽
  const c = mk(96, 256), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 256, 0, 0); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.35, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.moveTo(46, 256); x.lineTo(50, 256); x.lineTo(96, 0); x.lineTo(0, 0); x.closePath(); x.fill();
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
function hGradTex(c0, c1) {
  const c = mk(128, 2), x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, c0); g.addColorStop(1, c1); x.fillStyle = g; x.fillRect(0, 0, 128, 2); return c;
}
function barrelTex() { // 榴弹炮炮管（含炮口制退器）
  const c = mk(80, 16), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 2, 0, 14); g.addColorStop(0, '#4a5163'); g.addColorStop(0.5, '#262b38'); g.addColorStop(1, '#12151d');
  x.fillStyle = g; x.fillRect(0, 4, 68, 8); x.fillRect(66, 2, 12, 12); x.fillStyle = '#0b0d13'; x.fillRect(70, 5, 2, 6);
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

// ---------- 现代战场背景 ----------
// 城市废墟天际线：残楼、断顶、裸露钢筋、塔吊；部分楼体着火（记录火点位置，用于动态火光与烟柱）
function drawCity(x, w, baseY, hMin, hMax, col, R, fires, o = {}) {
  const winCol = o.win || 'rgba(255,150,70,';
  let px = -20;
  while (px < w + 20) {
    const bw = (o.wMin || 14) + R() * (o.wVar || 40), bh = hMin + R() * (hMax - hMin), top = baseY - bh, kind = R();
    x.fillStyle = col; x.beginPath(); x.moveTo(px, baseY);
    if (kind < 0.38) { // 断顶残楼
      x.lineTo(px, top + R() * bh * 0.15);
      const n = 3 + ((R() * 4) | 0);
      for (let i = 1; i <= n; i++) x.lineTo(px + bw * i / n, top + R() * bh * 0.5);
    } else if (kind < 0.52) { // 半边坍塌
      x.lineTo(px, top); x.lineTo(px + bw * 0.35, top + bh * 0.08); x.lineTo(px + bw * 0.6, top + bh * 0.4); x.lineTo(px + bw, top + bh * 0.62);
    } else { x.lineTo(px, top); x.lineTo(px + bw, top); }
    x.lineTo(px + bw, baseY); x.closePath(); x.fill();
    if (kind < 0.38 && R() < 0.6) { // 裸露钢筋
      x.strokeStyle = col; x.lineWidth = 1;
      for (let i = 0; i < 3; i++) { const gx = px + bw * (0.2 + R() * 0.6); x.beginPath(); x.moveTo(gx, top + bh * 0.3); x.lineTo(gx + (R() - 0.5) * 6, top - R() * bh * 0.18); x.stroke(); }
    }
    if (kind >= 0.52 && bh > hMax * 0.75 && R() < 0.5) x.fillRect(px + bw * 0.5, top - bh * 0.22, 1.3, bh * 0.22); // 天线
    // 窗户：大多熄灭，少数被火光映亮
    if (o.windows) {
      const ww = o.windows, rows = Math.floor(bh / (ww * 3.2)), cols = Math.floor(bw / (ww * 2.6));
      for (let r = 1; r < rows; r++) for (let cI = 0; cI < cols; cI++) {
        const wx = px + 3 + cI * ww * 2.6, wy = baseY - bh + r * ww * 3.2;
        if (wy < top + bh * 0.2 && kind < 0.52) continue;
        const lit = R() < (o.litProb || 0.05);
        x.fillStyle = lit ? winCol + (0.35 + R() * 0.45) + ')' : 'rgba(255,255,255,0.025)';
        x.fillRect(wx, wy, ww, ww * 1.3);
      }
    }
    if (R() < (o.fireProb || 0.12)) fires.push({ x: px + bw * (0.25 + R() * 0.5), y: kind < 0.52 ? top + bh * 0.3 : top + 1, s: 0.6 + R() * 0.8, ph: R() * TAU });
    if (o.cranes && R() < 0.05) { // 塔吊
      const cx = px + bw * 0.5, ch = hMax * 1.25; x.strokeStyle = col; x.lineWidth = 2;
      x.beginPath(); x.moveTo(cx, baseY); x.lineTo(cx, baseY - ch); x.moveTo(cx - ch * 0.25, baseY - ch + 3); x.lineTo(cx + ch * 0.55, baseY - ch + 3); x.stroke();
      x.lineWidth = 0.7; x.beginPath(); x.moveTo(cx + ch * 0.4, baseY - ch + 3); x.lineTo(cx + ch * 0.4, baseY - ch * 0.6); x.stroke();
    }
    px += bw + (R() < 0.25 ? R() * 18 : -R() * 3);
  }
}
function drawPylons(x, w, baseY, h, col, R) { // 高压电塔 + 下垂电线
  const xs = []; for (let px = 40 + R() * 80; px < w; px += 170 + R() * 120) xs.push(px);
  x.strokeStyle = col; x.fillStyle = col;
  for (const px of xs) {
    const top = baseY - h, bw = h * 0.28; x.lineWidth = 1.4;
    x.beginPath(); x.moveTo(px - bw / 2, baseY); x.lineTo(px - 1.5, top); x.lineTo(px + 1.5, top); x.lineTo(px + bw / 2, baseY); x.stroke();
    x.lineWidth = 0.7;
    for (let k = 0.15; k < 0.95; k += 0.17) { const y1 = baseY - h * k, y2 = baseY - h * (k + 0.17), hw1 = bw / 2 * (1 - k), hw2 = bw / 2 * (1 - k - 0.17);
      x.beginPath(); x.moveTo(px - hw1, y1); x.lineTo(px + hw2, y2); x.moveTo(px + hw1, y1); x.lineTo(px - hw2, y2); x.stroke(); }
    x.lineWidth = 1.4; x.beginPath(); x.moveTo(px - h * 0.2, top + h * 0.12); x.lineTo(px + h * 0.2, top + h * 0.12); x.moveTo(px - h * 0.14, top + h * 0.25); x.lineTo(px + h * 0.14, top + h * 0.25); x.stroke();
  }
  x.lineWidth = 0.6; x.globalAlpha = 0.8;
  for (let i = 0; i + 1 < xs.length; i++) for (const [dy, dw] of [[0.12, 0.2], [0.25, 0.14]]) for (const sgn of [-1, 1]) {
    const a = xs[i] + sgn * h * dw, b = xs[i + 1] + sgn * h * dw, y = baseY - h + h * dy;
    if (R() < 0.15) continue; // 有的电线被炸断
    x.beginPath(); x.moveTo(a, y); x.quadraticCurveTo((a + b) / 2, y + h * 0.22, b, y); x.stroke();
  }
  x.globalAlpha = 1;
}
function drawWreck(x, cx, cy, s, R, col) { // 被击毁的坦克/卡车残骸（剪影）
  x.fillStyle = col;
  if (R() < 0.6) { // 坦克
    x.beginPath(); x.moveTo(cx - 14 * s, cy); x.lineTo(cx - 11 * s, cy - 5 * s); x.lineTo(cx + 11 * s, cy - 5 * s); x.lineTo(cx + 14 * s, cy); x.closePath(); x.fill();
    x.fillRect(cx - 6 * s, cy - 9 * s, 10 * s, 4.5 * s);
    x.save(); x.translate(cx + 3 * s, cy - 7 * s); x.rotate((R() - 0.3) * 0.9); x.fillRect(0, -1 * s, 14 * s, 1.8 * s); x.restore();
  } else { // 翻倒的卡车
    x.save(); x.translate(cx, cy); x.rotate((R() - 0.5) * 0.5);
    x.fillRect(-12 * s, -7 * s, 16 * s, 7 * s); x.fillRect(4 * s, -5 * s, 7 * s, 5 * s);
    x.beginPath(); x.arc(-8 * s, 0, 2.4 * s, 0, TAU); x.arc(6 * s, 0, 2.4 * s, 0, TAU); x.fill(); x.restore();
  }
}
function drawSandbags(x, cx, baseY, n, rows, s, R) {
  for (let r = 0; r < rows; r++) for (let i = 0; i < n - r; i++) {
    const bx = cx + (i + r * 0.5) * 13 * s, by = baseY - r * 6 * s - 4 * s;
    const g = x.createLinearGradient(0, by - 4 * s, 0, by + 4 * s); g.addColorStop(0, '#6b604b'); g.addColorStop(1, '#2a251d');
    x.fillStyle = g; x.beginPath(); x.ellipse(bx + 6 * s, by, 7 * s, 4 * s, 0, 0, TAU); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 1; x.stroke();
  }
}
function drawWire(x, x0, x1, y, h, R) { // 蛇腹形铁丝网 + 木桩
  x.strokeStyle = 'rgba(150,150,160,0.55)'; x.lineWidth = 0.9;
  for (let px = x0; px < x1; px += h * 0.55) { x.beginPath(); x.ellipse(px, y - h / 2, h * 0.45, h / 2, 0.25, 0, TAU); x.stroke(); }
  x.strokeStyle = '#1a1612'; x.lineWidth = 2.2;
  for (let px = x0; px <= x1; px += h * 2.2) { x.beginPath(); x.moveTo(px, y + 2); x.lineTo(px + (R() - 0.5) * 3, y - h * 1.25); x.stroke(); }
}
function drawHedgehog(x, cx, by, s) { // 反坦克拒马（三根交叉钢梁）
  x.strokeStyle = '#2c2d34'; x.lineCap = 'butt'; x.lineWidth = 3.2 * s;
  x.beginPath(); x.moveTo(cx - 11 * s, by); x.lineTo(cx + 9 * s, by - 20 * s); x.moveTo(cx + 11 * s, by); x.lineTo(cx - 9 * s, by - 20 * s); x.moveTo(cx - 1 * s, by + 1); x.lineTo(cx + 2 * s, by - 22 * s); x.stroke();
  x.strokeStyle = 'rgba(200,170,140,0.45)'; x.lineWidth = 1; x.beginPath(); x.moveTo(cx - 11 * s, by - 1); x.lineTo(cx + 9 * s, by - 21 * s); x.stroke();
}
function bunkerTex(side, bw, bh, R) { // 碉堡：混凝土掩体 + 射击孔 + 沙袋 + 伪装网 + 雷达（面朝右绘制，红方翻转）
  const pad = 14, w = bw + pad * 2, h = bh + pad;
  const c = mk(w * SR, h * SR), x = c.getContext('2d'); x.scale(SR, SR);
  const col = COL[side], by = h - 2, top = by - bh, x0 = pad, x1 = pad + bw;
  const g = x.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, '#222a38'); g.addColorStop(0.7, '#465166'); g.addColorStop(1, '#2c3443');
  x.fillStyle = g; x.beginPath(); x.moveTo(x0 - 4, by); x.lineTo(x0, top + bh * 0.18); x.lineTo(x0 + bw * 0.18, top); x.lineTo(x1 - bw * 0.3, top); x.lineTo(x1 + 2, top + bh * 0.4); x.lineTo(x1 + 8, by); x.closePath(); x.fill();
  x.strokeStyle = 'rgba(255,255,255,0.08)'; x.lineWidth = 1; x.stroke();
  x.save(); x.clip(); // 混凝土斑驳 + 阵营色条
  for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + R() * 0.06})`; x.fillRect(x0 + R() * bw, top + R() * bh, 2 + R() * 6, 1 + R() * 3); }
  x.fillStyle = col.dark; x.globalAlpha = 0.85; x.fillRect(x0 - 6, top + bh * 0.46, bw + 16, 3); x.globalAlpha = 1;
  x.restore();
  // 伪装网（屋顶）
  x.fillStyle = 'rgba(40,52,38,0.9)'; x.beginPath(); x.moveTo(x0 - 2, top + bh * 0.22); x.quadraticCurveTo(x0 + bw * 0.4, top - 6, x1 - bw * 0.25, top + 1); x.lineTo(x1 - bw * 0.2, top + 6); x.quadraticCurveTo(x0 + bw * 0.4, top + 2, x0 + 2, top + bh * 0.3); x.closePath(); x.fill();
  for (let i = 0; i < 26; i++) { x.fillStyle = R() < 0.5 ? 'rgba(70,80,52,0.8)' : 'rgba(20,26,18,0.8)'; x.fillRect(x0 + R() * bw * 0.75, top - 3 + R() * 7, 2, 2); }
  // 射击孔（发阵营色光）
  for (const k of [0.3, 0.58]) { x.fillStyle = '#05070c'; x.fillRect(x0 + bw * 0.35, top + bh * k, bw * 0.42, 4); x.fillStyle = col.main; x.globalAlpha = 0.85; x.fillRect(x0 + bw * 0.37, top + bh * k + 1, bw * 0.38, 2); x.globalAlpha = 1; }
  // 雷达
  x.strokeStyle = '#3b4252'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(x0 + bw * 0.28, top); x.lineTo(x0 + bw * 0.28, top - 9); x.stroke();
  x.fillStyle = '#4b5366'; x.beginPath(); x.ellipse(x0 + bw * 0.28, top - 11, 6, 2.6, -0.4, 0, Math.PI); x.fill();
  // 前方沙袋墙
  drawSandbags(x, x1 - 6, by, 4, 2, 0.75, R);
  return { c, w, h, ax: x0 + bw * 0.5, ay: by };
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
    const units = {};
    for (const side of ['blue', 'red']) {
      const meta = await fetch(`${base}soldier_${side}.json?v=${ASSET_V}`).then((r) => r.json());
      let im; try { im = await img(`${base}soldier_${side}.avif?v=${ASSET_V}`); } catch { im = await img(`${base}soldier_${side}.png?v=${ASSET_V}`); }
      const source = P.Texture.from(im, true).source; const [cw, ch] = meta.cell; const clips = {};
      for (const [k, c] of Object.entries(meta.clips)) clips[k] = { ...c, tex: Array.from({ length: c.n }, (_, i) => new P.Texture({ source, frame: new P.Rectangle(i * cw, c.row * ch, cw, ch) })) };
      units[side] = { meta, clips, ax: meta.foot[0] / cw, ay: meta.foot[1] / ch };
    }
    if (this.gl) this.units = units;
  }
  // 写实士兵：子弹与枪口火光从贴图里步枪枪口的位置射出
  _shoot(s) {
    if (!this.gl || !this.units) return super._shoot(s);
    const U = this.units[s.side], sc = this.scaleAt(s.y), dir = s.side === 'blue' ? 1 : -1, k = UNIT_K * sc;
    if (s.crouch === undefined) s.crouch = Math.random() < 0.35;
    const m = (s.crouch ? U.clips.crouch : U.clips.shoot).muzzle[0] || [U.meta.foot[0] + 30, U.meta.foot[1] - 80];
    const sx = s.x + dir * (m[0] - U.meta.foot[0]) * k, sy = s.y + (m[1] - U.meta.foot[1]) * k;
    const ty = clamp(s.y + rand(-30, 30), this.laneTop, this.laneBot);
    const tx = this.frontX(ty) + dir * rand(15, 120);
    this._bullet(s.side, sx, sy, tx, ty - 18 * this.scaleAt(ty));
    this.parts.push({ type: 'glow', spr: 'fire', x: sx, y: sy, vx: 0, vy: 0, life: 0.07, max: 0.07, size: 16 * sc, add: true });
    s.recoil = 0.12;
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
      shadow: T(shadowTex()), crater: T(craterTex()), cone: T(coneTex()), edge: T(edgeTex()), barrel: T(barrelTex()),
      skyGlow: T(vGradTex([[0, 'rgba(255,255,255,0)'], [0.55, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,1)']])),
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
      craters: pool(L.craters, this.tx.crater), craterGlow: pool(L.craters, this.tx.fire, 'add'), lights: pool(L.lights, this.tx.cone, 'add'),
      baseGlow: pool(L.bases, this.tx.blue, 'add'), shadows: pool(L.units, this.tx.shadow), soldiers: pool(L.units, this.tx.soldier.blue.idle),
      unitGlow: pool(L.units, this.tx.blue, 'add'), smoke: pool(L.smoke, this.tx.smoke),
      bulletLines: pool(L.fx, this.tx.line, 'add'), glows: pool(L.fx, this.tx.white, 'add'), sparks: pool(L.fx, this.tx.line, 'add'),
      shells: pool(L.fx, this.tx.white, 'add'), rings: pool(L.fx, this.tx.ring, 'add'), streaks: pool(L.fx, this.tx.fline, 'add'),
      embers: pool(L.fx, P.Texture.WHITE, 'add'), debris: pool(L.debris, P.Texture.WHITE),
    };
    // 碉堡、炮管、旗帜
    this.bases = {};
    for (const side of ['blue', 'red']) {
      const b = { body: S(P.Texture.EMPTY, L.bases), barrel: S(this.tx.barrel, L.bases), flag: new P.Graphics(), mast: new P.Graphics(),
        label: new P.Text({ text: '', style: { fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif', fontSize: 15, fontWeight: '900', fill: '#ffffff' } }) };
      b.barrel.anchor.set(0.06, 0.5); b.label.anchor.set(0.5);
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
    // 天空 + 地面
    {
      const c = mk(W * s, H * s), x = c.getContext('2d'); x.scale(s, s); const R = rng32(seed);
      const sky = x.createLinearGradient(0, 0, 0, hz);
      sky.addColorStop(0, '#04050a'); sky.addColorStop(0.45, '#0b0e1a'); sky.addColorStop(0.8, '#1d1720'); sky.addColorStop(1, '#3b2119');
      x.fillStyle = sky; x.fillRect(0, 0, W, hz + 2);
      for (let i = 0; i < W * 0.05; i++) { x.fillStyle = `rgba(255,255,255,${0.1 + R() * 0.4})`; x.fillRect(R() * W, R() * hz * 0.55, 1, 1); } // 硝烟遮掉大半星空
      const mx = W * 0.8, my = H * 0.11; // 被烟尘染红的月亮
      const mg = x.createRadialGradient(mx, my, 0, mx, my, H * 0.16);
      mg.addColorStop(0, 'rgba(255,214,170,0.75)'); mg.addColorStop(0.09, 'rgba(240,170,120,0.55)'); mg.addColorStop(0.1, 'rgba(220,130,90,0.12)'); mg.addColorStop(1, 'rgba(200,110,80,0)');
      x.fillStyle = mg; x.fillRect(0, 0, W, hz);
      const g = x.createLinearGradient(0, hz, 0, H); // 焦土
      g.addColorStop(0, '#231a16'); g.addColorStop(0.3, '#17120f'); g.addColorStop(1, '#070607');
      x.fillStyle = g; x.fillRect(0, hz, W, H - hz);
      for (let i = 0; i < W * H * 0.0035; i++) { // 碎石瓦砾，近大远小
        const yy = hz + Math.pow(R(), 0.8) * (H - hz), k = (yy - hz) / (H - hz);
        x.fillStyle = R() < 0.6 ? `rgba(0,0,0,${0.2 + R() * 0.35})` : `rgba(120,100,80,${0.06 + R() * 0.1})`;
        x.fillRect(R() * W, yy, (0.6 + R() * 2.2) * (0.4 + k), (0.5 + R() * 1.2) * (0.4 + k));
      }
      x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 2; // 车辙
      for (let i = 0; i < 4; i++) { const x0 = R() * W, x1 = x0 + (R() - 0.5) * W * 0.6; x.beginPath(); x.moveTo(x0, hz + 4); x.quadraticCurveTo((x0 + x1) / 2 + (R() - 0.5) * 120, H * 0.7, x1, H + 4); x.stroke();
        x.beginPath(); x.moveTo(x0 + 6, hz + 4); x.quadraticCurveTo((x0 + x1) / 2 + 12 + (R() - 0.5) * 20, H * 0.7, x1 + 18, H + 4); x.stroke(); }
      x.strokeStyle = 'rgba(255,170,120,0.035)'; x.lineWidth = 1; // 淡淡的透视犁沟
      for (let i = -14; i <= 14; i++) { x.beginPath(); x.moveTo(W / 2 + i * W * 0.025, hz); x.lineTo(W / 2 + i * W * 0.16, H); x.stroke(); }
      // 远处地面上的残骸（位于士兵活动区之外的地平线带）
      this.wrecks = [];
      for (let i = 0; i < Math.max(3, Math.round(W / 220)); i++) {
        const wx = (i + 0.2 + R() * 0.6) / Math.max(3, Math.round(W / 220)) * W, wy = hz + (this.laneTop - hz) * (0.25 + R() * 0.55), sc = 0.6 + (wy - hz) / (H - hz) * 1.4;
        drawWreck(x, wx, wy, sc * 1.3, R, '#1a1716'); x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(255,140,80,0.18)'; x.fillRect(wx - 30 * sc, wy - 16 * sc, 60 * sc, 7 * sc); x.globalCompositeOperation = 'source-over'; if (R() < 0.7) this.wrecks.push({ x: wx, y: wy - 6 * sc, s: sc * 0.7, ph: R() * TAU });
      }
      swap(this.sp.bg, c);
    }
    // 远景：废墟城市天际线（带塔吊、亮窗、火点）
    {
      const lw = W + PAD * 2, lh = hz + 4, c = mk(lw * s, lh * s), x = c.getContext('2d'); x.scale(s, s); const R = rng32(seed + 1);
      this.farFires = [];
      drawCity(x, lw, hz + 2, H * 0.05, H * 0.17, '#1e2031', R, this.farFires, { windows: 1.6, litProb: 0.04, fireProb: 0.1, cranes: true, wMin: 12, wVar: 34 });
      x.globalCompositeOperation = 'source-atop'; // 下方火光照亮楼体
      const g = x.createLinearGradient(0, hz - H * 0.15, 0, hz); g.addColorStop(0, 'rgba(255,140,80,0.04)'); g.addColorStop(1, 'rgba(255,110,50,0.38)');
      x.fillStyle = g; x.fillRect(0, 0, lw, lh);
      swap(this.sp.far, c);
    }
    // 中景：更近的残楼 + 高压电塔
    {
      const lw = W + PAD * 2, lh = hz + 4, c = mk(lw * s, lh * s), x = c.getContext('2d'); x.scale(s, s); const R = rng32(seed + 2);
      this.nearFires = [];
      drawCity(x, lw, hz + 3, H * 0.015, H * 0.08, '#0e0e17', R, this.nearFires, { windows: 2.2, litProb: 0.025, fireProb: 0.08, wMin: 20, wVar: 60 });
      drawPylons(x, lw, hz + 3, H * 0.2, '#101018', R);
      x.globalCompositeOperation = 'source-atop';
      const g = x.createLinearGradient(0, hz - H * 0.2, 0, hz); g.addColorStop(0, 'rgba(255,120,60,0)'); g.addColorStop(1, 'rgba(255,100,50,0.26)');
      x.fillStyle = g; x.fillRect(0, 0, lw, lh);
      swap(this.sp.near, c);
    }
    // 前景：两侧沙袋工事、铁丝网、反坦克拒马（贴着画面底边，中间留空不挡战斗）
    {
      const fh = Math.max(26, H * 0.1), lw = W + PAD * 2, c = mk(lw * s, fh * s), x = c.getContext('2d'); x.scale(s, s); const R = rng32(seed + 3);
      const by = fh, k = clamp(H / 420, 0.7, 1.3);
      drawWire(x, 0, PAD + W * 0.3, by - 2, fh * 0.35, R);
      drawWire(x, PAD + W * 0.7, lw, by - 2, fh * 0.35, R);
      drawSandbags(x, PAD - 12 * k, by + 3, 6, 3, k, R);
      drawSandbags(x, PAD + W - 70 * k, by + 3, 6, 3, k, R);
      drawHedgehog(x, PAD + W * 0.2, by + 2, k * 1.1); drawHedgehog(x, PAD + W * 0.82, by + 2, k);
      drawHedgehog(x, PAD + W * 0.36, by + 4, k * 0.8); drawHedgehog(x, PAD + W * 0.66, by + 4, k * 0.85);
      this.fgH = fh;
      swap(this.sp.fg, c);
    }
    // 碉堡
    {
      const bw = clamp(W * 0.065, 40, 72), bh = clamp(H * 0.15, 44, 86), R = rng32(seed + 4);
      for (const side of ['blue', 'red']) { const b = bunkerTex(side, bw, bh, R); this.bases[side].meta = b; swap(this.bases[side].body, b.c); }
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
    sp.skyGlow.tint = mixNum(0xff5a28, rgbNum(COL[surgeSide].glow), 0.3 * this.surgeT);
    sp.skyGlow.alpha = clamp(0.22 + this.intensity * 0.05 + this.surgeT * 0.5, 0, 0.9);
    // 浓烟云
    for (const c of this.clouds) { const s = pl.clouds.get(); s.position.set(c.x - cam * 0.15, c.y * H); s.width = c.w * 1.2; s.height = c.h * 1.4; s.alpha = Math.min(0.9, c.a * 1.4 * (0.8 + smokeK * 0.25)); s.tint = 0x8a7d7a; }
    // 远景 / 中景视差
    sp.far.position.set(-PAD - cam * 0.25, 0); sp.far.width = W + PAD * 2; sp.far.height = hz + 4;
    sp.near.position.set(-PAD - cam * 0.5, 0); sp.near.width = W + PAD * 2; sp.near.height = hz + 4;
    const fireAt = (pool, f, off, k) => { // 楼体火光闪烁（纯视觉）
      const fl = 0.65 + 0.2 * Math.sin(t * 9 + f.ph) + 0.15 * Math.sin(t * 23 + f.ph * 2);
      const s = pool.get(); s.position.set(f.x - PAD - off, f.y); s.width = s.height = 22 * f.s * k * (0.9 + fl * 0.2); s.alpha = clamp(fl * (0.55 + this.intensity * 0.05), 0, 1);
    };
    for (const f of this.farFires) fireAt(pl.fires, f, cam * 0.25, 1);
    for (const f of this.nearFires) fireAt(pl.nearFires, f, cam * 0.5, 1.5);
    // 远处炮口闪光：频率只由真实成交强度决定
    if (Math.random() < this.intensity * 0.9 * dt) this.hz.push({ x: rand(0, W), life: 0.3, max: 0.3, s: rand(0.6, 1.4), col: Math.random() < 0.5 ? 0xffb070 : 0xffe0b0 });
    for (const h of this.hz) { h.life -= dt; const s = pl.fires.get(); const k = h.life / h.max; s.position.set(h.x, hz - 2); s.width = 120 * h.s; s.height = 40 * h.s; s.alpha = k * k * 0.9; s.tint = h.col; }
    this.hz = this.hz.filter((h) => h.life > 0);
    // 烟柱：从着火的楼和残骸里升起
    const srcs = this.wrecks;
    if (this.plumes.length < 70 && Math.random() < dt * (2 + smokeK * 2)) {
      const useFar = Math.random() < 0.55 && this.farFires.length;
      const f = useFar ? this.farFires[(Math.random() * this.farFires.length) | 0] : srcs[(Math.random() * srcs.length) | 0];
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
    for (const f of this.fog) { const s = pl.fog.get(); s.position.set(f.x - cam * 0.6, hz); s.width = f.w * 1.2; s.height = f.h * 1.2; s.alpha = Math.min(0.95, f.a * smokeK * 0.85); s.tint = 0x77706e; }
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
      const U = this.units && this.units[s.side];
      if (U) { // 写实士兵（3D 模型渲染的动作帧）
        if (s.crouch === undefined) s.crouch = Math.random() < 0.35;
        let clip, fi;
        if (s.dead) { clip = U.clips.death; fi = Math.min(clip.n - 1, (s.dieT / 1.1 * clip.n) | 0); }
        else if (s.recoil > 0.02) { clip = s.crouch ? U.clips.crouch : U.clips.shoot; fi = Math.min(clip.n - 1, ((0.12 - s.recoil) / 0.12 * clip.n) | 0); }
        else if (s.moving) { clip = this.surge === s.side ? U.clips.run : U.clips.walk; fi = ((((s.phase % TAU) + TAU) % TAU) / TAU * clip.n) | 0; }
        else { clip = s.crouch ? U.clips.crouch : U.clips.shoot; fi = 0; }
        const sh = pl.shadows.get(); sh.position.set(s.x - face * 2 * sc, s.y); sh.width = (s.dead ? 40 : 26) * sc; sh.height = 7 * sc; sh.alpha = fade * 0.9;
        if (!s.dead) { const tg = pl.unitGlow.get(tx[s.side]); tg.position.set(s.x, s.y); tg.width = 30 * sc; tg.height = 8 * sc; tg.alpha = 0.35 + 0.25 * this.surgeT * (this.surge === s.side ? 1 : 0); } // 脚下阵营色光晕
        const u = pl.soldiers.get(clip.tex[fi]); u.anchor.set(U.ax, U.ay);
        u.position.set(s.x, s.y); u.scale.set(UNIT_K * sc * face, UNIT_K * sc); u.alpha = fade;
        const depth = clamp((s.y - this.laneTop) / (this.laneBot - this.laneTop), 0, 1);
        u.tint = mixNum(0xa4abbd, 0xffffff, depth); // 远处更暗，营造夜战纵深
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
      const c = b.side === 'blue' ? 0x93c5fd : 0xfca5a5, len = Math.hypot(b.vx, b.vy) * 0.03;
      const l = pl.bulletLines.get(); l.anchor.set(1, 0.5); l.position.set(b.x, b.y); l.width = len; l.height = 2; l.rotation = Math.atan2(b.vy, b.vx); l.tint = c; l.alpha = 0.95;
      const g = pl.glows.get(tx[b.side]); g.position.set(b.x, b.y); g.width = g.height = 12;
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
    for (const s of this.shells) {
      const big = s.kind === 'whale' ? 3 : s.kind === 'heavy' ? 2 : 1.3;
      const a = pl.shells.get(tx.white); a.position.set(s.x, s.y); a.width = a.height = 16 * big;
      const b = pl.shells.get(tx[s.side]); b.position.set(s.x, s.y); b.width = b.height = 32 * big;
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
      // 地面光晕
      const g = pl.baseGlow.get(tx[side]); g.position.set(x, by - 10); g.width = 140; g.height = 90; g.alpha = 0.45;
      // 探照灯：缓慢扫动（纯视觉）
      const L = pl.lights.get(); L.anchor.set(0.5, 1); L.position.set(x - dir * 4, by - this.bunkerH + 2);
      L.rotation = dir * (0.35 + 0.28 * Math.sin(t * 0.35 + (blue ? 0 : 2))); L.height = H * 0.7; L.width = H * 0.26; L.tint = mixNum(rgbNum(c.glow), 0xffffff, 0.5); L.alpha = 0.38;
      // 碉堡
      b.body.anchor.set(m.ax / m.w, m.ay / m.h); b.body.position.set(x, by); b.body.scale.set(dir / SR, 1 / SR);
      // 榴弹炮管（位置与经典版大炮一致，炮弹从这里射出）
      b.barrel.position.set(x + dir * 10, H * 0.6); b.barrel.scale.set(dir * 0.48, 0.6); b.barrel.rotation = dir * -0.6;
      // 射击孔闪烁
      for (let i = 0; i < 2; i++) { const w = pl.baseGlow.get(tx[side]); w.position.set(x + dir * 4, by - this.bunkerH * (0.42 + i * 0.28)); w.width = 34; w.height = 12; w.alpha = 0.35 + 0.25 * Math.sin(t * 4 + i * 2 + (blue ? 0 : 1)); }
      // 旗杆（天线桅杆）+ 闪烁信标 + 飘动的旗
      const mx = x - dir * 8, top = by - this.bunkerH - 2, py = top - 50;
      b.mast.clear().moveTo(mx, top).lineTo(mx, py).stroke({ width: 2, color: 0xcbd5e1 });
      const bc = pl.baseGlow.get(tx.red); bc.position.set(mx, py - 2); bc.width = bc.height = 14; bc.alpha = (Math.sin(t * 3 + (blue ? 0 : 1.5)) > 0.6) ? 0.95 : 0.15;
      const fw = 40, fh = 26, pts = [];
      for (let i = 0; i <= 10; i++) { const k = i / 10; pts.push(mx + dir * fw * k, py + 4 + Math.sin(t * 5 - k * 4) * 3 * k); }
      for (let i = 10; i >= 0; i--) { const k = i / 10; pts.push(mx + dir * fw * k, py + 4 + fh + Math.sin(t * 5 - k * 4) * 3 * k); }
      b.flag.clear().poly(pts).fill({ color: hexNum(c.main) });
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
