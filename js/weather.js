// 行情驱动的天气（WebGL 版，只在手绘背景图模式下绘制）：
//   暴风雨 ← 波动率飙升（乌云、雨、闪电）；火山喷发 ← 急跌（熔岩喷泉、火山灰柱、天空发红、灰烬飘落）；
//   血月 / 赤日 ← 跌得更深；圣光 ← 急涨（云开一线、光柱照在人族城堡上、窗户发金光）；
//   薄雾 ← 成交清淡；整体色调 ← 24 小时涨跌（涨偏暖金、跌偏暗红）。
// 目标值由 app.js 按行情算好传进来（battle.setWeather），这里负责平滑过渡和绘制。
// 预览：?wx=storm | rain | erupt | blood | glory | fog | up | down，可用逗号组合，如 ?wx=storm,down
import { clamp, lerp, rand } from './battle.js?v=cf5b9bb6';

const mix = (a, b, k) => {
  const r = lerp(a >> 16, b >> 16, k), g = lerp((a >> 8) & 255, (b >> 8) & 255, k), bl = lerp(a & 255, b & 255, k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};
const mul = (a, b) => ((((a >> 16) * (b >> 16)) / 255) << 16) | (((((a >> 8) & 255) * ((b >> 8) & 255)) / 255) << 8) | (((a & 255) * (b & 255)) / 255);

const WXP = new URLSearchParams(location.search).get('wx');
const PRESET = { storm: { storm: 1 }, rain: { storm: 0.5 }, erupt: { erupt: 1 }, blood: { erupt: 1, blood: 1 }, glory: { glory: 1 }, fog: { fog: 1 }, up: { tone: 1 }, down: { tone: -1 }, clear: {} };
export const WX_FIX = WXP ? WXP.split(',').reduce((o, k) => Object.assign(o, PRESET[k.trim()] || {}), {}) : null;
const KEYS = ['storm', 'erupt', 'blood', 'glory', 'fog'];
const HOLD = { storm: 10, erupt: 18, blood: 18, glory: 15, fog: 0 }; // 触发后至少持续几秒，避免一闪而过
// 各画质档位的粒子数量
const WQ = { 2: { rain: 240, ash: 90, lava: 1, splash: 1, rays: 1, mist: 1 }, 1: { rain: 140, ash: 55, lava: 0.7, splash: 1, rays: 1, mist: 1 }, 0: { rain: 60, ash: 28, lava: 0.4, splash: 0, rays: 0, mist: 0 } };

// 光柱贴图：左右柔边，自上而下略微变淡，底端渐隐
export function beamTex() {
  const w = 64, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), d = x.createImageData(w, h), a = d.data;
  for (let j = 0; j < h; j++) {
    const v = j / h, vy = Math.min(1, v / 0.12) * (1 - 0.35 * v) * (1 - Math.max(0, (v - 0.82) / 0.18));
    for (let i = 0; i < w; i++) { const u = (i + 0.5 - w / 2) / (w * 0.22), o = (j * w + i) * 4; a[o] = a[o + 1] = a[o + 2] = 255; a[o + 3] = 255 * vy * Math.exp(-u * u); }
  }
  x.putImageData(d, 0, 0); return c;
}

// 平滑过渡：来得快（约 2.5 秒）、去得慢（约 9 秒），触发后还会保持一段时间
export function wxStep(b, dt) {
  const v = b.wxv || (b.wxv = { storm: 0, erupt: 0, blood: 0, glory: 0, fog: 0, tone: 0 }), h = b.wxHold || (b.wxHold = {});
  const T = WX_FIX || b.wxT || {}, t = b.rt || 0, up = 1 - Math.exp(-dt / 2.5), dn = 1 - Math.exp(-dt / 9);
  const pe = v.erupt, pg = v.glory;
  for (const k of KEYS) {
    let tg = clamp(T[k] || 0, 0, 1); if (k === 'fog') tg *= 1 - v.storm;
    if (tg >= 0.5) h[k] = t + HOLD[k];
    if (tg >= v[k]) v[k] += (tg - v[k]) * up; else if (t > (h[k] || 0)) v[k] += (tg - v[k]) * dn;
  }
  v.tone += (clamp(T.tone || 0, -1, 1) - v.tone) * (1 - Math.exp(-dt / 6));
  if (pe < 0.25 && v.erupt >= 0.25) { b.shake = Math.max(b.shake, 7); b.onWeather && b.onWeather('erupt'); }
  if (pg < 0.25 && v.glory >= 0.25) b.onWeather && b.onWeather('bell');
  return v;
}

