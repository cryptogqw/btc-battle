import { fetchJson, binFetch } from './net.js?v=43d6fa62';
// 币种宇宙：Binance（USDT 现货）为主，OKX（USDT 现货）、Coinbase（USD）补充；本地缓存 + 24h 行情排序
const UKEY = 'cw_univ_v1', UTTL = 12 * 3600e3;
const BIN_REST = ['https://api.binance.com', 'https://data-api.binance.vision'];

async function binJson(path, ms, w) {
  let err; for (const h of BIN_REST) { try { return await binFetch(h + path, w, ms); } catch (e) { err = e; if (e.rate) break; } }
  throw err;
}
const dec = (s) => { s = String(s); if (/e-/i.test(s)) return +s.split(/e-/i)[1]; const i = s.indexOf('.'); return i < 0 ? 0 : s.slice(i + 1).replace(/0+$/, '').length; };

// 固定的 BTC / ETH（无需等待列表即可秒开）
export const PRESET = {
  btc: { id: 'btc', base: 'BTC', binance: 'BTCUSDT', okx: 'BTC-USDT', coinbase: 'BTC-USD', dp: 2, qdp: 5 },
  eth: { id: 'eth', base: 'ETH', binance: 'ETHUSDT', okx: 'ETH-USDT', coinbase: 'ETH-USD', dp: 2, qdp: 4 },
};
// 常用名称 / 中文名 → 代码（搜索别名）
const ALIAS = {
  bitcoin: 'btc', 比特币: 'btc', 大饼: 'btc', ethereum: 'eth', 以太坊: 'eth', 以太: 'eth', 二饼: 'eth', solana: 'sol', 索拉纳: 'sol',
  binance: 'bnb', 币安币: 'bnb', ripple: 'xrp', 瑞波: 'xrp', dogecoin: 'doge', 狗狗币: 'doge', 狗币: 'doge', cardano: 'ada', 艾达币: 'ada',
  tron: 'trx', 波场: 'trx', toncoin: 'ton', chainlink: 'link', polkadot: 'dot', 波卡: 'dot', litecoin: 'ltc', 莱特币: 'ltc',
  avalanche: 'avax', shiba: 'shib', 柴犬币: 'shib', pepe: 'pepe', 佩佩: 'pepe', sui: 'sui', aptos: 'apt', arbitrum: 'arb', optimism: 'op',
  uniswap: 'uni', near: 'near', filecoin: 'fil', 文件币: 'fil', 'ethereum classic': 'etc', 以太经典: 'etc', bitcoincash: 'bch', 比特现金: 'bch',
  stellar: 'xlm', 恒星币: 'xlm', cosmos: 'atom', 阿童木: 'atom', worldcoin: 'wld', bonk: 'bonk', dogwifhat: 'wif', trump: 'trump', 川普币: 'trump',
  okb: 'okb', 欧易: 'okb', polygon: 'pol', matic: 'pol', hyperliquid: 'hype', ondo: 'ondo', ethena: 'ena', render: 'render', fetch: 'fet',
};

