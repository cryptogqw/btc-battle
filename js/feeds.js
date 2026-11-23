// 行情数据层：Binance / OKX / Coinbase 公共 WebSocket（无需 API Key），自动故障切换
// 输出统一事件：trade / ticker / book / status
import { fetchJson, binFetch, binCanSpend, binBlockedFor } from './net.js?v=f98c16c9';


export const SOURCES = {
  binance: { name: 'Binance', quote: 'USDT' },
  okx: { name: 'OKX', quote: 'USDT' },
  coinbase: { name: 'Coinbase', quote: 'USD' },
};
export const COINS = { btc: 'BTC', eth: 'ETH' };
// m = 市场描述 { id, base, binance:'SOLUSDT'|null, okx:'SOL-USDT'|null, coinbase:'SOL-USD'|null }
export const AUTO_ORDER = ['binance', 'okx', 'coinbase'];

const BINANCE_HOSTS = [
  { ws: 'wss://stream.binance.com:443', rest: 'https://api.binance.com' },
  { ws: 'wss://stream.binance.com:9443', rest: 'https://api.binance.com' },
  { ws: 'wss://data-stream.binance.vision', rest: 'https://data-api.binance.vision' },
];

export class OrderBook {
  constructor() { this.bids = new Map(); this.asks = new Map(); this.ready = false; }
  clear() { this.bids.clear(); this.asks.clear(); this.ready = false; }
  set(side, price, qty) {
    const m = side === 'bid' ? this.bids : this.asks;
    if (qty <= 0) m.delete(price); else m.set(price, qty);
  }
  bestBid() { let b = -Infinity; for (const p of this.bids.keys()) if (p > b) b = p; return b; }
  bestAsk() { let a = Infinity; for (const p of this.asks.keys()) if (p < a) a = p; return a; }
  // 删除交叉/过期价位（快照外的残留），保持盘口一致
  prune() {
    const bb = this.bestBid(), ba = this.bestAsk();
    if (bb >= ba && isFinite(bb) && isFinite(ba)) {
      // 交叉时以较新的成交价附近为准：简单移除交叉部分
      const mid = (bb + ba) / 2;
      for (const p of this.bids.keys()) if (p >= mid) this.bids.delete(p);
      for (const p of this.asks.keys()) if (p <= mid) this.asks.delete(p);
    }
  }
}

// ---------------- Binance ----------------
function connectBinance(h, hostIdx, m) {
  const S = m.binance.toLowerCase();
  const host = BINANCE_HOSTS[hostIdx];
  const book = new OrderBook();
  let closed = false, ws, buffer = [], lastU = null, syncing = false, resyncTimer;
  const url = `${host.ws}/stream?streams=${S}@aggTrade/${S}@depth@100ms/${S}@miniTicker`;
  ws = new WebSocket(url);

  async function snapshot() {
    if (syncing || closed) return;
    syncing = true;
    try {
      // 5000 档（权重 250）覆盖更深；额度紧张时降到 1000 档（权重 50），再不够就稍后重试
      const lim = binCanSpend(250) ? 5000 : binCanSpend(50) ? 1000 : 0;
      if (!lim) { syncing = false; setTimeout(snapshot, Math.max(5000, binBlockedFor())); return; }
      const d = await binFetch(`${host.rest}/api/v3/depth?symbol=${m.binance}&limit=${lim}`, lim === 5000 ? 250 : 50);
      if (closed) return;
      book.clear();
      for (const [p, q] of d.bids) book.set('bid', +p, +q);
      for (const [p, q] of d.asks) book.set('ask', +p, +q);
      lastU = d.lastUpdateId;
      const pending = buffer; buffer = [];
      for (let i = 0; i < pending.length; i++) { applyDiff(pending[i], true); if (lastU == null) { buffer = pending.slice(i); break; } }
      // 快照比缓冲的增量还旧（中间缺包）→ 重新拉快照，否则盘口会一直停在旧状态直到下次定时刷新
      if (lastU == null) { syncing = false; setTimeout(snapshot, 500); return; }
      book.ready = true;
      h.onBook(book);
    } catch (e) {
      h.onLog && h.onLog('Binance 深度快照失败: ' + e.message);
      setTimeout(() => { syncing = false; snapshot(); }, Math.max(3000, binBlockedFor()));
      return;
    }
    syncing = false;
  }
  function applyDiff(ev, fromBuffer) {
    if (lastU == null) { buffer.push(ev); return; }
    if (ev.u <= lastU) return;
    if (ev.U > lastU + 1) { // 丢包，重新同步
      book.ready = false; lastU = null; buffer = [ev]; if (!fromBuffer) snapshot(); return;
    }
    for (const [p, q] of ev.b) book.set('bid', +p, +q);
    for (const [p, q] of ev.a) book.set('ask', +p, +q);
    lastU = ev.u;
    if (!fromBuffer) h.onBook(book);
  }

  ws.onopen = () => { h.onOpen(); snapshot(); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data); const s = m.stream, d = m.data;
    if (!d) return;
    if (s.endsWith('@aggTrade')) {
      h.onTrade({ price: +d.p, qty: +d.q, side: d.m ? 'sell' : 'buy', ts: d.T, id: d.a });
    } else if (s.endsWith('@depth@100ms')) {
      if (syncing || lastU == null) buffer.push(d); else applyDiff(d, false);
      if (buffer.length > 2000) buffer.splice(0, buffer.length - 2000);
    } else if (s.endsWith('@miniTicker')) {
      h.onTicker({ last: +d.c, open24h: +d.o, high24h: +d.h, low24h: +d.l, vol24h: +d.v, qv: +d.q });
    }
  };
  ws.onerror = () => {};
  ws.onclose = () => { if (!closed) h.onClose(); };
  // 定期刷新快照，补齐快照范围外的价位
  resyncTimer = setInterval(() => { if (!syncing && ws.readyState === 1) { lastU = null; snapshot(); } }, 120000);
  return { close() { closed = true; clearInterval(resyncTimer); try { ws.close(); } catch {} }, book };
}

