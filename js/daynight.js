// 昼夜循环：按浏览器本地时间决定白天黑夜，太阳、月亮沿弧线从左（人族一侧）升起、向右（兽族一侧）落下。
// 日出日落按日期估算（北纬约 35°：冬天昼短、夏天昼长）；月相按真实日期计算。
// 调试/预览：?time=18:30 固定在某个时刻；?speed=600 时间加速（600 倍 ≈ 2.4 分钟走完一天）。
const q = new URLSearchParams(location.search);
const FIX = (q.get('time') || '').match(/^(\d{1,2}):(\d{2})$/);
const SPEED = Math.max(0, Number(q.get('speed')) || 0);
const T0 = Date.now();
const LAT = (35 * Math.PI) / 180;
const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

function minutesOfDay(now) {
  const d = new Date(now);
  let m = FIX ? +FIX[1] * 60 + +FIX[2] : d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
  if (SPEED) m += ((now - T0) / 60000) * SPEED;
  return ((m % 1440) + 1440) % 1440;
}

// 日出、日落（当天 0 点起的分钟数）
export function sunTimes(now = Date.now()) {
  const d = new Date(now), doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  const dec = ((-23.44 * Math.PI) / 180) * Math.cos((2 * Math.PI * (doy + 10)) / 365);
  const h0 = (Math.acos(Math.max(-1, Math.min(1, -Math.tan(LAT) * Math.tan(dec)))) * 180) / Math.PI;
  return { rise: 720 - h0 * 4, set: 720 + h0 * 4 };
}

// 当前天色：p 太阳进度（0 日出 → 1 日落），mq 月亮进度（0 日落 → 1 日出），
// alt 太阳高度（-1..1），D 白天程度（0 夜 → 1 昼），warm 晨昏暖光强度
export function skyState(now = Date.now()) {
  const m = minutesOfDay(now), { rise, set } = sunTimes(now);
  const dayLen = set - rise, nightLen = 1440 - dayLen;
  const p = (m - rise) / dayLen;
  let mq = ((((m - set) % 1440) + 1440) % 1440) / nightLen;
  if (mq > (1440 / nightLen + 1) / 2) mq -= 1440 / nightLen; // 日落前月亮还在地平线下（负进度）
  const alt = p >= 0 && p <= 1 ? Math.sin(Math.PI * p) : -Math.sin(Math.PI * Math.min(1, Math.max(0, mq)));
  return { m, rise, set, p, mq, alt, D: smooth(-0.13, 0.1, alt), warm: Math.exp(-(((alt - 0.03) / 0.15) ** 2)) };
}

// 月相：0 新月 → 0.5 满月 → 1 新月
export function moonPhase(now = Date.now()) {
  const syn = 29.530588853, age = ((now - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) % syn;
  return ((age + syn) % syn) / syn;
}

function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// 按月相给月亮贴图加上阴影（北半球：上弦亮右边，下弦亮左边）；暗面保留一点地照
export function moonCanvas(img, fr, phase) {
  const c = mk(fr.w, fr.h), x = c.getContext('2d');
  x.drawImage(img, fr.x, fr.y, fr.w, fr.h, 0, 0, fr.w, fr.h);
  const d = x.getImageData(0, 0, fr.w, fr.h), a = d.data, r = fr.r, cx = fr.w / 2, cy = fr.h / 2;
  const cs = Math.cos(2 * Math.PI * phase), waxing = phase < 0.5;
  for (let j = 0; j < fr.h; j++) for (let i = 0; i < fr.w; i++) {
    const u = (i + 0.5 - cx) / r, v = (j + 0.5 - cy) / r, w = Math.sqrt(Math.max(0, 1 - v * v));
    const edge = waxing ? (u - w * cs) / 0.08 : (-w * cs - u) / 0.08; // >0 为亮面
    const lit = Math.min(1, Math.max(0, 0.5 + edge)), k = 0.13 + 0.87 * lit, o = (j * fr.w + i) * 4;
    a[o] *= k; a[o + 1] *= k * 1.02; a[o + 2] *= Math.min(1.2, k * 1.12); a[o + 3] *= 0.82 + 0.18 * lit;
  }
  x.putImageData(d, 0, 0); return c;
}
export const moonLit = (phase) => (1 - Math.cos(2 * Math.PI * phase)) / 2; // 被照亮的比例

// 太阳：亮核 + 柔和光晕
export function sunTex() {
  const s = 128, c = mk(s, s), x = c.getContext('2d'), g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.22, 'rgba(255,252,235,1)'); g.addColorStop(0.27, 'rgba(255,240,200,0.65)');
  g.addColorStop(0.45, 'rgba(255,220,160,0.18)'); g.addColorStop(1, 'rgba(255,200,120,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s); return c;
}
// 光芒（丁达尔光束）：一圈粗细不一、由内向外变淡的楔形
export function raysTex(seed = 7) {
  const s = 512, c = mk(s, s), x = c.getContext('2d'); let a = seed;
  const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  x.translate(s / 2, s / 2); x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 22; i++) {
    const ang = (i / 22) * Math.PI * 2 + rnd() * 0.25, wd = 0.02 + rnd() * 0.05, len = s * (0.3 + rnd() * 0.2);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, len); g.addColorStop(0, `rgba(255,255,255,${0.35 + rnd() * 0.4})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, len, ang - wd, ang + wd); x.closePath(); x.fill();
  }
  return c;
}
// 竖向渐变：上透明、下不透明（晨昏的地平线霞光）
export function duskTex() {
  const c = mk(2, 128), x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,1)');
  x.fillStyle = g; x.fillRect(0, 0, 2, 128); return c;
}
