import { FeedManager, SOURCES, fetchMiniTickers, fetchBinance1s, fetchBinanceAggTrades } from './feeds.js?v=d07538c8';
import { PRESET, universe, loadUniverse, loadTickers, fetchQuoteVolume, thresholdsFor, search as searchCoins, topByVolume, recents, pushRecent, favorites, toggleFav, primarySource } from './markets.js?v=d07538c8';
import { GLBattle } from './battle-gl.js?v=d07538c8';
import { t as T, lang, setLang, onLang, applyI18n, fmtUsd, fmtShort, fmtNum } from './i18n.js?v=d07538c8';
import { AudioController } from './music.js?v=d07538c8';
import { initChat } from './chat.js?v=d07538c8';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

// ---------- 币种配置 ----------
// M = 当前市场（交易所代码、价格/数量精度）；CF = 当前币的大单/炮弹门槛（BTC、ETH 固定，其它币按 24h 成交额缩放，见 markets.js）
const params = new URLSearchParams(location.search);
const wantCoin = (params.get('coin') || localStorage.getItem('cw_coin') || 'btc').toLowerCase().trim();
let coin = 'btc', M = PRESET.btc, CF = { dp: 2, qdp: 3, ...thresholdsFor('btc') };
const cfg = () => CF;
const fmtPx = (p, dp) => p.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtP = (p) => fmtPx(p, CF.dp);
const fmtQ = (q) => q >= 1e5 ? fmtNum(q) : q >= 1000 ? q.toFixed(0) : q >= 100 ? q.toFixed(1) : q >= 10 ? q.toFixed(Math.min(2, CF.qdp)) : q.toFixed(CF.qdp);
const wan = (v) => fmtShort(v);
applyI18n();
// 网页字体：先以 media=print 异步下载，加载完再启用（替代 HTML 内联 onload，便于 CSP 禁止内联脚本）
{ const gf = document.getElementById('gfonts'); if (gf) { if (gf.sheet) gf.media = 'all'; else gf.addEventListener('load', () => { gf.media = 'all'; }, { once: true }); } }

// ---------- 开场 ----------
const intro = $('intro'), introBar = $('introBar'), introMsg = $('introMsg');
const introStart = performance.now(); let introDone = false;
intro.classList.add('js'); // JS 已接管：取消 CSS 兜底自动隐藏，改为“点击进入战场”
let introKey = ['introGather'];
function introStep(pct, key, ...a) { if (introDone) return; introBar.style.width = pct + '%'; if (key) { introKey = [key, ...a]; introMsg.textContent = T(key, ...a); } }
function finishIntro() {
  if (introDone) return;
  const wait = Math.max(0, 1900 - (performance.now() - introStart));
  introStep(100, 'introStart');
  introDone = true;
  setTimeout(() => {
    // 浏览器已允许播放 / 用户关了声音 → 直接进入；否则显示“点击进入战场”按钮（点击即解锁音频）
    if (!audio.locked) return closeIntro();
    intro.classList.add('ready'); introKey = ['introClick']; introMsg.textContent = T('introClick');
  }, wait + 350);
}
function closeIntro() {
  if (!intro.isConnected || intro.classList.contains('done')) return;
  intro.classList.add('done'); setTimeout(() => intro.remove(), 900);
  if (pendingSearch != null) { const q = pendingSearch; pendingSearch = null; setTimeout(() => openSearch(q), 400); }
}
introStep(15, 'introGather');
setTimeout(finishIntro, 7000); // 最长等待

// ---------- 战场 ----------
const battle = new GLBattle($('battle')); // WebGL 现代战场；不支持时自动退回经典版（?fx=classic 强制经典版）
battle.start();
window.__battle = battle; // 调试用
window.__cw = () => S.dbg;
window.__big = () => ({ big: S.big, from: S.bigFrom, th: S.threshold });
window.__univ = universe; // 调试用

// ---------- 状态 ----------
const S = {
  src: null, last: 0, shownStr: '', open24h: 0, tradesThisSec: 0,
  buckets: new Array(300).fill(null).map(() => ({ sec: 0, b: 0, s: 0, bu: 0, su: 0, n: 0 })),
  px: new Array(120).fill(null).map(() => ({ sec: 0, p: 0 })), tickDir: 0,
  book: null, threshold: 0, surge: null, surgeSince: 0, wonFor: null,
  big: [], bigFrom: 0, bigLoading: false, lastAggId: 0,
  since: 0, liveSec: null, bfGen: 0, // since: 统计窗口最早的完整秒；liveSec: 本次连接首笔实时成交所在秒
};
function resetStats() {
  for (const b of S.buckets) { b.sec = 0; b.b = b.s = b.bu = b.su = b.n = 0; }
  for (const x of S.px) { x.sec = 0; x.p = 0; } S.tickDir = 0;
  S.book = null; S.last = 0; S.shownStr = ''; S.open24h = 0; S.hi = 0;
  S.surge = null; S.wonFor = null; smoothS = 0;
  S.since = 0; S.liveSec = null; S.bfGen++; S.nEma = 0;
  $('price').textContent = '--'; $('chg').textContent = '--'; $('chg').className = 'chg';
  ['hi', 'lo', 'vol'].forEach(id => $(id).textContent = '--');
  S.big = []; S.bigFrom = 0; S.bigLoading = false; S.lastAggId = 0; pend = null; clearTimeout(pendTimer);
  renderTrades();
}
function bucket(sec) {
  const b = S.buckets[sec % 300];
  if (b.sec !== sec) { b.sec = sec; b.b = b.s = b.bu = b.su = b.n = 0; }
  return b;
}
// N 秒涨跌幅（%）：用 N 秒前（或最早可用的）每秒收盘价
function priceChange(secs) {
  if (!S.last) return 0;
  const now = Math.floor(Date.now() / 1000);
  // 先找 N 秒前那一秒；那一秒没成交则往更早找（价格沿用上一笔），历史不足时才退到较近的秒
  for (let k = secs; k < Math.min(secs + 30, 120); k++) {
    const x = S.px[(now - k) % 120];
    if (x.sec === now - k && x.p) return (S.last / x.p - 1) * 100;
  }
  for (let k = secs - 1; k >= Math.min(5, secs); k--) {
    const x = S.px[(now - k) % 120];
    if (x.sec === now - k && x.p) return (S.last / x.p - 1) * 100;
  }
  return 0;
}
function windowSum(secs) {
  const now = Math.floor(Date.now() / 1000); let b = 0, s = 0, bu = 0, su = 0, n = 0;
  for (let i = 0; i < secs; i++) { const k = S.buckets[(now - i) % 300]; if (k.sec === now - i) { b += k.b; s += k.s; bu += k.bu; su += k.su; n += k.n; } }
  return { b, s, bu, su, n };
}

