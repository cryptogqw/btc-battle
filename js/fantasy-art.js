// 奇幻战场背景（Canvas 2D 预渲染，交给 WebGL 当贴图用）：
// 左侧人族：蓝色暮光、星空、山丘上的城堡与松林；右侧兽族：血红天空、火山与熔岩、原创的黑色尖塔要塞、怪石与枯树。
// 所有函数只画静态图层，并返回需要动态闪烁的火点位置（熔岩、火把、火盆）。
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
export function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

// 竖直方向渐隐的水平色带（用于地平线两侧不同颜色的天光、地表色调）
function bandOverlay(x, w, y0, y1, stops, fadeUp = true) {
  const c = mk(w, Math.max(1, y1 - y0)), g = c.getContext('2d');
  const hg = g.createLinearGradient(0, 0, w, 0); for (const [k, col] of stops) hg.addColorStop(k, col);
  g.fillStyle = hg; g.fillRect(0, 0, w, c.height);
  g.globalCompositeOperation = 'destination-in';
  const vg = g.createLinearGradient(0, 0, 0, c.height);
  vg.addColorStop(0, fadeUp ? 'rgba(0,0,0,0)' : '#000'); vg.addColorStop(1, fadeUp ? '#000' : 'rgba(0,0,0,0.15)');
  g.fillStyle = vg; g.fillRect(0, 0, w, c.height);
  x.drawImage(c, 0, y0);
}

// ---------- 天空 + 地面 ----------
export function drawSkyGround(x, W, H, hz, laneTop, R) {
  const sky = x.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, '#04050c'); sky.addColorStop(0.55, '#0d1022'); sky.addColorStop(1, '#1c1a2c');
  x.fillStyle = sky; x.fillRect(0, 0, W, hz + 2);
  bandOverlay(x, W, hz * 0.15, hz + 2, [[0, 'rgba(70,100,200,0.55)'], [0.42, 'rgba(90,80,140,0.18)'], [0.58, 'rgba(120,40,40,0.2)'], [1, 'rgba(220,60,20,0.75)']]);
  bandOverlay(x, W, hz * 0.7, hz + 2, [[0, 'rgba(255,200,120,0.18)'], [0.4, 'rgba(255,200,120,0)'], [0.65, 'rgba(255,90,30,0)'], [1, 'rgba(255,120,40,0.45)']]);
  // 星空只在人族一侧（兽族一侧被火山灰遮住）
  for (let i = 0; i < W * 0.1; i++) {
    const sx = Math.pow(R(), 1.6) * W * 0.7, sy = R() * hz * 0.7;
    x.fillStyle = `rgba(220,230,255,${(0.15 + R() * 0.6) * (1 - sx / (W * 0.7))})`; x.fillRect(sx, sy, R() < 0.1 ? 1.6 : 1, R() < 0.1 ? 1.6 : 1);
  }
  // 月亮（人族一侧）
  const mx = W * 0.16, my = hz * 0.28, mr = Math.min(W, H) * 0.035;
  const mg = x.createRadialGradient(mx, my, 0, mx, my, mr * 6);
  mg.addColorStop(0, 'rgba(230,240,255,0.95)'); mg.addColorStop(0.16, 'rgba(210,225,255,0.85)'); mg.addColorStop(0.18, 'rgba(160,180,255,0.18)'); mg.addColorStop(1, 'rgba(120,140,255,0)');
  x.fillStyle = mg; x.fillRect(mx - mr * 6, my - mr * 6, mr * 12, mr * 12);
  // 地面：人族一侧青草地，兽族一侧焦黑火山灰
  const g = x.createLinearGradient(0, hz, 0, H);
  g.addColorStop(0, '#1d1b1c'); g.addColorStop(0.3, '#141313'); g.addColorStop(1, '#070607');
  x.fillStyle = g; x.fillRect(0, hz, W, H - hz);
  bandOverlay(x, W, hz, H, [[0, 'rgba(45,80,40,0.55)'], [0.38, 'rgba(60,70,40,0.35)'], [0.55, 'rgba(70,50,35,0.3)'], [1, 'rgba(70,22,14,0.55)']], false);
  for (let i = 0; i < W * H * 0.004; i++) { // 草丛 / 碎石
    const yy = hz + Math.pow(R(), 0.8) * (H - hz), k = (yy - hz) / (H - hz), px = R() * W, left = px / W;
    if (R() < 1 - left) { x.strokeStyle = `rgba(${80 + R() * 40},${120 + R() * 40},${60 + R() * 20},${0.12 + R() * 0.18})`; x.lineWidth = 0.8 + k; x.beginPath(); x.moveTo(px, yy); x.lineTo(px + (R() - 0.5) * 3, yy - (2 + R() * 4) * (0.4 + k)); x.stroke(); }
    else { x.fillStyle = R() < 0.6 ? `rgba(0,0,0,${0.25 + R() * 0.3})` : `rgba(130,90,70,${0.06 + R() * 0.1})`; x.fillRect(px, yy, (0.6 + R() * 2.2) * (0.4 + k), (0.5 + R() * 1.2) * (0.4 + k)); }
  }
  // 兽族一侧地面上的熔岩裂缝（淡淡的橙光）
  for (let i = 0; i < 7; i++) {
    let px = W * (0.66 + R() * 0.34), py = hz + (H - hz) * (0.05 + R() * 0.9);
    x.strokeStyle = 'rgba(255,110,30,0.22)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(px, py);
    for (let j = 0; j < 6; j++) { px += (R() - 0.3) * 26; py += (R() - 0.5) * 8; x.lineTo(px, py); }
    x.stroke();
  }
  // 远处地面上的残骸：被击毁的投石车与马车（会冒烟）
  const wrecks = []; const n = Math.max(3, Math.round(W / 240));
  for (let i = 0; i < n; i++) {
    const wx = (i + 0.2 + R() * 0.6) / n * W, wy = hz + (laneTop - hz) * (0.25 + R() * 0.55), s = 0.6 + (wy - hz) / (H - hz) * 1.4;
    drawSiegeWreck(x, wx, wy, s, R); if (R() < 0.75) wrecks.push({ x: wx, y: wy - 6 * s, s: s * 0.7, ph: R() * TAU });
  }
  return wrecks;
}