// ---------------- OKX ----------------
function connectOKX(h, m) {
  const I = m.okx;
  const book = new OrderBook();
  let closed = false, pingT, bookT;
  const ws = new WebSocket('wss://ws.okx.com/ws/v5/public');
  async function pollBook() {
    if (document.hidden && book.ready) return; // 后台标签页暂停轮询（看不到盘口，省请求）
    try {
      const j = await fetchJson(`https://www.okx.com/api/v5/market/books-full?instId=${I}&sz=5000`);
      if (closed) return;
      const d = j.data && j.data[0]; if (!d) return;
      book.clear();
      for (const [p, q] of d.bids) book.set('bid', +p, +q);
      for (const [p, q] of d.asks) book.set('ask', +p, +q);
      book.ready = true; h.onBook(book);
    } catch (e) { h.onLog && h.onLog('OKX 深度获取失败: ' + e.message); }
  }
  ws.onopen = () => {
    ws.send(JSON.stringify({ op: 'subscribe', args: [
      { channel: 'trades', instId: I }, { channel: 'tickers', instId: I }] }));
    pingT = setInterval(() => ws.readyState === 1 && ws.send('ping'), 20000);
    h.onOpen(); pollBook(); bookT = setInterval(pollBook, 2500);
  };
  ws.onmessage = (e) => {
    if (e.data === 'pong') return;
    const m = JSON.parse(e.data); if (!m.data || !m.arg) return;
    if (m.arg.channel === 'trades') {
      for (const t of m.data) h.onTrade({ price: +t.px, qty: +t.sz, side: t.side, ts: +t.ts });
    } else if (m.arg.channel === 'tickers') {
      const t = m.data[0];
      h.onTicker({ last: +t.last, open24h: +t.open24h, high24h: +t.high24h, low24h: +t.low24h, vol24h: +t.vol24h, qv: +t.volCcy24h });
    }
  };
  ws.onerror = () => {};
  ws.onclose = () => { clearInterval(pingT); clearInterval(bookT); if (!closed) h.onClose(); };
  return { close() { closed = true; clearInterval(pingT); clearInterval(bookT); try { ws.close(); } catch {} }, book };
}