export const universe = new Map(); // id → market
let univPromise = null;
export function loadUniverse(force = false) {
  if (univPromise && !force) return univPromise;
  univPromise = (async () => {
    try {
      const c = JSON.parse(localStorage.getItem(UKEY) || 'null');
      if (!force && c && Date.now() - c.t < UTTL && c.d && c.d.length > 50) { ingest(c.d); refreshUniverse(); return universe; }
    } catch {}
    await refreshUniverse(); return universe;
  })();
  return univPromise;
}
async function refreshUniverse() {
  const [b, o, cb] = await Promise.allSettled([
    binJson('/api/v3/exchangeInfo?symbolStatus=TRADING&showPermissionSets=false', 12000, 20),
    fetchJson('https://www.okx.com/api/v5/public/instruments?instType=SPOT', 10000),
    fetchJson('https://api.exchange.coinbase.com/products', 10000),
  ]);
  const rows = new Map(); // base → [base, binSym, okxSym, cbSym, dp, qdp]
  const get = (base) => { let r = rows.get(base); if (!r) rows.set(base, r = [base, '', '', '', -1, -1]); return r; };
  if (b.status === 'fulfilled') for (const s of b.value.symbols) {
    if (s.quoteAsset !== 'USDT' || s.status !== 'TRADING' || s.isSpotTradingAllowed === false) continue;
    const r = get(s.baseAsset), pf = s.filters.find(f => f.filterType === 'PRICE_FILTER'), lf = s.filters.find(f => f.filterType === 'LOT_SIZE');
    r[1] = s.symbol; r[4] = pf ? dec(pf.tickSize) : 4; r[5] = lf ? dec(lf.stepSize) : 4;
  }
  if (o.status === 'fulfilled') for (const i of o.value.data || []) {
    if (i.quoteCcy !== 'USDT' || i.state !== 'live') continue;
    const r = get(i.baseCcy); r[2] = i.instId; if (r[4] < 0) { r[4] = dec(i.tickSz); r[5] = dec(i.lotSz); }
  }
  if (cb.status === 'fulfilled' && Array.isArray(cb.value)) for (const p of cb.value) {
    if (p.quote_currency !== 'USD' || p.status !== 'online' || p.trading_disabled) continue;
    const r = get(p.base_currency); r[3] = p.id; if (r[4] < 0) { r[4] = dec(p.quote_increment); r[5] = dec(p.base_increment); }
  }
  const d = [...rows.values()];
  if (d.length < 50) { if (!universe.size) throw new Error('universe'); return; }
  ingest(d);
  // 有交易所请求失败（临时故障 / 限流）时只缓存 30 分钟，避免半残的列表（比如缺了 Binance）被用上 12 小时
  const partial = [b, o, cb].some(x => x.status !== 'fulfilled');
  try { localStorage.setItem(UKEY, JSON.stringify({ t: partial ? Date.now() - UTTL + 30 * 60e3 : Date.now(), d })); } catch {}
}
function ingest(d) {
  for (const [base, bs, os, cs, dp, qdp] of d) {
    const id = base.toLowerCase();
    const old = universe.get(id) || {};
    universe.set(id, Object.assign(old, { id, base, binance: bs || null, okx: os || null, coinbase: cs || null, dp: Math.max(0, dp), qdp: Math.max(0, qdp) }));
  }
  // 预设币的精度与交易所一致
  for (const id of Object.keys(PRESET)) if (universe.has(id)) Object.assign(PRESET[id], { dp: universe.get(id).dp, qdp: universe.get(id).qdp });
}
export function primarySource(m) { return m.binance ? 'binance' : m.okx ? 'okx' : 'coinbase'; }