function drawSiegeWreck(x, cx, cy, s, R) {
  x.save(); x.translate(cx, cy); x.rotate((R() - 0.5) * 0.25); x.strokeStyle = '#1a120c'; x.lineCap = 'round';
  x.lineWidth = 2.2 * s; x.beginPath(); x.moveTo(-14 * s, 0); x.lineTo(12 * s, 0); x.moveTo(-8 * s, 0); x.lineTo(-2 * s, -11 * s); x.lineTo(6 * s, 0); x.stroke();
  x.lineWidth = 1.6 * s; x.beginPath(); x.moveTo(-2 * s, -11 * s); x.lineTo(-16 * s, -18 * s); x.stroke(); // 断掉的投臂
  x.fillStyle = '#120c08'; x.beginPath(); x.arc(-10 * s, 0, 3.2 * s, 0, TAU); x.arc(9 * s, 0, 3.2 * s, 0, TAU); x.fill();
  x.restore();
}

// ---------- 远景：左城堡 / 右火山与黑塔 ----------
export function drawFarLayer(x, lw, hz, H, W, PAD, R) {
  const fires = [];
  // 人族：山丘 + 城堡
  const hillTop = hz - H * 0.045, x0 = PAD - 80, x1 = PAD + W * 0.46;
  x.fillStyle = '#1a2036'; x.beginPath(); x.moveTo(x0, hz + 4);
  for (let px = x0; px <= x1; px += 6) { const k = (px - x0) / (x1 - x0); x.lineTo(px, hz + 4 - Math.sin(k * Math.PI) * (hz + 4 - hillTop) - Math.sin(px * 0.05) * 2); }
  x.lineTo(x1, hz + 4); x.closePath(); x.fill();
  const cx0 = PAD + W * 0.06, cx1 = PAD + W * 0.3, wallTop = hillTop - H * 0.035, stone = '#28304c', roof = '#1d2b62';
  x.fillStyle = stone; x.fillRect(cx0, wallTop, cx1 - cx0, hillTop - wallTop + 6);
  for (let px = cx0; px < cx1; px += 7) x.fillRect(px, wallTop - 4, 4, 4);   // 城垛
  const towers = [[cx0, 0.07, 0.022], [cx0 + (cx1 - cx0) * 0.33, 0.1, 0.026], [cx0 + (cx1 - cx0) * 0.55, 0.16, 0.034], [cx0 + (cx1 - cx0) * 0.78, 0.1, 0.026], [cx1, 0.075, 0.022]];
  for (const [tx, th, tw] of towers) {
    const w = W * tw, top = hillTop - H * th;
    x.fillStyle = stone; x.fillRect(tx - w / 2, top, w, hillTop - top + 4);
    x.fillStyle = roof; x.beginPath(); x.moveTo(tx - w / 2 - 3, top); x.lineTo(tx, top - w * 1.6); x.lineTo(tx + w / 2 + 3, top); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(160,190,255,0.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(tx - w / 2 - 3, top); x.lineTo(tx, top - w * 1.6); x.stroke();
    x.strokeStyle = '#c9b27a'; x.lineWidth = 1; x.beginPath(); x.moveTo(tx, top - w * 1.6); x.lineTo(tx, top - w * 1.6 - 9); x.stroke();
    x.fillStyle = R() < 0.5 ? '#3a64ff' : '#e8b43a'; x.beginPath(); x.moveTo(tx, top - w * 1.6 - 9); x.lineTo(tx + 8, top - w * 1.6 - 6.5); x.lineTo(tx, top - w * 1.6 - 4); x.closePath(); x.fill();
    for (let i = 0; i < 3; i++) if (R() < 0.7) { const wy = top + (hillTop - top) * (0.25 + i * 0.22); x.fillStyle = 'rgba(255,200,120,0.75)'; x.fillRect(tx - 1, wy, 2, 3); fires.push({ x: tx, y: wy + 1, s: 0.35, ph: R() * TAU, warm: true }); }
  }
  // 兽族：锯齿山脉
  x.fillStyle = '#140b0d'; x.beginPath(); x.moveTo(PAD + W * 0.52, hz + 4);
  for (let px = PAD + W * 0.52; px <= lw; px += 10) { const k = (px - PAD - W * 0.52) / (W * 0.5); x.lineTo(px, hz + 2 - H * (0.03 + 0.08 * Math.min(1, k * 1.5)) * (0.5 + R() * 0.7)); }
  x.lineTo(lw, hz + 4); x.closePath(); x.fill();
  // 火山：锥形山体 + 火山口 + 熔岩流
  const vx = PAD + W * 0.9, vtop = hz - H * 0.25, vw = W * 0.24;
  const vg = x.createLinearGradient(0, vtop, 0, hz); vg.addColorStop(0, '#26110e'); vg.addColorStop(1, '#100708');
  x.fillStyle = vg; x.beginPath(); x.moveTo(vx - vw, hz + 4); x.lineTo(vx - vw * 0.12, vtop); x.lineTo(vx + vw * 0.12, vtop + 3); x.lineTo(vx + vw, hz + 4); x.closePath(); x.fill();
  x.fillStyle = 'rgba(255,120,30,0.9)'; x.beginPath(); x.ellipse(vx, vtop + 1, vw * 0.11, 3, 0, 0, TAU); x.fill();
  fires.push({ x: vx, y: vtop, s: 2.6, ph: 0, lava: true });
  for (let i = 0; i < 4; i++) {
    let px = vx + (R() - 0.5) * vw * 0.18, py = vtop + 2; x.strokeStyle = `rgba(255,${90 + R() * 60},20,0.85)`; x.lineWidth = 1.6; x.beginPath(); x.moveTo(px, py);
    for (let j = 0; j < 14; j++) { px += (i < 2 ? -1 : 1) * (3 + R() * 5); py += 4 + R() * 4; x.lineTo(px, py); if (j % 4 === 3) fires.push({ x: px, y: py, s: 0.7, ph: R() * TAU, lava: true }); if (py > hz) break; }
    x.stroke();
  }
  // 原创黑色尖塔要塞：阶梯式塔身 + 两侧尖刺 + 顶部双角，塔顶一道发红光的窗缝
  const tx = PAD + W * 0.72, tb = hz + 2, th = H * 0.33, tw = W * 0.06;
  x.fillStyle = '#0b0608';
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const k0 = i / steps, k1 = (i + 1) / steps, w0 = tw * (1 - k0 * 0.62), w1 = tw * (1 - k1 * 0.62);
    const y0 = tb - th * k0, y1 = tb - th * k1;
    x.beginPath(); x.moveTo(tx - w0, y0); x.lineTo(tx - w1 * 1.08, y1 + 4); x.lineTo(tx - w1, y1); x.lineTo(tx + w1, y1); x.lineTo(tx + w1 * 1.08, y1 + 4); x.lineTo(tx + w0, y0); x.closePath(); x.fill();
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(tx + s * w1 * 1.05, y1 + 6); x.lineTo(tx + s * (w1 * 1.05 + tw * 0.35), y1 - 4); x.lineTo(tx + s * w1 * 1.05, y1 + 1); x.closePath(); x.fill(); }
  }
  const top = tb - th, tw2 = tw * 0.38;
  x.beginPath(); x.moveTo(tx - tw2, top); x.lineTo(tx - tw2 * 1.4, top - th * 0.12); x.lineTo(tx - tw2 * 0.4, top); x.moveTo(tx + tw2 * 0.4, top); x.lineTo(tx + tw2 * 1.4, top - th * 0.12); x.lineTo(tx + tw2, top); x.closePath(); x.fill();
  x.strokeStyle = 'rgba(255,70,40,0.35)'; x.lineWidth = 1; x.beginPath(); x.moveTo(tx - tw, tb); x.lineTo(tx - tw2, top); x.lineTo(tx - tw2 * 1.4, top - th * 0.12); x.stroke();
  x.fillStyle = 'rgba(255,80,30,0.95)'; x.fillRect(tx - tw2 * 0.55, top + th * 0.06, tw2 * 1.1, 2.2);
  fires.push({ x: tx, y: top + th * 0.06 + 1, s: 1.3, ph: 1, lava: true });
  for (let i = 0; i < 6; i++) { const wy = tb - th * (0.15 + R() * 0.6), wx = tx + (R() - 0.5) * tw * 0.8; x.fillStyle = 'rgba(255,90,40,0.7)'; x.fillRect(wx, wy, 1.6, 2.4); fires.push({ x: wx, y: wy, s: 0.3, ph: R() * TAU }); }
  // 火光自下而上映红山体与塔身
  x.globalCompositeOperation = 'source-atop';
  const lg = x.createLinearGradient(PAD + W * 0.5, 0, lw, 0); lg.addColorStop(0, 'rgba(255,80,30,0)'); lg.addColorStop(1, 'rgba(255,80,30,0.22)');
  x.fillStyle = lg; x.fillRect(0, 0, lw, hz + 4);
  const cg = x.createLinearGradient(0, 0, PAD + W * 0.45, 0); cg.addColorStop(0, 'rgba(120,160,255,0.12)'); cg.addColorStop(1, 'rgba(120,160,255,0)');
  x.fillStyle = cg; x.fillRect(0, 0, lw, hz + 4);
  x.globalCompositeOperation = 'source-over';
  return fires;
}