// ---------------- Coinbase ----------------
function connectCoinbase(h, m) {
  const P = m.coinbase;
  const book = new OrderBook();
  let closed = false, lastEmit = 0;
  const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'subscribe', product_ids: [P], channels: ['matches', 'ticker', 'level2_batch'] }));
    h.onOpen();
  };
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    switch (d.type) {
      case 'match': // side 为挂单方方向，主动方相反
        h.onTrade({ price: +d.price, qty: +d.size, side: d.side === 'sell' ? 'buy' : 'sell', ts: Date.parse(d.time) });
        break;
      case 'ticker':
        h.onTicker({ last: +d.price, open24h: +d.open_24h, high24h: +d.high_24h, low24h: +d.low_24h, vol24h: +d.volume_24h, qv: +d.volume_24h * +d.price });
        break;
      case 'snapshot':
        book.clear();
        for (const [p, q] of d.bids) book.set('bid', +p, +q);
        for (const [p, q] of d.asks) book.set('ask', +p, +q);
        book.ready = true; h.onBook(book); break;
      case 'l2update': {
        for (const [s, p, q] of d.changes) book.set(s === 'buy' ? 'bid' : 'ask', +p, +q);
        const now = Date.now(); if (now - lastEmit > 100) { lastEmit = now; h.onBook(book); }
        break;
      }
      case 'error': h.onLog && h.onLog('Coinbase: ' + d.message); break;
    }
  };
  ws.onerror = () => {};
  ws.onclose = () => { if (!closed) h.onClose(); };
  return { close() { closed = true; try { ws.close(); } catch {} }, book };
}

const CONNECTORS = { binance: connectBinance, okx: connectOKX, coinbase: connectCoinbase };

/**
 * 带自动切换的行情管理器
 * mode: 'auto' | 'binance' | 'okx' | 'coinbase'
 */
export class FeedManager {
  constructor(handlers) {
    this.h = handlers; this.conn = null; this.mode = 'auto';
    this.order = AUTO_ORDER; this.idx = 0; this.binanceHost = 0;
    this.lastData = 0; this.fails = 0; this.gen = 0;
    this.watchdog = setInterval(() => this._check(), 2000);
  }
  start(mode = 'auto', market = this.market) {
    this.market = market;
    const avail = AUTO_ORDER.filter(s => market[s]);
    if (mode !== 'auto' && !market[mode]) mode = 'auto'; // 该交易所没有这个币 → 自动
    this.mode = mode;
    this.order = mode === 'auto' ? avail : [mode];
    this.idx = 0; this.binanceHost = 0; this.fails = 0;
    this._connect();
  }
  get source() { return this.order[this.idx]; }
  _connect() {
    if (this.conn) this.conn.close();
    const gen = ++this.gen;
    const src = this.source;
    this.openedAt = Date.now(); this.lastData = 0; this.gotData = false;
    const label = SOURCES[src].name + (src === 'binance' && this.binanceHost === 2 ? ' (vision)' : '');
    this.h.onStatus('connecting', label, src);
    const guard = (fn) => (...a) => { if (gen === this.gen) fn(...a); };
    const hh = {
      onOpen: guard(() => this.h.onStatus('open', label, src)),
      onClose: guard(() => this._fail('eClosed')),
      onTrade: guard((t) => { this._alive(label, src); this.h.onTrade(t, src); }),
      onTicker: guard((t) => { this._alive(label, src); this.h.onTicker(t, src); }),
      onBook: guard((b) => { this._alive(label, src); this.h.onBook(b, src); }), // 冷门币可能很久没成交，盘口更新也算“在线”
      onLog: (m) => console.warn(m),
    };
    try {
      this.conn = src === 'binance' ? CONNECTORS.binance(hh, this.binanceHost, this.market) : CONNECTORS[src](hh, this.market);
    } catch (e) { this._fail(e.message); }
  }
  _alive(label, src) {
    this.lastData = Date.now();
    if (!this.gotData) { this.gotData = true; this.fails = 0; this.h.onStatus('live', label, src); }
  }
  _check() {
    if (!this.conn) return;
    const now = Date.now();
    if (!this.gotData && now - this.openedAt > 9000) this._fail('eTimeout');
    else if (this.gotData && now - this.lastData > 20000) this._fail('eStall');
  }
  _fail(reason) {
    const gen = this.gen;
    this.h.onStatus('error', reason, this.source);
    this.fails++;
    // Binance 先尝试备用域名
    if (this.source === 'binance' && this.binanceHost < BINANCE_HOSTS.length - 1 && !this.gotData) this.binanceHost++;
    else if (this.mode === 'auto' && (this.fails >= 2 || !this.gotData)) {
      this.idx = (this.idx + 1) % this.order.length; this.binanceHost = 0; this.fails = 0;
    }
    if (this.conn) { this.conn.close(); this.conn = null; }
    const delay = Math.min(1000 * Math.pow(1.6, this.fails), 10000);
    setTimeout(() => { if (gen === this.gen) this._connect(); }, delay);
  }
  stop() { clearInterval(this.watchdog); if (this.conn) this.conn.close(); this.conn = null; this.gen++; }
}