// ---------- 成交合并 ----------
let pend = null, pendTimer = null;
function flushPend() { if (!pend) return; const t = pend; pend = null; clearTimeout(pendTimer); onMergedTrade(t); }
function onTrade(t, src) {
  S.tradesThisSec++;
  const sec = Math.floor(Date.now() / 1000), bk = bucket(sec), usd = t.price * t.qty;
  if (!S.since) S.since = sec;
  if (S.liveSec == null) {
    S.liveSec = sec; if (!S.bigFrom) S.bigFrom = Date.now();
    if (src === 'binance') {
      setTimeout(backfill, 1500, S.bfGen, t.ts, Date.now() - t.ts, sec);
      if (t.id) { S.bigLoading = !S.big.length; backfillBig(S.bfGen, t.id, S.lastAggId); if (S.bigLoading) renderTrades(); }
    }
  }
  if (t.id) S.lastAggId = t.id;
  if (t.side === 'buy') { bk.b += t.qty; bk.bu += usd; } else { bk.s += t.qty; bk.su += usd; }
  bk.n++;
  if (S.last && t.price !== S.last) { S.tickDir = t.price > S.last ? 1 : -1; audio.tick(S.tickDir); } // 价格每跳一下 → 旋律走一步
  S.last = t.price;
  const ph = S.px[sec % 120]; ph.sec = sec; ph.p = t.price; // 每秒最后成交价
  // 一笔主动单吃掉多个价位时，交易所会拆成多条同一毫秒、同方向的成交 → 合并成一笔（价格取成交均价）
  if (pend && pend.side === t.side && pend.ts === t.ts) { pend.qty += t.qty; pend.usd += usd; pend.price = pend.usd / pend.qty; }
  else { flushPend(); pend = { ...t, usd }; pendTimer = setTimeout(flushPend, 80); }
}
function onMergedTrade(t) {
  battle.fire(t.side, t.usd, t.qty);
  if (t.usd >= cfg().chips[0]) {
    const r = { ts: t.ts || Date.now(), side: t.side, price: t.price, qty: t.qty, usd: t.usd };
    S.big.unshift(r); if (S.big.length > 500) S.big.length = 500;
    if (t.usd >= S.threshold) addTradeRow(r);
  }
  if (t.usd >= cfg().th.shell) audio.impact(t.usd * 50000 / cfg().th.shell, t.side === 'buy' ? 'blue' : 'red');
}
function tradeLi(t, anim = true) {
  const li = document.createElement('li'), d = new Date(t.ts), whale = t.usd >= cfg().th.whale;
  if (!anim) li.style.animation = 'none';
  li.className = (t.side === 'buy' ? 'buy' : 'sell') + (whale ? ' whale' : '');
  li.style.setProperty('--a', Math.min(0.08 + Math.log10(t.usd / S.threshold + 1) * 0.25, 0.45).toFixed(2));
  li.innerHTML = `<span>${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}</span>` +
    `<span class="s">${t.side === 'buy' ? T('sideBuy') : T('sideSell')}</span><span>${fmtP(t.price)}</span>` +
    `<span>${fmtQ(t.qty)}</span><span>${whale ? '🐋 ' : ''}${fmtUsd(t.usd)}</span>`;
  return li;
}
function addTradeRow(t) {
  const ul = $('trades');
  const empty = ul.querySelector('.empty'); if (empty) empty.remove();
  ul.prepend(tradeLi(t));
  while (ul.children.length > 60) ul.lastChild.remove();
  tradesNote();
}
const bigMins = () => Math.max(1, Math.round((Date.now() - S.bigFrom) / 60000));
function tradesNote() { $('tradesNote').textContent = S.bigFrom && !S.bigLoading ? T('bigSince', bigMins()) : ''; }
// 按当前门槛整表重绘（切换门槛 / 回填完成 / 切换语言时）
function renderTrades() {
  const ul = $('trades'), rows = S.big.filter(x => x.usd >= S.threshold).slice(0, 60);
  ul.innerHTML = '';
  if (!rows.length) {
    const msg = S.bigLoading ? T('loadingBig') : S.bigFrom ? T('noBig', bigMins(), fmtShort(S.threshold)) : T('waitBig');
    ul.innerHTML = `<li class="empty">${msg}</li>`;
  } else for (const r of rows) ul.appendChild(tradeLi(r, false));
  tradesNote();
}
// 开页时用 Binance 逐笔成交（aggTrades）回填最近约 30 分钟的大单，避免列表一打开是空的
async function backfillBig(gen, firstId, afterId) {
  const ms = 30 * 60000, since = Date.now() - ms;
  const raw = await fetchBinanceAggTrades(M, fm.binanceHost || 0, firstId, afterId ? 0 : since, afterId, 15, () => gen === S.bfGen);
  if (gen !== S.bfGen) return;
  S.bigLoading = false;
  if (!raw) { renderTrades(); return; }
  const out = []; let cur = null; // 同毫秒同方向合并
  for (const x of raw) {
    const side = x.m ? 'sell' : 'buy', usd = x.p * x.q;
    if (cur && cur.ts === x.T && cur.side === side) { cur.qty += x.q; cur.usd += usd; cur.price = cur.usd / cur.qty; }
    else { if (cur) out.push(cur); cur = { ts: x.T, side, price: x.p, qty: x.q, usd }; }
  }
  if (cur) out.push(cur);
  const min = cfg().chips[0], old = out.filter(x => x.usd >= min).reverse();
  S.big = S.big.concat(old).sort((a, b) => b.ts - a.ts).slice(0, 500);
  if (!afterId && raw.length) S.bigFrom = Math.min(S.bigFrom || Infinity, raw[0].T);
  renderTrades();
}

// 开页/重连时用 Binance 1 秒 K 线回填之前的成交（主动买卖量与每秒收盘价），
// 这样 10 秒 / 1 分钟 / 5 分钟 一打开就是完整窗口，而不是“从打开网页起累计”
async function backfill(gen, firstTs, skew, liveSec) {
  if (gen !== S.bfGen) return; // 1.5 秒内已切币 → 不再发请求
  const k = await fetchBinance1s(M, fm.binanceHost || 0, 300);
  if (!k || gen !== S.bfGen) return;
  const now = Math.floor(Date.now() / 1000);
  for (const x of k) {
    if (x.t + 1000 > firstTs) continue; // 只回填首笔实时成交之前的完整秒，避免重复计算
    const ls = Math.floor((x.t + skew) / 1000);
    if (ls >= liveSec || ls <= now - 300) continue;
    const b = S.buckets[ls % 300];
    if (b.sec !== ls) { b.sec = ls; b.b = x.tb; b.s = x.v - x.tb; b.bu = x.tbq; b.su = x.q - x.tbq; b.n = x.n; }
    if (ls > now - 120 && x.v > 0) { const ph = S.px[ls % 120]; if (ph.sec !== ls) { ph.sec = ls; ph.p = x.c; } }
    if (!S.since || ls < S.since) S.since = ls;
  }
}