// ---------- 中景：左松林 / 右怪石枯树与火盆 ----------
export function drawNearLayer(x, lw, hz, H, W, PAD, R) {
  const fires = [];
  for (let px = -10; px < PAD + W * 0.42; px += 5 + R() * 7) { // 松林
    const h = H * (0.035 + R() * 0.05), w = h * 0.38, by = hz + 3;
    x.fillStyle = R() < 0.5 ? '#0d1716' : '#0a1312';
    x.beginPath();
    for (let k = 0; k < 3; k++) { const y0 = by - h * (k * 0.28), y1 = by - h * (0.42 + k * 0.29), ww = w * (1 - k * 0.25); x.moveTo(px - ww, y0); x.lineTo(px, y1); x.lineTo(px + ww, y0); }
    x.fill();
  }
  for (let px = PAD + W * 0.58; px < lw + 10; px += 14 + R() * 26) { // 怪石尖峰
    const h = H * (0.02 + R() * 0.07), w = 6 + R() * 10, by = hz + 3;
    x.fillStyle = '#0c0708'; x.beginPath(); x.moveTo(px - w, by); x.lineTo(px - w * 0.3, by - h * 0.7); x.lineTo(px + (R() - 0.5) * 4, by - h); x.lineTo(px + w * 0.4, by - h * 0.55); x.lineTo(px + w, by); x.closePath(); x.fill();
    if (R() < 0.35) { // 枯树
      x.strokeStyle = '#0c0708'; x.lineWidth = 1.4; const tx = px + w + 6, th = H * 0.05; x.beginPath(); x.moveTo(tx, by); x.lineTo(tx + 1, by - th);
      for (let b = 0; b < 3; b++) { const yy = by - th * (0.45 + b * 0.18); x.moveTo(tx, yy); x.lineTo(tx + (b % 2 ? 7 : -7), yy - 6); } x.stroke();
    }
    if (R() < 0.18) { const fx2 = px, fy = by - h - 2; x.fillStyle = '#2a1410'; x.fillRect(fx2 - 2, fy, 4, 3); fires.push({ x: fx2, y: fy - 1, s: 0.6, ph: R() * TAU }); }
  }
  x.globalCompositeOperation = 'source-atop';
  const lg = x.createLinearGradient(0, hz - H * 0.1, 0, hz); lg.addColorStop(0, 'rgba(255,100,40,0)'); lg.addColorStop(1, 'rgba(255,90,40,0.12)');
  x.fillStyle = lg; x.fillRect(PAD + W * 0.55, 0, lw, hz + 4);
  x.globalCompositeOperation = 'source-over';
  return fires;
}