// 场景整体色调（乘到背景各层、环境光上）
export function wxMul(v) {
  let m = 0xffffff;
  if (v.storm > 0.01) m = mul(m, mix(0xffffff, 0x6f7a8e, 0.65 * v.storm));
  if (v.erupt > 0.01) m = mul(m, mix(0xffffff, 0xe09880, 0.45 * v.erupt));
  if (v.blood > 0.01) m = mul(m, mix(0xffffff, 0xc86a64, 0.4 * v.blood));
  if (v.glory > 0.01) m = mul(m, mix(0xffffff, 0xfff0d0, 0.5 * v.glory));
  if (v.fog > 0.01) m = mul(m, mix(0xffffff, 0xdfe3ea, 0.4 * v.fog));
  if (v.tone > 0.01) m = mul(m, mix(0xffffff, 0xfff1dc, 0.35 * v.tone));
  else if (v.tone < -0.01) m = mul(m, mix(0xffffff, 0xeccfcc, -0.45 * v.tone));
  return m;
}

// 每帧绘制天气（在 _drawBgImg 里调用：toScr 把原图坐标换成屏幕坐标，ss 为原图缩放，D 为白天程度）
export function drawWeather(b, dt, toScr, ss, D) {
  const v = b.wxv; if (!v) return;
  const { W, H, pl, tx, P } = b, hz = b.horizon, t = b.rt || 0, us = b.us || 1, Q = WQ[b.q] || WQ[1], WHITE = P.Texture.WHITE, sk = ss / 0.44;
  const rect = (col, a, y0 = -10, y1 = hz + 4) => { if (a < 0.01) return; const s = pl.wxSky.get(WHITE); s.anchor.set(0); s.position.set(-10, y0); s.width = W + 20; s.height = y1 - y0; s.tint = col; s.alpha = a; };

  // ---- 暴风雨 ----
  const st = v.storm;
  rect(mix(0x4a5468, 0x1c2230, 1 - D), 0.5 * st);
  if (st > 0.01) {
    const C = b.wxClouds || (b.wxClouds = Array.from({ length: 16 }, () => ({ x: rand(-0.2, 1.2), y: rand(-0.05, 0.5), w: rand(0.25, 0.5), h: rand(0.2, 0.35), v: rand(0.006, 0.014), a: rand(0.6, 1) })));
    const cc = mix(0x6a7284, 0x262c3a, 1 - D);
    for (const c of C) {
      c.x += c.v * dt; if (c.x - c.w / 2 > 1.15) c.x = -0.15 - c.w / 2;
      const s = pl.wxSky.get(tx.cloud); s.anchor.set(0.5); s.position.set(c.x * W, c.y * hz); s.width = c.w * W * 1.3; s.height = c.h * hz * 1.4; s.tint = cc; s.alpha = st * c.a * 0.9;
    }
    if (st > 0.2 && Math.random() < dt * 0.35 * st) { // 闪电 + 稍后的雷声
      b._bolt('storm'); b.flash = Math.max(b.flash, 0.28 * st); b.flashCol = '210,225,255';
      b.onWeather && b.onWeather('thunder', rand(0.15, 1.2));
    }
  }
  // 雨：斜着落下的雨丝；地面溅起小水花
  const R = b.rain || (b.rain = []), nR = Math.round(Q.rain * st);
  const drop = (init) => ({ x: rand(-0.25 * H, W), y: init ? rand(-20, H) : rand(-60, -10), v: rand(650, 950), len: rand(16, 30), a: rand(0.4, 0.7) });
  while (R.length < nR) R.push(drop(true));
  if (R.length > nR) R.length = nR;
  const rc = D > 0.5 ? 0xe4ecf8 : 0xb4c4dc, rot = Math.atan2(1, 0.22);
  for (const d of R) {
    d.y += d.v * dt; d.x += d.v * 0.22 * dt; if (d.y > H + 10) Object.assign(d, drop(false));
    const s = pl.rain.get(tx.line); s.anchor.set(1, 0.5); s.position.set(d.x, d.y); s.rotation = rot; s.width = d.len * us; s.height = 1.8; s.tint = rc; s.alpha = d.a * Math.min(1, st * 1.5);
  }
  const SP = b.splash || (b.splash = []);
  if (Q.splash && st > 0.05) { const n = dt * 50 * st; for (let i = 0; i < n || Math.random() < n - i; i++) { SP.push({ x: rand(0, W), y: rand(b.laneTop - 10, H), life: 0.3 }); if (i > 6) break; } }
  for (const p of SP) { p.life -= dt; const k = Math.max(0, p.life / 0.3), s = pl.splash.get(); s.anchor.set(0.5); s.position.set(p.x, p.y); s.width = 9 * us * (1.6 - k); s.height = 3 * us * (1.6 - k); s.alpha = k * 0.45; s.tint = 0xd0dcf0; }
  b.splash = SP.filter((p) => p.life > 0);

  // ---- 火山喷发 / 血月 ----
  const er = v.erupt, bl = v.blood, C = b._crater;
  rect(0x7a1a0c, (0.3 + 0.12 * D) * er); rect(0x4a0606, 0.3 * bl); // 白天天空亮，红幕加深一点
  const mo = b.bgs && b.bgs.moon;
  if (bl > 0.01 && mo && mo.visible) { // 血月：盖在红色天幕之上，发出暗红的光
    const h = pl.wxSkyAdd.get(tx.white); h.anchor.set(0.5); h.position.set(mo.x, mo.y); h.width = h.height = mo.width * 7; h.tint = 0xff2a10; h.alpha = 0.55 * bl * mo.alpha;
    const m = pl.wxSkyAdd.get(mo.texture); m.anchor.set(0.5); m.position.set(mo.x, mo.y); m.width = m.height = mo.width; m.tint = 0xff6040; m.alpha = 0.95 * bl * mo.alpha;
  }
  if (er > 0.01 && C) {
    const ck = C.s / 0.44;
    const g = pl.wxSkyAdd.get(tx.fire); g.anchor.set(0.5); g.position.set(C.x, C.y - 30 * ck); g.width = W * 0.7; g.height = hz * 1.3; g.tint = 0xff4a14; g.alpha = 0.5 * er * (0.85 + 0.15 * Math.sin(t * 3));
    const cg = pl.fires.get(tx.fire); cg.anchor.set(0.5); cg.position.set(C.x, C.y); cg.width = cg.height = 170 * ck * (0.9 + 0.1 * Math.sin(t * 11)); cg.tint = 0xff7a2a; cg.alpha = er;
    const cg2 = pl.fires.get(tx.fire); cg2.anchor.set(0.5); cg2.position.set(C.x, C.y + 4 * ck); cg2.width = 70 * ck; cg2.height = 40 * ck; cg2.tint = 0xffe08a; cg2.alpha = er * (0.8 + 0.2 * Math.sin(t * 17));
    // 熔岩喷泉
    const LV = b.lava || (b.lava = []), nL = dt * 70 * Q.lava * er;
    for (let i = 0; i < nL || Math.random() < nL - i; i++) { LV.push({ x: C.x + rand(-4, 4) * ck, y: C.y, vx: rand(-60, 45) * ck, vy: -rand(80, 165) * ck, life: rand(1.2, 2.2), max: 2.2, s: rand(6, 14) * ck }); if (i > 8) break; }
    // 火山灰柱：往战场一侧（左边）飘
    const AS = b.ashCol || (b.ashCol = []);
    if (AS.length < 70 && Math.random() < dt * 8 * er) AS.push({ x: C.x + rand(-5, 5) * ck, y: C.y - 6 * ck, vx: -rand(22, 45) * ck, vy: -rand(8, 18) * ck, size: rand(16, 26) * ck, life: rand(10, 16), max: 16 });
  }
  if (b.lava) {
    for (const p of b.lava) { p.life -= dt; p.vy += 230 * (C ? C.s / 0.44 : 1) * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (C && p.vy > 0 && p.y > C.y + 70 * C.s / 0.44) p.life = 0; }
    b.lava = b.lava.filter((p) => p.life > 0);
    for (const p of b.lava) { const k = p.life / p.max, s = pl.fires.get(tx.fire); s.anchor.set(0.5); s.position.set(p.x, p.y); s.width = s.height = p.s * 2.6 * (0.6 + 0.4 * k); s.tint = mix(0xffd070, 0xff3a10, 1 - k); s.alpha = Math.min(1, k * 2); }
  }
  if (b.ashCol) {
    const ac = mix(0x2b2224, 0x4a3632, D);
    for (const p of b.ashCol) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy *= 1 - 0.3 * dt; p.vx -= 2 * dt; if (p.y < 8) p.vy = Math.abs(p.vy) * 0.3; p.size += dt * 11 * (C ? C.s / 0.44 : 1); }
    b.ashCol = b.ashCol.filter((p) => p.life > 0);
    for (const p of b.ashCol) {
      const k = p.life / p.max, s = pl.plumes.get(tx.smoke); s.anchor.set(0.5); s.position.set(p.x, p.y); s.width = s.height = p.size * 2;
      s.alpha = Math.min(1, k * 1.5) * Math.min(1, (1 - k) * 5) * 0.85; s.tint = ac; s.rotation = 0;
      const age = p.max - p.life; if (age < 2) { const gl = pl.fires.get(tx.fire); gl.anchor.set(0.5); gl.position.set(p.x, p.y + p.size * 0.3); gl.width = gl.height = p.size * 1.6; gl.tint = 0xff5020; gl.alpha = (1 - age / 2) * 0.35; }
    }
  }
  // 灰烬飘落
  const AF = b.ashFall || (b.ashFall = []), nA = Math.round(Q.ash * er);
  while (AF.length < nA) AF.push({ x: rand(0, W), y: rand(-10, H), vy: rand(16, 38), ph: rand(0, 6.3), s: rand(1.2, 2.8), ember: Math.random() < 0.18 });
  if (AF.length > nA) AF.length = nA;
  for (const p of AF) {
    p.y += p.vy * dt; p.x += (Math.sin(t * 0.8 + p.ph) * 12 - 8) * dt; if (p.y > H + 5) { p.y = -5; p.x = rand(0, W + 40); }
    const s = pl.rain.get(WHITE); s.anchor.set(0.5); s.position.set(p.x, p.y); s.width = s.height = p.s * us; s.rotation = p.ph + t; s.tint = p.ember ? 0xff8a40 : 0x8d8480; s.alpha = (p.ember ? 0.9 : 0.65) * Math.min(1, er * 2);
  }

  // ---- 圣光 ----
  const gl = v.glory;
  if (gl > 0.01) {
    const [kx] = toScr(445, 150), [, by] = toScr(445, 395);
    const so = pl.wxSkyAdd.get(tx.white); so.anchor.set(0.5); so.position.set(kx, -hz * 0.05); so.width = W * 0.55; so.height = hz * 0.9; so.tint = 0xfff0c0; so.alpha = 0.45 * gl;
    if (Q.rays) { const r = pl.wxSkyAdd.get(tx.rays); r.anchor.set(0.5); r.position.set(kx, -hz * 0.15); r.width = r.height = hz * 2.6; r.rotation = t * 0.02; r.tint = 0xffe6a8; r.alpha = 0.22 * gl; }
    for (const [bw, col, a] of [[260, 0xffd27a, 0.5], [110, 0xfff6dc, 0.55]]) {
      const s = pl.wxBeam.get(); s.anchor.set(0.5, 1); s.position.set(kx, by); s.width = bw * ss * (1 + 0.03 * Math.sin(t * 1.3)); s.height = by + 10; s.tint = col; s.alpha = a * gl * (0.9 + 0.1 * Math.sin(t * 2.1));
    }
    const MO = b.motes || (b.motes = []);
    if (MO.length < 40 && Math.random() < dt * 14 * gl) MO.push({ x: kx + rand(-120, 120) * ss, y: by - rand(0, 220) * ss, vy: -rand(10, 25), ph: rand(0, 6.3), life: rand(2, 4), max: 4 });
  }
  if (b.motes) {
    for (const p of b.motes) { p.life -= dt; p.y += p.vy * dt; p.x += Math.sin(t * 1.5 + p.ph) * 6 * dt; }
    b.motes = b.motes.filter((p) => p.life > 0);
    for (const p of b.motes) { const k = p.life / p.max, s = pl.wxBeam.get(tx.white); s.anchor.set(0.5); s.position.set(p.x, p.y); s.width = s.height = (4 + 3 * Math.sin(t * 4 + p.ph)) * sk; s.tint = 0xffe08a; s.alpha = Math.min(1, k * 2) * Math.min(1, (1 - k) * 4) * Math.max(gl, 0.3); }
  }

  // ---- 薄雾 ----
  const fg = v.fog;
  if (fg > 0.01) {
    const fc = mix(0xdfe3ea, 0x56607a, 1 - D);
    rect(fc, 0.3 * fg);
    const hzz = pl.plumes.get(tx.dusk); hzz.anchor.set(0); hzz.rotation = 0; hzz.position.set(-10, hz * 0.2); hzz.width = W + 20; hzz.height = hz * 0.86; hzz.tint = fc; hzz.alpha = 0.8 * fg; // 远景笼罩在雾里
    const FB = b.fogB || (b.fogB = Array.from({ length: 10 }, () => ({ x: rand(0, 1), y: rand(-0.04, 0.2), w: rand(0.5, 0.8), h: rand(0.12, 0.2), v: rand(-0.005, 0.005), a: rand(0.5, 1) })));
    for (const f of FB) { f.x += f.v * dt; if (f.x > 1.3) f.x = -0.3; if (f.x < -0.3) f.x = 1.3; const s = pl.fog.get(tx.white); s.anchor.set(0.5); s.position.set(f.x * W, hz + f.y * (H - hz)); s.width = f.w * W; s.height = f.h * H; s.tint = fc; s.alpha = 0.55 * fg * f.a; }
    if (Q.mist) {
      const MB = b.mistB || (b.mistB = Array.from({ length: 4 }, () => ({ x: rand(0, 1), y: rand(0.35, 0.95), w: rand(0.5, 0.8), h: rand(0.12, 0.2), v: rand(-0.008, 0.008) })));
      for (const f of MB) { f.x += f.v * dt; if (f.x > 1.4) f.x = -0.4; if (f.x < -0.4) f.x = 1.4; const s = pl.mist.get(tx.white); s.anchor.set(0.5); s.position.set(f.x * W, hz + f.y * (H - hz)); s.width = f.w * W; s.height = f.h * H; s.tint = fc; s.alpha = 0.22 * fg; }
    }
  }
}