// ---------- 数据源 ----------
const statusEl = $('status');
let lastStatus = null;
function statusText() {
  if (!lastStatus) return;
  const [state, label, src] = lastStatus;
  const lb = state === 'error' ? (T(label) || label) : label;
  const txt = state !== 'live' && navigator.onLine === false ? T('sOffline') // 断网时直接说明原因，而不是在几个交易所之间“重试/切换”
    : { connecting: T('sConnecting', lb), open: T('sOpen', lb), live: T('sLive', lb), error: T('sError', SOURCES[src].name, lb) }[state];
  $('statusText').textContent = txt; statusEl.title = txt;
}
const fm = new FeedManager({
  onStatus(state, label, src) {
    statusEl.className = 'status ' + state;
    lastStatus = [state, label, src]; statusText();
    if (state === 'connecting' || state === 'open') S.liveSec = null; // 新连接 → 首笔成交后重新回填断线期间
    if (state === 'connecting') introStep(40, 'introConn', label);
    if (state === 'open') introStep(65, 'introScout');
    if (state === 'live') { introStep(90, 'introReady'); finishIntro(); }
    if (src !== S.src) { if (S.src) resetStats(); S.src = src; }
    $('pair').textContent = `${M.base}/${SOURCES[src].quote} · ${SOURCES[src].name}`;
  },
  onTrade,
  onTicker(t) { S.open24h = t.open24h; S.hi = t.high24h; S.lo = t.low24h; S.vol = t.vol24h; if (!S.last) S.last = t.last; },
  onBook(b) { S.book = b; },
});
const sel = $('sourceSel');
sel.value = params.get('source') || localStorage.getItem('bb_source') || 'auto';
if (!sel.value) sel.value = 'auto';
// 断网恢复：若当前不在正常接收，立刻从首选交易所重连（不用等退避计时器，也能从备用源切回 Binance）
window.addEventListener('offline', statusText);
window.addEventListener('online', () => { if (!lastStatus || lastStatus[0] !== 'live') fm.start(sel.value, M); });
sel.onchange = () => { localStorage.setItem('bb_source', sel.value); resetStats(); fm.start(sel.value, M); };

// ---------- 币种切换 ----------
const tabs = [...document.querySelectorAll('#coinTabs button[data-coin]')];
function moveInd() {
  const on = tabs.find(b => b.dataset.coin === tabKey(coin)), ind = $('tabInd');
  if (on) { ind.style.left = on.offsetLeft + 'px'; ind.style.width = on.offsetWidth + 'px'; }
}
function renderChips() {
  const saved = +localStorage.getItem('cw_th_' + coin);
  S.threshold = cfg().chips.includes(saved) ? saved : cfg().defChip;
  $('chips').innerHTML = cfg().chips.map(v => `<button data-v="${v}" class="${v === S.threshold ? 'on' : ''}">${wan(v)}</button>`).join('');
  for (const b of document.querySelectorAll('#chips button')) b.onclick = () => {
    S.threshold = +b.dataset.v; localStorage.setItem('cw_th_' + coin, S.threshold);
    document.querySelectorAll('#chips button').forEach(x => x.classList.toggle('on', x === b));
    renderTrades();
  };
  const th = cfg().th;
  $('legend').textContent = T('legend', wan(th.shell), wan(th.heavy), wan(th.whale));
}
const tabKey = (id) => PRESET[id] ? id : 'cur';
let switchGen = 0, pendingSearch = null;
async function resolveMarket(id) {
  if (PRESET[id]) return PRESET[id];
  if (!/^[\p{L}\p{N}]{1,20}$/u.test(id)) return null; // 允许中文代码（Binance 有“币安人生”“牛来”）
  try { await loadUniverse(); } catch {}
  return universe.get(id) || null;
}
// 切换币种：断开旧连接 → 按新币的精度和门槛重置 → 重新连接、回填
async function setCoin(id, { push = true, first = false } = {}) {
  id = String(id || '').toLowerCase().trim();
  const g = ++switchGen; // 先作废进行中的切换（比如切换途中又点了当前币 / 按了后退）
  if (!first && id === coin) return;
  const m = await resolveMarket(id);
  if (g !== switchGen) return;
  if (!m) {
    showBanner(T('notFound', id.toUpperCase().slice(0, 20)), 'gold', 3200, true);
    if (first) { pendingSearch = id; return setCoin('btc', { push: false, first: true }); }
    openSearch(id); return;
  }
  // 门槛只看主数据源（Binance 优先）的 24h 成交额：无论从搜索还是直接打开链接进入，门槛都一致
  let qv = m.qvP, vol = null;
  if (!PRESET[id] && !(qv > 0)) { vol = await fetchQuoteVolume(m); if (g !== switchGen) return; qv = vol ? vol.qv : 0; m.qvP = qv; if (!m.qv) m.qv = qv; }
  coin = id; M = m;
  CF = { dp: Math.min(m.dp ?? 2, 10), qdp: id === 'eth' ? 2 : Math.min(m.qdp ?? 3, 3), ...thresholdsFor(id, qv) };
  localStorage.setItem('cw_coin', id); pushRecent(id);
  const u = new URL(location.href); u.searchParams.set('coin', id);
  if (push && !first) history.pushState({ coin: id }, '', u); else history.replaceState({ coin: id }, '', u);
  const key = tabKey(id);
  $('tab-cur').hidden = key !== 'cur';
  if (key === 'cur') { $('cur-sym').textContent = m.base; $('mini-cur').textContent = m.last ? fmtPx(m.last, CF.dp) : '--'; $('minich-cur').textContent = ''; }
  tabs.forEach(b => { b.classList.toggle('on', b.dataset.coin === key); b.setAttribute('aria-selected', b.dataset.coin === key); });
  for (const o of sel.options) o.disabled = o.value !== 'auto' && !m[o.value]; // 没上这个交易所的币禁用该数据源
  battle.setThresholds(CF.th);
  if (!first) { battle.reset(); showBanner(T('toCoin', m.base), 'gold', 1600, true); }
  renderChips(); resetStats(); S.src = null;
  if (m.last > 0) S.last = m.last; // 冷门币可能几十秒没有成交 / 行情推送：先用搜索列表里的最新价（≤60 秒前），有成交后立即替换
  $('pair').textContent = `${m.base}/${SOURCES[primarySource(m)].quote}`;
  document.title = T('title', m.base);
  requestAnimationFrame(fitHeader);
  fm.start(sel.value, m);
}
tabs.forEach(b => b.onclick = () => setCoin(b.dataset.coin === 'cur' ? coin : b.dataset.coin));
window.addEventListener('popstate', () => setCoin(new URLSearchParams(location.search).get('coin') || 'btc', { push: false }));
window.addEventListener('resize', moveInd);
if (window.ResizeObserver) { const ro = new ResizeObserver(moveInd); tabs.forEach(b => ro.observe(b)); }
document.fonts && document.fonts.ready.then(moveInd);