// ---------- 前景：左木栅栏 / 右黑铁尖刺与碎石 ----------
export function drawForeground(x, lw, fh, W, PAD, k, R) {
  const by = fh + 2;
  const stake = (px, h, lean, col, hi) => {
    x.save(); x.translate(px, by); x.rotate(lean); x.fillStyle = col; x.beginPath(); x.moveTo(-3 * k, 0); x.lineTo(-3 * k, -h + 5 * k); x.lineTo(0, -h); x.lineTo(3 * k, -h + 5 * k); x.lineTo(3 * k, 0); x.closePath(); x.fill();
    x.fillStyle = hi; x.fillRect(-3 * k, -h + 5 * k, 1.2 * k, h - 5 * k); x.restore();
  };
  for (let px = PAD - 20; px < PAD + W * 0.26; px += 7 * k) stake(px, fh * (0.55 + R() * 0.35), 0.35 + (R() - 0.5) * 0.15, '#3b2a1a', 'rgba(255,220,170,0.18)');
  x.strokeStyle = '#2a1d12'; x.lineWidth = 3 * k; x.beginPath(); x.moveTo(PAD - 20, by - fh * 0.3); x.lineTo(PAD + W * 0.26, by - fh * 0.32); x.stroke();
  for (let px = PAD + W * 0.74; px < PAD + W + 20; px += 9 * k) stake(px, fh * (0.5 + R() * 0.45), -0.3 + (R() - 0.5) * 0.25, '#171113', 'rgba(255,80,40,0.2)');
  for (let i = 0; i < 10; i++) { // 碎石
    const px = PAD + W * (0.28 + R() * 0.44), r = (3 + R() * 6) * k; x.fillStyle = R() < 0.5 ? '#151214' : '#1d1918';
    x.beginPath(); x.ellipse(px, by - r * 0.3, r, r * 0.55, 0, 0, TAU); x.fill();
  }
}