// 24h 行情（价格 / 涨跌 / 成交额 USD），60 秒内不重复请求
let tickAt = 0, tickPromise = null;
export function loadTickers(force = false) {
  if (tickPromise && (!force && Date.now() - tickAt < 60000)) return tickPromise;
  tickAt = Date.now();
  tickPromise = (async () => {
    await loadUniverse().catch(() => {});
    const [b, o, c] = await Promise.allSettled([
      binJson('/api/v3/ticker/24hr?type=MINI', 12000, 80),
      fetchJson('https://www.okx.com/api/v5/market/tickers?instType=SPOT', 10000),
      fetchJson('https://api.exchange.coinbase.com/products/stats', 10000), // 全部交易对 24h 统计（只在 Coinbase 上的币靠它显示价格）
    ]);
    const cbs = c.status === 'fulfilled' && c.value && typeof c.value === 'object' ? c.value : {};
    const bySym = new Map();
    if (b.status === 'fulfilled') for (const t of b.value) bySym.set(t.symbol, t);
    const byInst = new Map();
    if (o.status === 'fulfilled') for (const t of o.value.data || []) byInst.set(t.instId, t);
    for (const m of universe.values()) {
      const bt = m.binance && bySym.get(m.binance), ot = m.okx && byInst.get(m.okx), ct = m.coinbase && cbs[m.coinbase] && cbs[m.coinbase].stats_24hour;
      m.qvB = bt ? +bt.quoteVolume : 0; m.qvO = ot ? +ot.volCcy24h : 0; m.qvC = ct ? (+ct.volume || 0) * (+ct.last || 0) : 0;
      if (bt && +bt.lastPrice) { m.last = +bt.lastPrice; m.chg = +bt.openPrice ? (+bt.lastPrice / +bt.openPrice - 1) * 100 : 0; }
      else if (ot && +ot.last) { m.last = +ot.last; m.chg = +ot.open24h ? (+ot.last / +ot.open24h - 1) * 100 : 0; }
      else if (ct && +ct.last) { m.last = +ct.last; m.chg = +ct.open ? (+ct.last / +ct.open - 1) * 100 : 0; }
      m.qv = m.qvB + m.qvO + m.qvC; // 三家合计，用于搜索排序
      m.qvP = m.binance ? m.qvB : m.okx ? m.qvO : m.qvC; // qvP：主数据源的成交额，用于定门槛（与直接打开链接时一致）
    }
    return universe;
  })();
  return tickPromise;
}
// 单个币的 24h 成交额（USD），用于按币种设定大单门槛
export async function fetchQuoteVolume(m) {
  try {
    const src = primarySource(m);
    if (src === 'binance') { const t = await binJson(`/api/v3/ticker/24hr?symbol=${m.binance}&type=MINI`, 6000, 2); return { qv: +t.quoteVolume, last: +t.lastPrice, hi: +t.highPrice, lo: +t.lowPrice }; }
    if (src === 'okx') { const j = await fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${m.okx}`, 6000); const t = j.data[0]; return { qv: +t.volCcy24h, last: +t.last, hi: +t.high24h, lo: +t.low24h }; }
    const t = await fetchJson(`https://api.exchange.coinbase.com/products/${m.coinbase}/stats`, 6000);
    return { qv: +t.volume * +t.last, last: +t.last, hi: +t.high, lo: +t.low };
  } catch { return null; }
}

// 模糊搜索：代码完全匹配 > 前缀 > 包含 > 子序列，同档按成交额排序
export function search(q, limit = 30) {
  q = (q || '').trim().toLowerCase().replace(/[\s/_-]+/g, '');
  if (!q) return [];
  const qa = Object.prototype.hasOwnProperty.call(ALIAS, q) ? ALIAS[q] : null;
  const qs = q.replace(/(usdt|usdc|usd)$/, '') || q;
  const out = [];
  for (const m of universe.values()) {
    const id = m.id; let s = 0;
    if (id === qs || id === qa) s = 1000;
    else if (id.startsWith(qs)) s = 600 - (id.length - qs.length);
    else if (qa && id.startsWith(qa)) s = 550;
    else if (id.includes(qs)) s = 300 - id.indexOf(qs);
    else if (qs.length >= 2) { let i = 0; for (const ch of id) if (ch === qs[i]) i++; if (i === qs.length) s = 80; }
    if (!s) { for (const [k, v] of Object.entries(ALIAS)) if (v === id && k.startsWith(q) && q.length >= 2) { s = 500; break; } }
    if (s) out.push([s + Math.log10((m.qv || 0) + 1) * 12, m]);
  }
  return out.sort((a, b) => b[0] - a[0]).slice(0, limit).map(x => x[1]);
}
// 稳定币（价格锚定 1 美元，没有多空可看）不进“热门”，但仍可搜索
const STABLE = new Set(['usdt', 'usdc', 'fdusd', 'tusd', 'usdp', 'dai', 'usde', 'usd1', 'pyusd', 'busd', 'usds', 'rlusd', 'eurc', 'eur', 'eurq', 'eurr', 'xusd', 'bfusd', 'usdg', 'aeur', 'gusd', 'usdd', 'frax']);
export function topByVolume(n = 12) {
  return [...universe.values()].filter(m => m.qv > 0 && !STABLE.has(m.id)).sort((a, b) => b.qv - a.qv).slice(0, n);
}

// 门槛：BTC / ETH 保持原值；其它币按 24h 成交额幂律缩放（成交额越小门槛越低），取整到 1/2/2.5/5×10^n
function nice(v) {
  const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
  return (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * e;
}
export function thresholdsFor(id, qv) {
  if (id === 'btc') return { th: { small: 4000, shell: 50000, heavy: 250000, whale: 1e6 }, chips: [20000, 50000, 100000, 500000], defChip: 50000 };
  if (id === 'eth') return { th: { small: 2000, shell: 25000, heavy: 100000, whale: 500000 }, chips: [10000, 25000, 50000, 200000], defChip: 25000 };
  const shell = nice(Math.min(25000, Math.max(500, qv > 0 ? 50000 * Math.pow(qv / 1.5e9, 0.75) : 2000)));
  const chips = [...new Set([nice(shell * 0.4), shell, nice(shell * 2), nice(shell * 10)])];
  return { th: { small: shell * 0.08, shell, heavy: nice(shell * 5), whale: nice(shell * 20) }, chips, defChip: shell };
}

// 最近 / 收藏
const RK = 'cw_recent', FK = 'cw_fav';
const rd = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
export const recents = () => rd(RK);
export function pushRecent(id) { const r = [id, ...rd(RK).filter(x => x !== id)].slice(0, 8); localStorage.setItem(RK, JSON.stringify(r)); }
export const favorites = () => rd(FK);
export function toggleFav(id) { const f = rd(FK); const i = f.indexOf(id); if (i >= 0) f.splice(i, 1); else f.unshift(id); localStorage.setItem(FK, JSON.stringify(f.slice(0, 30))); return i < 0; }