// ---------- 双币迷你行情 ----------
const miniPrev = {};
function setMini(c, last, chg) {
  const k = tabKey(c), el = $('mini-' + k), ch = $('minich-' + k);
  const dp = c === coin ? CF.dp : (PRESET[c] ? PRESET[c].dp : 2);
  el.textContent = last.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  if (miniPrev[k] && last !== miniPrev[k]) { el.className = 'ct-px ' + (last > miniPrev[k] ? 'up' : 'down'); }
  miniPrev[k] = last;
  if (chg != null && isFinite(chg)) { ch.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'; ch.className = 'ct-ch ' + (chg >= 0 ? 'pos' : 'neg'); }
}
async function pollMini() {
  if (document.hidden) return; // 后台标签页不轮询，省流量和 Binance 请求权重
  const o = await fetchMiniTickers();
  if (o) for (const c of Object.keys(o)) if (c !== coin || !S.last) setMini(c, o[c].last, o[c].chg);
}
pollMini(); setInterval(pollMini, 4000);

// ---------- 价格（逐位滚动） ----------
const priceEl = $('price'); let flashT, lastShown = 0;
function renderPrice(str, prevStr) {
  let html = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i], changed = prevStr.length !== str.length || prevStr[i] !== ch;
    html += /\d/.test(ch) ? `<span class="dg${changed ? ' ch' : ''}">${ch}</span>` : ch;
  }
  priceEl.innerHTML = html;
}
setInterval(() => {
  if (!S.last || S.last === lastShown) return;
  const up = S.last > lastShown, str = '$' + fmtP(S.last);
  if (lastShown) {
    priceEl.classList.remove('up', 'down'); void priceEl.offsetWidth; priceEl.classList.add(up ? 'up' : 'down');
    clearTimeout(flashT); flashT = setTimeout(() => priceEl.classList.remove('up', 'down'), 650);
  }
  renderPrice(str, S.shownStr); S.shownStr = str; lastShown = S.last;
  document.title = T('title', `${str} ${M.base}`);
  const ch = S.open24h ? (S.last / S.open24h - 1) * 100 : null;
  setMini(coin, S.last, ch);
  updateMeta();
}, 100);
// 24h 涨跌 / 高 / 低 / 量：行情推送就更新（低价币可能很久不跳价）
function updateMeta() {
  if (S.last && S.open24h) {
    const ch = (S.last / S.open24h - 1) * 100, el = $('chg');
    el.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%'; el.className = 'chg ' + (ch >= 0 ? 'pos' : 'neg');
  }
  if (S.hi) { $('hi').textContent = fmtP(S.hi); $('lo').textContent = fmtP(S.lo); $('vol').textContent = (S.vol >= 1e6 ? fmtNum(S.vol) : Math.round(S.vol).toLocaleString()) + ' ' + M.base; }
}
setInterval(updateMeta, 1000);
setInterval(() => { $('tps').textContent = T('tps', S.tradesThisSec); S.tradesThisSec = 0;
  if ($('trades').querySelector('.empty')) renderTrades(); else tradesNote(); // 提示里的分钟数随时间更新
}, 1000);