// ---------- 两军大本营：人族城门塔楼 / 兽族黑铁箭塔（都面朝右绘制，红方翻转） ----------
export function towerTex(side, bw, bh, R, SR) {
  const pad = 16, w = bw + pad * 2, h = bh + pad;
  const c = mk(w * SR, h * SR), x = c.getContext('2d'); x.scale(SR, SR);
  const by = h - 2, top = by - bh, x0 = pad, x1 = pad + bw, torches = [];
  if (side === 'blue') {
    const g = x.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, '#3e4559'); g.addColorStop(0.65, '#6b7389'); g.addColorStop(1, '#474e62');
    x.fillStyle = g; x.fillRect(x0, top + 6, bw, bh - 6);
    for (let px = x0; px < x1; px += bw / 5) x.fillRect(px, top, bw / 8, 7);               // 城垛
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 0.6;                                     // 石块缝
    for (let y = top + 10; y < by; y += 5) { x.beginPath(); x.moveTo(x0, y); x.lineTo(x1, y); x.stroke(); for (let px = x0 + ((y / 5) % 2) * 4; px < x1; px += 8) { x.beginPath(); x.moveTo(px, y); x.lineTo(px, y + 5); x.stroke(); } }
    x.fillStyle = '#0d0f16'; x.beginPath(); x.moveTo(x0 + bw * 0.3, by); x.lineTo(x0 + bw * 0.3, by - bh * 0.32); x.arc(x0 + bw * 0.5, by - bh * 0.32, bw * 0.2, Math.PI, 0); x.lineTo(x0 + bw * 0.7, by); x.closePath(); x.fill(); // 拱门
    x.fillStyle = '#1e3fae'; x.fillRect(x0 + bw * 0.36, top + 9, bw * 0.28, bh * 0.36);       // 蓝色垂旗
    x.fillStyle = '#e2b13c'; x.fillRect(x0 + bw * 0.36, top + 9, bw * 0.28, 2); x.beginPath(); x.moveTo(x0 + bw * 0.36, top + 9 + bh * 0.36); x.lineTo(x0 + bw * 0.5, top + 14 + bh * 0.36); x.lineTo(x0 + bw * 0.64, top + 9 + bh * 0.36); x.closePath(); x.fill();
    x.beginPath(); x.arc(x0 + bw * 0.5, top + 9 + bh * 0.17, bw * 0.07, 0, TAU); x.fill();     // 金色徽记
    torches.push([x0 + bw * 0.18, by - bh * 0.42], [x0 + bw * 0.82, by - bh * 0.42]);
  } else {
    const g = x.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, '#120b0c'); g.addColorStop(0.65, '#2a1a1b'); g.addColorStop(1, '#160d0e');
    x.fillStyle = g; x.beginPath(); x.moveTo(x0 - 4, by); x.lineTo(x0 + bw * 0.12, top + 8); x.lineTo(x1 - bw * 0.12, top + 8); x.lineTo(x1 + 4, by); x.closePath(); x.fill();
    x.fillStyle = '#0c0708';
    for (let i = 0; i < 5; i++) { const sx = x0 + bw * (0.1 + i * 0.2); x.beginPath(); x.moveTo(sx - 3, top + 9); x.lineTo(sx, top - 6 - R() * 6); x.lineTo(sx + 3, top + 9); x.closePath(); x.fill(); } // 顶部尖刺
    for (const s of [0, 1]) for (let i = 0; i < 3; i++) { const yy = top + 18 + i * bh * 0.25, sx = s ? x1 + 1 - i * 1.5 : x0 - 1 + i * 1.5; x.beginPath(); x.moveTo(sx, yy); x.lineTo(sx + (s ? 9 : -9), yy - 3); x.lineTo(sx, yy + 3); x.closePath(); x.fill(); } // 侧刺
    x.fillStyle = '#8c1410'; x.fillRect(x0 + bw * 0.38, top + 12, bw * 0.24, bh * 0.42);     // 红色垂旗
    x.fillStyle = '#050304'; x.beginPath(); x.moveTo(x0 + bw * 0.5, top + 16); x.lineTo(x0 + bw * 0.58, top + 12 + bh * 0.21); x.lineTo(x0 + bw * 0.5, top + 12 + bh * 0.36); x.lineTo(x0 + bw * 0.42, top + 12 + bh * 0.21); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,70,40,0.4)'; x.lineWidth = 1; x.beginPath(); x.moveTo(x1 + 4, by); x.lineTo(x1 - bw * 0.12, top + 8); x.stroke();
    x.fillStyle = '#1a1010'; x.fillRect(x0 + bw * 0.4, top - 2, bw * 0.2, 6);               // 顶部火盆
    torches.push([x0 + bw * 0.5, top - 3], [x0 + bw * 0.2, by - bh * 0.35]);
  }
  return { c, w, h, ax: x0 + bw * 0.5, ay: by, torches: torches.map(([tx, ty]) => [tx - (x0 + bw * 0.5), ty - by]) };
}