// Binance 最近 N 秒的 1 秒 K 线（含主动买入量），用于开页时回填 10秒/1分钟/5分钟 窗口
// 返回 [{ t: 开盘毫秒(交易所时间), c: 收盘价, v: 成交量, tb: 主动买入量, q: 成交额, tbq: 主动买入额, n: 笔数 }]
export async function fetchBinance1s(m, hostIdx = 0, limit = 300) {
  const hosts = [BINANCE_HOSTS[hostIdx].rest, ...BINANCE_HOSTS.map(h => h.rest)].filter((v, i, a) => a.indexOf(v) === i);
  for (const host of hosts) {
    try {
      const k = await binFetch(`${host}/api/v3/klines?symbol=${m.binance}&interval=1s&limit=${limit}`, 2, 6000);
      return k.map(x => ({ t: x[0], c: +x[4], v: +x[5], q: +x[7], n: x[8], tb: +x[9], tbq: +x[10] }));
    } catch (e) { if (e.rate) return null; }
  }
  return null;
}

// Binance 逐笔成交（aggTrades）：从 beforeId 往回翻页，直到早于 sinceMs、到达 afterId 或翻满 maxPages 页
// 返回按 id 升序、id 在 (afterId, beforeId) 之间的成交 [{ id, p, q, T, m }]
export async function fetchBinanceAggTrades(m, hostIdx, beforeId, sinceMs, afterId = 0, maxPages = 15, alive = () => true) {
  const host = BINANCE_HOSTS[hostIdx].rest, S = m.binance;
  let out = [], from = Math.max(afterId + 1, beforeId - 1000);
  try {
    for (let i = 0; i < maxPages; i++) {
      const lim = Math.min(1000, beforeId - from);
      if (lim <= 0) break;
      if (!alive()) return null; // 已切换币种 → 停止翻页，省下请求权重
      if (!binCanSpend(4 + 200)) break; // 每页权重 4；给盘口快照留余量，额度不足就只用已拿到的部分
      const a = await binFetch(`${host}/api/v3/aggTrades?symbol=${S}&fromId=${from}&limit=${lim}`, 4, 8000);
      const rows = a.filter(x => x.a < beforeId && x.a > afterId).map(x => ({ id: x.a, p: +x.p, q: +x.q, T: x.T, m: x.m }));
      out = rows.concat(out);
      if (!a.length || from <= afterId + 1 || (sinceMs && a[0].T < sinceMs)) break;
      beforeId = from; from = Math.max(afterId + 1, from - 1000);
    }
  } catch (e) { if (!out.length) return null; }
  return sinceMs ? out.filter(x => x.T >= sinceMs) : out;
}

// 双币迷你行情（REST 轮询，独立于主连接）：返回 { btc:{last,chg}, eth:{last,chg} }
export async function fetchMiniTickers() {
  const tries = [
    async () => {
      for (const host of ['https://api.binance.com', 'https://data-api.binance.vision']) {
        try {
          const j = await binFetch(`${host}/api/v3/ticker/24hr?symbols=${encodeURIComponent('["BTCUSDT","ETHUSDT"]')}&type=MINI`, 4, 5000);
          const o = {};
          for (const t of j) o[t.symbol === 'BTCUSDT' ? 'btc' : 'eth'] = { last: +t.lastPrice, chg: (+t.lastPrice / +t.openPrice - 1) * 100 };
          return o;
        } catch {}
      }
      throw new Error('binance');
    },
    async () => {
      const o = {};
      for (const c of ['btc', 'eth']) {
        const j = await fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${c.toUpperCase()}-USDT`, 5000);
        const t = j.data[0]; o[c] = { last: +t.last, chg: (+t.last / +t.open24h - 1) * 100 };
      }
      return o;
    },
  ];
  for (const f of tries) { try { return await f(); } catch {} }
  return null;
}