// ---------- 数字补间 ----------
const tweens = new Map();
function tweenNum(el, to, fmt = (v) => Math.round(v)) {
  const cur = tweens.get(el) ?? to; tweens.set(el, cur);
  const t0 = performance.now(), from = cur;
  el._tw = t0;
  const step = (now) => {
    if (el._tw !== t0) return;
    const k = Math.min((now - t0) / 500, 1), e = 1 - Math.pow(1 - k, 3), v = from + (to - from) * e;
    tweens.set(el, v); el.textContent = fmt(v);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- 比例条 ----------
function setRatio(prefix, a, b, la, lb, fmtA, fmtB, note = '') {
  const tot = a + b, pa = tot ? a / tot : 0.5;
  $(prefix + 'b').style.width = (pa * 100).toFixed(1) + '%';
  $(prefix + 'r').style.width = ((1 - pa) * 100).toFixed(1) + '%';
  $(prefix + 'pct').innerHTML = (note ? `<small class="rb-note">${note}</small> ` : '') + (tot ? `<span class="c-blue">${(pa * 100).toFixed(0)}%</span> : <span class="c-red">${((1 - pa) * 100).toFixed(0)}%</span>` : '--');
  $(prefix + la).textContent = fmtA; $(prefix + lb).textContent = fmtB;
  return tot ? pa * 2 - 1 : 0;
}

// ---------- 盘口深度 ----------
function computeDepth() {
  const b = S.book; if (!b || !b.ready) return null;
  const bb = b.bestBid(), ba = b.bestAsk(); if (!isFinite(bb) || !isFinite(ba) || bb >= ba * 1.01) return null;
  const mid = (bb + ba) / 2, NB = 50, bins = { bid: new Float64Array(NB), ask: new Float64Array(NB) };
  let b05 = 0, a05 = 0, b1 = 0, a1 = 0, minB = Infinity, maxA = 0;
  // 覆盖范围按整本盘口最远的价位算（冷门币 ±1% 边缘可能刚好没有挂单，不应误报“仅覆盖”）
  for (const [p, q] of b.bids) {
    if (p < minB) minB = p;
    const d = (mid - p) / mid; if (d < 0 || d > 0.01) continue;
    const u = p * q; b1 += u; if (d <= 0.005) b05 += u; bins.bid[Math.min(NB - 1, (d / 0.01 * NB) | 0)] += u;
  }
  for (const [p, q] of b.asks) {
    if (p > maxA) maxA = p;
    const d = (p - mid) / mid; if (d < 0 || d > 0.01) continue;
    const u = p * q; a1 += u; if (d <= 0.005) a05 += u; bins.ask[Math.min(NB - 1, (d / 0.01 * NB) | 0)] += u;
  }
  return { bb, ba, mid, b05, a05, b1, a1, bins, cover: Math.min((mid - minB) / mid, (maxA - mid) / mid) };
}

// ---------- 小图表 ----------
function prepCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, r.width, r.height);
  return [x, r.width, r.height];
}
function drawFlow() {
  const [x, W, H] = prepCanvas($('flowChart'));
  const now = Math.floor(Date.now() / 1000), N = 60, step = 2, bars = [];
  let mx = 1;
  for (let i = N - 1; i >= 0; i--) {
    let bu = 0, su = 0;
    for (let j = 0; j < step; j++) { const s = now - i * step - j, k = S.buckets[((s % 300) + 300) % 300]; if (k.sec === s) { bu += k.bu; su += k.su; } }
    bars.push([bu, su]); mx = Math.max(mx, bu, su);
  }
  const mid = H / 2, bw = W / N;
  x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(0, mid, W, 1);
  let cum = 0; const cumPts = [];
  bars.forEach(([bu, su], i) => {
    const hb = Math.sqrt(bu / mx) * (mid - 4), hs = Math.sqrt(su / mx) * (mid - 4);
    let g = x.createLinearGradient(0, mid - hb, 0, mid); g.addColorStop(0, '#93c5fd'); g.addColorStop(1, '#1d4ed8');
    x.fillStyle = g; x.fillRect(i * bw + 1, mid - hb, bw - 2, hb);
    g = x.createLinearGradient(0, mid, 0, mid + hs); g.addColorStop(0, '#b91c1c'); g.addColorStop(1, '#fca5a5');
    x.fillStyle = g; x.fillRect(i * bw + 1, mid + 1, bw - 2, hs);
    cum += bu - su; cumPts.push(cum);
  });
  const cm = Math.max(1, ...cumPts.map(Math.abs));
  x.strokeStyle = '#fbbf24'; x.lineWidth = 1.8; x.shadowColor = '#fbbf24'; x.shadowBlur = 6; x.beginPath();
  cumPts.forEach((c, i) => { const y = mid - (c / cm) * (mid - 6); i ? x.lineTo(i * bw + bw / 2, y) : x.moveTo(bw / 2, y); });
  x.stroke(); x.shadowBlur = 0;
  x.fillStyle = 'rgba(230,235,255,.5)'; x.font = '10px -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'; x.fillText(T('flowCap'), 6, 12);
}
function drawDepth(d) {
  const [x, W, H] = prepCanvas($('depthChart'));
  if (!d) { x.fillStyle = 'rgba(230,235,255,.5)'; x.font = '12px -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'; x.fillText(T('depthWait'), 10, 20); return; }
  const NB = d.bins.bid.length; let cb = 0, ca = 0; const cbA = [], caA = [];
  for (let i = 0; i < NB; i++) { cb += d.bins.bid[i]; ca += d.bins.ask[i]; cbA.push(cb); caA.push(ca); }
  const mx = Math.max(cb, ca, 1), mid = W / 2, base = H - 14;
  const area = (arr, dir, c1, c2, stroke) => {
    const g = x.createLinearGradient(0, 0, 0, base); g.addColorStop(0, c1); g.addColorStop(1, c2);
    x.fillStyle = g; x.beginPath(); x.moveTo(mid, base);
    arr.forEach((v, i) => x.lineTo(mid + dir * (i + 1) / NB * (mid - 2), base - v / mx * (base - 16)));
    x.lineTo(mid + dir * (mid - 2), base); x.closePath(); x.fill();
    x.strokeStyle = stroke; x.lineWidth = 1.5; x.beginPath(); x.moveTo(mid, base);
    arr.forEach((v, i) => x.lineTo(mid + dir * (i + 1) / NB * (mid - 2), base - v / mx * (base - 16))); x.stroke();
  };
  area(cbA, -1, 'rgba(59,130,246,.7)', 'rgba(59,130,246,.05)', '#93c5fd');
  area(caA, 1, 'rgba(239,68,68,.7)', 'rgba(239,68,68,.05)', '#fca5a5');
  x.fillStyle = 'rgba(255,255,255,.4)'; x.fillRect(mid, 10, 1, base - 10);
  x.fillStyle = 'rgba(230,235,255,.55)'; x.font = '10px "JetBrains Mono", monospace';
  x.textAlign = 'left'; x.fillText('-1%', 2, H - 3); x.textAlign = 'right'; x.fillText('+1%', W - 2, H - 3);
  x.textAlign = 'center'; x.fillText(fmtP(d.mid), mid, H - 3);
  x.textAlign = 'left'; x.fillText(T('wallB') + fmtUsd(cb), 4, 11); x.textAlign = 'right'; x.fillText(T('wallA') + fmtUsd(ca), W - 4, 11);
  if (d.cover < 0.0099) { x.textAlign = 'center'; x.fillStyle = 'rgba(251,191,36,.7)'; x.fillText(T('depthCover', (d.cover * 100).toFixed(2)), mid, 24); }
}

// ---------- 横幅 ----------
const banner = $('banner'); let bannerT, bannerBusyUntil = 0;
function showBanner(html, cls, ms = 2200, force = false) {
  const now = Date.now(); if (!force && now < bannerBusyUntil) return;
  bannerBusyUntil = now + ms;
  banner.innerHTML = html; banner.className = 'banner ' + cls;
  void banner.offsetWidth; banner.classList.add('show');
  clearTimeout(bannerT); bannerT = setTimeout(() => banner.classList.remove('show'), ms);
}
battle.onWhale = (side, usd) => (audio.whale(side), showBanner(T('whale', side === 'blue', fmtUsd(usd)), side, 2600, true));

// ---------- 战力 & 刷新 ----------
let smoothS = 0, musicI = 0.15, musicBpm = 80, musicMood = 0;
const VICTORY_SEC = 20;
function refresh() {
  const C = M.base;
  const w10 = windowSum(10), w60 = windowSum(60), w300 = windowSum(300);
  const f = (q, u) => `${fmtQ(q)} ${C} · ${fmtUsd(u)}`;
  // 窗口还没攒满（非 Binance 源无法回填历史 / 回填未完成）时如实标注已统计的秒数
  const cov = S.since ? Math.floor(Date.now() / 1000) - S.since + 1 : 0;
  const nt = (n) => cov < n ? T('only', cov) : '';
  const i10 = setRatio('tk10', w10.bu, w10.su, 'buy', 'sell', T('buy') + ' ' + f(w10.b, w10.bu), T('sell') + ' ' + f(w10.s, w10.su), nt(10));
  const i60 = setRatio('tk60', w60.bu, w60.su, 'buy', 'sell', T('buy') + ' ' + f(w60.b, w60.bu), T('sell') + ' ' + f(w60.s, w60.su), nt(60));
  setRatio('tk300', w300.bu, w300.su, 'buy', 'sell', T('buy') + ' ' + f(w300.b, w300.bu), T('sell') + ' ' + f(w300.s, w300.su), nt(300));
  const dl = w300.bu - w300.su, de = $('delta');
  const dq = w300.b - w300.s;
  de.textContent = (dl >= 0 ? '+' : '-') + fmtUsd(Math.abs(dl)) + ` (${dq >= 0 ? '+' : '-'}${fmtQ(Math.abs(dq))} ${C})`;
  de.className = dl >= 0 ? 'c-blue' : 'c-red';

  const d = computeDepth(); let ib = 0;
  if (d) {
    const cv = (r) => d.cover < r ? T('cover', (d.cover * 100).toFixed(2)) : ''; // 如 Coinbase 公共频道只给前 50 档
    ib = setRatio('bk05', d.b05, d.a05, 'bid', 'ask', T('bid') + ' ' + fmtUsd(d.b05), T('ask') + ' ' + fmtUsd(d.a05), cv(0.0049));
    setRatio('bk1', d.b1, d.a1, 'bid', 'ask', T('bid') + ' ' + fmtUsd(d.b1), T('ask') + ' ' + fmtUsd(d.a1), cv(0.0099));
    $('bb').textContent = fmtP(d.bb); $('ba').textContent = fmtP(d.ba); $('spr').textContent = fmtP(d.ba - d.bb); // 按该币价格精度（PEPE 等低价币不再显示 0.00）
  }
  if (!document.hidden) { drawDepth(d); drawFlow(); } // 后台标签页不画小图表

  // ===== 战力模型（全部来自实时行情，无随机）=====
  // 价格涨跌占 50%：10 秒 25% + 1 分钟 25%；吃单 30%；挂单 20%
  const ch10 = priceChange(10), ch60 = priceChange(60);
  // 归一化尺度：BTC 1、ETH 1.5；其它币按 24h 振幅放宽（山寨币波动大，避免一点小波动就打满）
  const rng = S.hi && S.lo && S.last ? (S.hi - S.lo) / S.last : 0.06;
  const k = coin === 'btc' ? 1 : coin === 'eth' ? 1.5 : Math.min(5, Math.max(1.5, rng / 0.03));
  const p10 = Math.tanh(ch10 / (0.03 * k)), p60 = Math.tanh(ch60 / (0.10 * k));
  const raw = 0.25 * p10 + 0.25 * p60 + 0.15 * i10 + 0.15 * i60 + 0.2 * ib;
  smoothS = smoothS * 0.6 + raw * 0.4;
  // 待机射击频率 ∝ 每方近 10 秒主动成交额
  const ref = cfg().th.shell * 4;
  battle.setActivity(w10.bu / ref, w10.su / ref);
  // ===== 配乐参数（与战场同一套实时输入，无随机）=====
  // 速度 ← 近 10 秒成交额 + 成交笔数；情绪 ← 价格涨跌方向（10 秒/1 分钟）为主；强度 ← 活跃度 + 战力偏向
  const actUsd = Math.tanh((w10.bu + w10.su) / ref / 1.5);
  // 成交笔数按该币自己的常态笔数归一（近几分钟的滑动均值），不再用 BTC 常数
  if (S.liveSec && Date.now() / 1000 - S.liveSec >= 10) S.nEma = S.nEma ? S.nEma * 0.995 + w10.n * 0.005 : Math.max(w10.n, 3);
  const actN = Math.tanh(w10.n / (2 * Math.max(3, S.nEma || 10)));
  const act = 0.6 * actUsd + 0.4 * actN;
  musicI = musicI * 0.7 + Math.min(1, 0.15 + 0.4 * act + 0.45 * Math.abs(smoothS)) * 0.3;
  musicBpm = musicBpm * 0.75 + (70 + 56 * act + 14 * Math.abs(smoothS)) * 0.25;
  musicMood = 0.7 * (0.5 * p10 + 0.5 * p60) + 0.3 * smoothS;
  audio.update({ intensity: S.surge ? Math.max(musicI, 0.85) : musicI, bias: musicMood, surge: S.surge, bpm: S.surge ? Math.max(124, musicBpm) : musicBpm });
  updateMusicInd();
  S.dbg = { musicI, musicBpm, musicMood, t: Date.now(), price: S.last, ch10, ch60, p10, p60, i10, i60, ib, raw, s: smoothS, front: battle.front, target: battle.frontTarget, actB: w10.bu / ref, actR: w10.su / ref, w10, w60, w300, coin, th: CF.th };
  const pc = (v) => `<b class="${v >= 0 ? 'c-blue' : 'c-red'}">${v >= 0 ? '+' : ''}${v.toFixed(3)}%</b>`;
  const rt = (v) => { const b = Math.round((v + 1) * 50); return `<b><span class="c-blue">${b}</span>:<span class="c-red">${100 - b}</span></b>`; };
  const bi = (x) => `<span class="bi">${x}</span>`;
  $('basis').innerHTML = T('basis') + [
    `${T('b10')} ${pc(ch10)}`, `${T('b60')}${cov < 60 ? T('bOnly', cov) : ''} ${pc(ch60)}`,
    `${T('bLast')} ${S.tickDir > 0 ? '<b class="c-blue">↑</b>' : S.tickDir < 0 ? '<b class="c-red">↓</b>' : '–'}`,
    `${T('bTk')} ${rt(i60)}`, `${T('bBk')} ${rt(ib)}`].map(bi).join(' · ');
  const s = smoothS, blueShare = 0.5 + 0.5 * s;
  battle.setFront(0.5 + Math.tanh(s * 1.6) * 0.5);
  const bp = Math.round(blueShare * 100);
  tweenNum($('bluePow'), bp); tweenNum($('redPow'), 100 - bp);
  $('pbBlue').style.width = bp + '%'; $('pbRed').style.width = (100 - bp) + '%';
  $('pbClash').style.left = bp + '%';

  // 总攻判定（带迟滞）
  let surge = S.surge;
  if (!surge && s > 0.3) surge = 'blue'; else if (!surge && s < -0.3) surge = 'red';
  else if (surge === 'blue' && s < 0.2) surge = null; else if (surge === 'red' && s > -0.2) surge = null;
  if (surge !== S.surge) {
    S.surge = surge; S.surgeSince = Date.now(); S.wonFor = null; battle.setSurge(surge);
    if (surge) audio.surge(surge);
    if (surge) showBanner(surge === 'blue' ? T('surgeB') : T('surgeR'), surge, 2400, true);
  }
  // 胜利：持续压制
  const held = surge ? (Date.now() - S.surgeSince) / 1000 : 0;
  if (surge && held >= VICTORY_SEC && S.wonFor !== surge) {
    S.wonFor = surge; battle.celebrate(surge); audio.fanfare(surge);
    showBanner(surge === 'blue' ? T('winB', VICTORY_SEC) : T('winR', VICTORY_SEC), surge + ' victory', 3200, true);
  }
  $('streak').textContent = surge ? T('streak', surge === 'blue', Math.floor(held), held >= VICTORY_SEC) : '';
  const st = $('battleState');
  if (surge) { st.textContent = surge === 'blue' ? T('stSurgeB') : T('stSurgeR'); st.className = 'state surge ' + surge; }
  else if (s > 0.08) { st.textContent = T('stBlue'); st.className = 'state blue'; }
  else if (s < -0.08) { st.textContent = T('stRed'); st.className = 'state red'; }
  else { st.textContent = T('stTie'); st.className = 'state'; }
}
setInterval(refresh, 400);

// ---------- 战争配乐 / 音效（默认开启；浏览器禁止无点击自动播放，首次点击/触摸/按键即解锁） ----------
const audio = new AudioController();
window.__audio = audio; // 调试用
const AKEY = 'cw_audio2'; // v2：默认开启（忽略旧版“默认关闭”时存下的设置）
const AP = Object.assign({ music: true, sfx: true, vol: 75, muted: false }, JSON.parse(localStorage.getItem(AKEY) || '{}'));
// 一键静音：只压住输出，不改动音乐/音效各自的开关，取消静音后恢复原设置
const aMusic = () => AP.music && !AP.muted, aSfx = () => AP.sfx && !AP.muted;
const sndTog = $('sndTog');
const audioBtn = $('audioBtn'), pop = $('audioPop'), mInd = $('musicInd');
$('musicTog').checked = AP.music; $('sfxTog').checked = AP.sfx; $('volRange').value = AP.vol;
function moodLabel() {
  if (S.surge) return S.surge === 'blue' ? T('mSurgeB') : T('mSurgeR');
  return musicMood > 0.15 ? T('mUp') : musicMood < -0.15 ? T('mDown') : T('mTie');
}
function updateMusicInd() {
  const want = aMusic() || aSfx(), locked = audio.locked;
  audioBtn.textContent = !want ? '🔇' : AP.music ? '🎵' : '🔊';
  if (sndTog) { sndTog.textContent = AP.muted ? T('sndOff') : T('sndOn'); sndTog.classList.toggle('off', AP.muted); sndTog.setAttribute('aria-pressed', String(!AP.muted)); }
  audioBtn.classList.toggle('on', want && audio.running);
  audioBtn.classList.toggle('pending', locked);
  mInd.className = 'music-ind' + (locked ? ' locked' : !want ? ' off' : '') + (!locked && want ? ' ' + (S.surge || (musicMood > 0.15 ? 'blue' : musicMood < -0.15 ? 'red' : '')) : '');
  mInd.textContent = locked ? T('mLocked') : !want ? T('mOff') : aMusic() ? `♪ ${audio.bpm()} BPM · ${moodLabel()}` : `${T('mSfx')} · ${moodLabel()}`;
}
function saveAudio() {
  localStorage.setItem(AKEY, JSON.stringify(AP));
  audio.apply({ music: aMusic(), sfx: aSfx(), volume: AP.vol / 100 });
  if ((aMusic() || aSfx()) && !audio.running) audio.unlock().then(updateMusicInd); // 开关本身就是一次点击
  updateMusicInd();
}
audio.onstate = updateMusicInd;
audio.apply({ music: aMusic(), sfx: aSfx(), volume: AP.vol / 100 });
// 任意首次交互即解锁（iOS 需在手势回调里同步 resume）
const GEST = ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'keydown', 'click'];
function onGesture() {
  if (!(aMusic() || aSfx())) return;
  if (!audio.running) audio.unlock().then((ok) => { updateMusicInd(); if (ok) GEST.forEach(ev => document.removeEventListener(ev, onGesture, true)); });
  else GEST.forEach(ev => document.removeEventListener(ev, onGesture, true));
}
GEST.forEach(ev => document.addEventListener(ev, onGesture, true));
if (aMusic() || aSfx()) audio.tryAutoStart().then(updateMusicInd);
// 开场“点击进入战场”
$('introGo').onclick = (e) => { e.stopPropagation(); onGesture(); closeIntro(); };
intro.addEventListener('click', () => { if (intro.classList.contains('ready')) { onGesture(); closeIntro(); } });
document.addEventListener('keydown', (e) => { if (intro.classList.contains('ready') && (e.key === 'Enter' || e.key === ' ')) closeIntro(); });
mInd.onclick = (e) => { e.stopPropagation(); if (audio.locked) onGesture(); else pop.hidden = !pop.hidden; };
audioBtn.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; };
document.addEventListener('click', (e) => { if (!pop.hidden && !e.target.closest('.audio-wrap')) pop.hidden = true; });
$('musicTog').onchange = (e) => { AP.music = e.target.checked; if (AP.music) AP.muted = false; saveAudio(); };
$('sfxTog').onchange = (e) => { AP.sfx = e.target.checked; if (AP.sfx) AP.muted = false; saveAudio(); };
// 战场画面上的一键静音按钮 + 快捷键 M
function toggleMute() {
  if (AP.muted || !(AP.music || AP.sfx)) { AP.muted = false; if (!AP.music && !AP.sfx) { AP.music = AP.sfx = true; $('musicTog').checked = $('sfxTog').checked = true; } }
  else AP.muted = true;
  saveAudio();
}
if (sndTog) sndTog.onclick = (e) => { e.stopPropagation(); toggleMute(); };
document.addEventListener('keydown', (e) => {
  if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey && !(e.target.closest && e.target.closest('input, textarea, select, [contenteditable]'))) toggleMute();
});
$('volRange').oninput = (e) => { AP.vol = +e.target.value; saveAudio(); };
updateMusicInd();

// ---------- 币种搜索（类似 TradingView：输入代码/名称，↑↓ 选择，Enter 打开，/ 呼出）----------
const sPop = $('searchPop'), sIn = $('searchIn'), sList = $('searchList');
let sItems = [], sAct = 0, sTimer = null;
const esc = (x) => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function exLabel(m) { return [m.binance && 'Binance', m.okx && 'OKX', m.coinbase && 'Coinbase'].filter(Boolean).join(' · '); }
function rowHtml(m, i) {
  const fav = favorites().includes(m.id), q = sIn.value.trim().toLowerCase();
  let sym = esc(m.base);
  const k = q && m.id.indexOf(q); if (q && k >= 0) sym = esc(m.base.slice(0, k)) + '<mark class="sp-hl">' + esc(m.base.slice(k, k + q.length)) + '</mark>' + esc(m.base.slice(k + q.length));
  const px = m.last ? fmtPx(m.last, Math.min(m.dp ?? 2, 10)) : '--';
  const ch = m.chg != null && isFinite(m.chg) ? `<span class="sp-ch ${m.chg >= 0 ? 'pos' : 'neg'}">${m.chg >= 0 ? '+' : ''}${m.chg.toFixed(2)}%</span>` : '<span class="sp-ch">--</span>';
  return `<div class="sp-row${i === sAct ? ' act' : ''}${m.id === coin ? ' cur' : ''}" role="option" id="sp-o${i}" aria-selected="${i === sAct}" data-i="${i}" data-id="${esc(m.id)}">` +
    `<button type="button" class="sp-star${fav ? ' on' : ''}" title="${esc(T('sFavT'))}" data-fav="${esc(m.id)}">${fav ? '★' : '☆'}</button>` +
    `<span class="sp-sym">${sym}<small>/${m.binance || m.okx ? 'USDT' : 'USD'}</small></span><span class="sp-ex">${exLabel(m)}</span>` +
    `<span class="sp-px">${px}</span>${ch}<span class="sp-vol">${m.qv ? fmtUsd(m.qv) : '--'}</span></div>`;
}
function renderSearch() {
  const q = sIn.value.trim();
  const byId = (id) => universe.get(id) || PRESET[id];
  let html = ''; sItems = [];
  const add = (title, list) => { list = list.filter(m => m && !sItems.includes(m)); if (!list.length) return; html += `<div class="sp-sec">${title}</div>`; for (const m of list) { html += rowHtml(m, sItems.length); sItems.push(m); } };
  if (!universe.size && q) html = `<div class="sp-msg">${T('sLoading')}</div>`;
  else if (q) { add('', searchCoins(q, 40)); if (!sItems.length) html = `<div class="sp-msg">${esc(T('sNone', q))}</div>`; }
  else {
    add(T('sFav'), favorites().map(byId));
    add(T('sRecent'), recents().map(byId));
    const hot = topByVolume(15);
    add(T('sHot'), hot.length ? hot : ['btc', 'eth', 'sol', 'bnb', 'xrp', 'doge', 'pepe'].map(byId));
    if (!universe.size) html += `<div class="sp-msg">${T('sLoading')}</div>`;
  }
  if (sAct >= sItems.length) sAct = Math.max(0, sItems.length - 1);
  sList.innerHTML = html;
  if (sItems.length) sIn.setAttribute('aria-activedescendant', 'sp-o' + sAct); else sIn.removeAttribute('aria-activedescendant');
  $('searchFoot').textContent = universe.size ? T('sFoot', universe.size) : '';
}
function setAct(i) {
  if (!sItems.length) return;
  sAct = (i + sItems.length) % sItems.length;
  sList.querySelectorAll('.sp-row').forEach(r => { const on = +r.dataset.i === sAct; r.classList.toggle('act', on); r.setAttribute('aria-selected', on); });
  sIn.setAttribute('aria-activedescendant', 'sp-o' + sAct);
  const el = sList.querySelector(`.sp-row[data-i="${sAct}"]`); if (el) el.scrollIntoView({ block: 'nearest' });
}
function openSearch(q = '') {
  sPop.hidden = false; sIn.setAttribute('aria-expanded', 'true'); sIn.value = q; sAct = 0; renderSearch();
  setTimeout(() => sIn.focus(), 0);
  loadUniverse().then(renderSearch).catch(() => {});
  loadTickers().then(() => { if (!sPop.hidden) renderSearch(); }).catch(() => {}); // 60 秒内只拉一次
}
function closeSearch() { sPop.hidden = true; sIn.setAttribute('aria-expanded', 'false'); sIn.blur(); }
function pick(m) { if (!m) return; closeSearch(); setCoin(m.id); }
$('searchBtn').onclick = (e) => { e.stopPropagation(); sPop.hidden ? openSearch() : closeSearch(); };
$('searchClose').onclick = closeSearch;
sIn.addEventListener('input', () => { sAct = 0; clearTimeout(sTimer); sTimer = setTimeout(renderSearch, 60); });
sIn.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setAct(sAct + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setAct(sAct - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); clearTimeout(sTimer); if (sTimer) renderSearch(); pick(sItems[sAct]); }
  else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
});
sList.addEventListener('click', (e) => {
  const f = e.target.closest('[data-fav]');
  if (f) { e.stopPropagation(); toggleFav(f.dataset.fav); renderSearch(); return; }
  const r = e.target.closest('.sp-row'); if (r) pick(sItems[+r.dataset.i]);
});
sList.addEventListener('mousemove', (e) => { const r = e.target.closest('.sp-row'); if (r && +r.dataset.i !== sAct) setAct(+r.dataset.i); });
document.addEventListener('click', (e) => { if (!sPop.hidden && !e.target.closest('#searchPop') && !e.target.closest('#searchBtn')) closeSearch(); });
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
    if (intro.isConnected && !intro.classList.contains('done')) return;
    e.preventDefault(); openSearch();
  }
});
setTimeout(() => loadUniverse().catch(() => {}), 3000); // 首屏之后再后台预载币种列表（有缓存时瞬间完成；打开搜索时会立即加载）

// ---------- 顶栏自适应（按实际内容宽度换行，避免作者徽章盖住币种切换）----------
const topbar = document.querySelector('.topbar');
function fitHeader() {
  const bw = document.querySelector('.brand-wrap'), ct = document.querySelector('.controls'), tb = $('coinTabs');
  topbar.classList.remove('stack', 'stack2', 'stack3', 'stack4');
  const cs = getComputedStyle(topbar), inner = topbar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const gap = parseFloat(cs.columnGap) || 14;
  const need = (el) => el.scrollWidth;
  if (need(bw) + need(tb) + need(ct) + gap * 2 + 8 > inner) {
    topbar.classList.add('stack');
    if (need(bw) + need(ct) + gap + 8 > inner) topbar.classList.add('stack2');
    // 币种行（BTC / ETH / 当前币 / 搜索）也放不下：先收起搜索文字，再收起涨跌幅
    if (tb.scrollWidth > inner) topbar.classList.add('stack3');
    if (tb.scrollWidth > inner) topbar.classList.add('stack4');
  }
  moveInd();
}
window.addEventListener('resize', fitHeader);
document.fonts && document.fonts.ready.then(fitHeader);
setTimeout(fitHeader, 0); setInterval(() => { if (!document.hidden) fitHeader(); }, 500); // 状态/配乐指示文字长度会变

// ---------- 语言切换 ----------
document.querySelectorAll('[data-lang]').forEach(b => b.onclick = (e) => { e.stopPropagation(); setLang(b.dataset.lang); });
onLang(() => {
  renderChips(); renderTrades(); statusText(); updateMusicInd(); refresh(); if (!sPop.hidden) renderSearch();
  if (intro.isConnected) introMsg.textContent = T(...introKey);
  document.title = T('title', S.last ? `$${fmtP(S.last)} ${M.base}` : M.base);
  requestAnimationFrame(fitHeader);
});
document.title = T('title');

// ---------- 启动 ----------
setCoin(wantCoin, { first: true });
// 喊单评论区 + 弹幕（独立模块，后端不可用时只影响评论区）
try { initChat({ getCoin: () => M.base, battleHost: document.querySelector('.battle-card') }); } catch (e) { console.warn('chat init failed', e); }
