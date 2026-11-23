// 中英文切换：?lang=zh|en > localStorage > 浏览器语言（zh* → 中文，其它 → 英文）
const KEY = 'cw_lang';
export const escH = (x) => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function detect() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q && /^(zh|en)/i.test(q)) return q.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const s = localStorage.getItem(KEY); if (s === 'zh' || s === 'en') return s;
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  return /^zh/i.test(nav) ? 'zh' : 'en';
}
export let lang = detect();
const subs = [];
export function onLang(fn) { subs.push(fn); }
export function setLang(l) {
  if (l !== 'zh' && l !== 'en') return;
  lang = l; localStorage.setItem(KEY, l);
  const u = new URL(location.href); u.searchParams.set('lang', l); history.replaceState(null, '', u);
  applyI18n(); subs.forEach(f => f(l));
}

// 金额：中文 万/亿，英文 K/M/B
export function fmtUsd(v) {
  if (lang === 'en') {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e8 ? 0 : 2) + 'M';
    if (v >= 1e4) return '$' + (+(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)) + 'K';
    return '$' + Math.round(v).toLocaleString('en-US');
  }
  if (v >= 1e8) return '$' + (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return '$' + (+(v / 1e4).toFixed(v >= 1e6 ? 0 : 1)) + '万';
  return '$' + Math.round(v).toLocaleString('en-US');
}
// 数量（不带 $）：中文 万/亿，英文 K/M/B
export function fmtNum(v) {
  if (lang === 'en') return v >= 1e12 ? (v / 1e12).toFixed(2) + 'T' : v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(+v.toFixed(2));
  return v >= 1e12 ? (v / 1e12).toFixed(2) + '万亿' : v >= 1e8 ? (v / 1e8).toFixed(2) + '亿' : v >= 1e4 ? (v / 1e4).toFixed(1) + '万' : String(+v.toFixed(2));
}
// 门槛筹码（不带 $）
export function fmtShort(v) {
  if (lang === 'en') return v >= 1e6 ? +(v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? +(v / 1e3).toFixed(1) + 'K' : String(Math.round(v));
  return v >= 1e4 ? +(v / 1e4).toFixed(1) + '万' : Math.round(v).toLocaleString();
}

const D = {
  zh: {
    title: (p) => `${p ? p + ' · ' : ''}Crypto War · 多空战场 | 加密货币实时多空对决`,
    metaDesc: 'Crypto War · 多空战场：BTC / ETH 实时价格、挂单与吃单对决，蓝军（多）vs 红军（空）动画战场。by 大橙子 @0xVeryBigOrange',
    introSub: '多 空 战 场', introGo: '⚔️ 点击进入战场 🔊', introHint: '实时行情驱动 · 战鼓随多空节奏变化',
    introGather: '集结部队中…', introConn: (l) => `连接战场情报 · ${l}…`, introScout: '侦察敌情中…', introReady: '部队就位',
    introStart: '⚔️ 战斗开始！', introClick: '战鼓已备好 · 点击开战',
    home: 'Crypto War 首页', wmCn: '多空战场', byTitle: '关注作者 大橙子 @0xVeryBigOrange', byName: '大橙子',
    connecting: '连接中…', source: '数据源', auto: '自动', music: '♪ 配乐',
    audioTitle: '战争配乐 / 音效', audioAria: '战争配乐与音效', apTitle: '⚔️ 战争配乐 <small>随实时战况变化</small>',
    apMusic: '🎵 音乐', apSfx: '💥 音效', apVol: '🔊 音量',
    apNote: '太鼓 + 铜管实时合成，全部由行情驱动：成交越快鼓点越快（BPM）；价格每跳一下弹一个音，涨则上行、跌则下行；1 分钟涨跌决定明暗调；每笔大单：人族魔法师施法一声法术吟鸣、兽族飞龙喷火一声龙吼，落地再一声爆炸；巨鲸是陨火呼啸坠落；总攻、胜利各有专属音效。切到后台自动暂停。',
    followX: '关注 @0xVeryBigOrange', langTitle: '切换语言 / Language',
    tps: (n) => `${n} 笔/秒`, hi: '高', lo: '低', vol24: '24h 量',
    flagL: '多', flagS: '空', blue: '蓝军', red: '红军', power: '战力',
    stTie: '⚖️ 两军对峙', stBlue: '🔵 蓝军推进', stRed: '🔴 红军压制', stSurgeB: '🔥 蓝军总攻', stSurgeR: '🔥 红军总攻',
    basisTitle: '战力 = 价格涨跌 50%（10秒 + 1分钟）+ 吃单 30%（10秒 + 1分钟）+ ±0.5% 挂单 20%',
    basisWait: '战况依据：等待数据…', basis: '战况依据：', b10: '10秒', b60: '1分钟', bOnly: (n) => `(仅${n}秒)`, bLast: '最新', bTk: '吃单买:卖', bBk: '挂单买:卖',
    hudL: '蓝军 · 买方', hudR: '卖方 · 红军',
    legend: (a, b, c) => `士兵 = 成交 · 🔮法球 / 🐉龙焰 ≥ $${a} · 强力法术 ≥ $${b} · 🐋 天降陨火 ≥ $${c}`,
    taker: '吃单', takerSub: '主动成交 · 谁在冲锋', w10: '10 秒', w60: '1 分钟', w300: '5 分钟', delta: '5 分钟净主动买入',
    only: (n) => `仅${n}秒`, cover: (p) => `仅覆盖±${p}%`, buy: '买', sell: '卖', bid: '买盘', ask: '卖盘',
    book: '挂单', bookSub: '盘口深度 · 谁的城墙厚', bb: '买一', ba: '卖一', spr: '价差',
    trades: '大单战报', thTitle: '大单门槛（单笔主动成交金额）', hTime: '时间', hSide: '方向', hPx: '价格', hQty: '数量', hUsd: '金额',
    sideBuy: '多 买', sideSell: '空 卖',
    waitBig: '等待大单出现…', loadingBig: '正在加载最近的大单…',
    noBig: (m, th) => `近 ${m} 分钟没有 ≥ $${th} 的大单<br><small>行情清淡，可点上方调低门槛</small>`,
    bigSince: (m) => `已载入近 ${m} 分钟 · 同一毫秒同方向的成交合并为一笔主动单`,
    auSub: 'Crypto War · 多空战场 作者', ghSrc: 'GitHub 源码',
    disclaimer: '数据来自 Binance / OKX / Coinbase 公共行情（无需 API Key），仅供娱乐参考，不构成投资建议 · 蓝 = 多 / 买方，红 = 空 / 卖方',
    flowCap: '近 2 分钟 主动买(上) / 卖(下) · 黄线=累计净额', depthWait: '等待盘口数据…', wallB: '买盘城墙 ', wallA: '卖盘城墙 ',
    depthCover: (p) => `该数据源深度覆盖约 ±${p}%`,
    sConnecting: (l) => `正在连接 ${l}…`, sOpen: (l) => `已连接 ${l}，等待数据…`, sLive: (l) => `实时 · ${l}`, sError: (n, r) => `${n} ${r}，重试/切换中…`,
    eClosed: '连接断开', eTimeout: '超时无数据', eStall: '数据中断', sOffline: '网络已断开，恢复后自动重连…',
    toCoin: (c) => `⚔️ 转战 ${c} 战场`,
    whale: (b, u) => `🐋 ${b ? '人族' : '兽族'}巨鲸 · 天降陨火<small>${b ? '主动买入' : '主动卖出'} ${u}</small>`,
    surgeB: '⚔️ 蓝军发起总攻！<small>多头主动出击</small>', surgeR: '⚔️ 红军发起总攻！<small>空头主动出击</small>',
    winB: (s) => `🏆 蓝军大获全胜！<small>多头压制 ${s} 秒 · 红军溃退</small>`, winR: (s) => `🏆 红军大获全胜！<small>空头压制 ${s} 秒 · 蓝军溃退</small>`,
    streak: (b, s, w) => `${b ? '蓝军' : '红军'}已压制 ${s} 秒${w ? ' 🏆' : ''}`,
    mSurgeB: '蓝军总攻', mSurgeR: '红军总攻', mUp: '蓝军上扬', mDown: '红军下压', mTie: '两军对峙',
    notFound: (c) => `🔍 没有找到币种 ${escH(c)}<small>换个代码试试，比如 SOL、DOGE、PEPE</small>`,
    search: '搜索币种', searchPh: '搜索币种：代码或名称，如 SOL、狗狗币、PEPE', searchKey: '搜索币种 (按 /)',
    sFav: '⭐ 收藏', sRecent: '🕘 最近', sHot: '🔥 热门（24h 成交额）', sLoading: '正在加载币种列表…', sNone: (q) => `没有找到「${q}」`,
    sFoot: (n) => `共 ${n} 个币种 · Binance / OKX / Coinbase 现货 · ↑↓ 选择 · Enter 打开 · Esc 关闭`, sFavT: '收藏 / 取消收藏', sVol: '额',
    mLocked: '🔊 点击开启战歌', mOff: '配乐已关', mSfx: '💥 音效', crit: '暴击 ',
    chatT: '战场喊单', chatSub: '匿名 · 实时 · 弹幕', chatPh: '说点什么… 喊单、吐槽都行（最多 140 字）', chatNickPh: '昵称', chatNickT: '昵称（可选，保存在本机）',
    chatLong: '喊多 🟦', chatShort: '喊空 🟥', chatSend: '发送', chatLongDef: '多军冲锋！🚀', chatShortDef: '空军砸盘！📉',
    chatLoading: '正在连接喊单频道…', chatEmpty: '还没有人喊单，来抢沙发！', chatDown: '评论暂不可用，稍后自动重试（不影响战场）',
    chatRate: '喊太快了，歇 3 秒再来', chatRateG: '战场太热闹了，稍等几秒再喊', chatErr: '发送失败，请重试', chatEmptyBody: '先写点内容',
    dmOn: '弹幕 开', dmOff: '弹幕 关', dmT: '弹幕开关', sndOn: '🔊 声音', sndOff: '🔇 静音', sndT: '声音开关（快捷键 M）',
    camWide: '🎥 全景', camFollow: '🎥 跟随前线', camT: '镜头：全景 / 跟随前线（放大交战处）',
    wx_storm: '⛈️ 暴风雨', wx_erupt: '🌋 火山喷发', wx_blood: '🩸 血月', wx_bloodDay: '🔴 赤日', wx_glory: '✨ 圣光', wx_fog: '🌫️ 薄雾', wx_clear: '☀️ 晴朗', wx_clearN: '🌙 晴夜',
    wxVol: (r) => `波动是平时的 ${r} 倍`, wxCh: (p) => `2 分钟 ${p}`, wxQuiet: '成交清淡', wxCalm: '行情平稳',
    wxT: '天气随行情变化：波动大 → 暴风雨；急跌 → 火山喷发，跌得更深 → 血月；急涨 → 圣光；成交清淡 → 起雾；24 小时涨跌决定整体色调', chatLive: '实时', chatOff: '重连中', chatMe: '我', chatSideBull: '多', chatSideBear: '空', chatNickPre: '韭菜',
    chatNote: '匿名发言，内容为网友观点，不代表本站，不构成投资建议',
  },
  en: {
    title: (p) => `${p ? p + ' · ' : ''}Crypto War · Bulls vs Bears | Live crypto battle`,
    metaDesc: 'Crypto War: live BTC / ETH price, order book and taker flow as an animated battle — Blue Army (bulls) vs Red Army (bears). by 大橙子 (Big Orange) @0xVeryBigOrange',
    introSub: 'BULLS · VS · BEARS', introGo: '⚔️ Enter the battlefield 🔊', introHint: 'Driven by live market data · the drums follow the bulls and bears',
    introGather: 'Mustering the troops…', introConn: (l) => `Connecting to ${l}…`, introScout: 'Scouting the enemy…', introReady: 'Troops in position',
    introStart: '⚔️ Battle begins!', introClick: 'War drums ready · click to fight',
    home: 'Crypto War home', wmCn: 'Bulls vs Bears', byTitle: 'Follow the creator 大橙子 (Big Orange) @0xVeryBigOrange', byName: '大橙子 · Big Orange',
    connecting: 'Connecting…', source: 'Data source', auto: 'Auto', music: '♪ Music',
    audioTitle: 'War music / SFX', audioAria: 'War music and sound effects', apTitle: '⚔️ War music <small>follows the live battle</small>',
    apMusic: '🎵 Music', apSfx: '💥 SFX', apVol: '🔊 Volume',
    apNote: 'Taiko drums + brass synthesized live, all driven by the market: faster trading → faster drums (BPM); every price tick plays a note, up when price rises, down when it falls; the 1-minute change sets major/minor mood; every big trade is a spell chime (human wizard) or a dragon roar (orc dragon), then a blast when it lands; whales whistle down as meteors; surges and victories have their own sounds. Pauses automatically in the background.',
    followX: 'Follow @0xVeryBigOrange', langTitle: 'Language / 切换语言',
    tps: (n) => `${n} trades/s`, hi: 'H', lo: 'L', vol24: '24h Vol',
    flagL: 'L', flagS: 'S', blue: 'Blue', red: 'Red', power: ' power',
    stTie: '⚖️ Standoff', stBlue: '🔵 Blue advances', stRed: '🔴 Red presses', stSurgeB: '🔥 Blue charge', stSurgeR: '🔥 Red charge',
    basisTitle: 'Power = price change 50% (10s + 1m) + taker flow 30% (10s + 1m) + order book within ±0.5% 20%',
    basisWait: 'Why: waiting for data…', basis: 'Why: ', b10: '10s', b60: '1m', bOnly: (n) => `(only ${n}s)`, bLast: 'Last', bTk: 'Taker buy:sell', bBk: 'Book bid:ask',
    hudL: 'Blue Army · Buyers', hudR: 'Sellers · Red Army',
    legend: (a, b, c) => `Troops = trades · 🔮 Orb / 🐉 Dragonfire ≥ $${a} · Big spell ≥ $${b} · 🐋 Meteor storm ≥ $${c}`,
    taker: 'Takers', takerSub: 'Market orders · who is charging', w10: '10s', w60: '1 min', w300: '5 min', delta: '5-min net taker buy',
    only: (n) => `only ${n}s`, cover: (p) => `covers only ±${p}%`, buy: 'Buy', sell: 'Sell', bid: 'Bids', ask: 'Asks',
    book: 'Order Book', bookSub: 'Depth · whose wall is thicker', bb: 'Bid', ba: 'Ask', spr: 'Spread',
    trades: 'Big Trades', thTitle: 'Big-trade threshold (taker order value)', hTime: 'Time', hSide: 'Side', hPx: 'Price', hQty: 'Size', hUsd: 'Value',
    sideBuy: 'BUY', sideSell: 'SELL',
    waitBig: 'Waiting for big trades…', loadingBig: 'Loading recent big trades…',
    noBig: (m, th) => `No trades ≥ $${th} in the last ${m} min<br><small>Quiet market — lower the threshold above</small>`,
    bigSince: (m) => `Last ${m} min loaded · fills in the same millisecond and side are merged into one taker order`,
    auSub: 'Creator of Crypto War · Bulls vs Bears', ghSrc: 'GitHub source',
    disclaimer: 'Data from Binance / OKX / Coinbase public market feeds (no API key). For entertainment only, not investment advice · Blue = bulls / buyers, Red = bears / sellers',
    flowCap: 'Last 2 min · taker buys (up) / sells (down) · yellow = cumulative net', depthWait: 'Waiting for order book…', wallB: 'Bid wall ', wallA: 'Ask wall ',
    depthCover: (p) => `This source covers about ±${p}% depth`,
    sConnecting: (l) => `Connecting to ${l}…`, sOpen: (l) => `Connected to ${l}, waiting for data…`, sLive: (l) => `Live · ${l}`, sError: (n, r) => `${n} ${r}, retrying / switching…`,
    eClosed: 'connection lost', eTimeout: 'no data (timeout)', eStall: 'data stalled', sOffline: 'You are offline, will reconnect automatically…',
    toCoin: (c) => `⚔️ Moving to the ${c} front`,
    whale: (b, u) => `🐋 ${b ? 'Human' : 'Orc'} whale · meteor storm<small>${b ? 'Taker buy' : 'Taker sell'} ${u}</small>`,
    surgeB: '⚔️ Blue launches an all-out attack!<small>Bulls on the offensive</small>', surgeR: '⚔️ Red launches an all-out attack!<small>Bears on the offensive</small>',
    winB: (s) => `🏆 Blue Army wins!<small>Bulls held the field for ${s}s · Red retreats</small>`, winR: (s) => `🏆 Red Army wins!<small>Bears held the field for ${s}s · Blue retreats</small>`,
    streak: (b, s, w) => `${b ? 'Blue' : 'Red'} dominating for ${s}s${w ? ' 🏆' : ''}`,
    mSurgeB: 'Blue charge', mSurgeR: 'Red charge', mUp: 'Blue rising', mDown: 'Red pressing', mTie: 'Standoff',
    notFound: (c) => `🔍 Coin ${escH(c)} not found<small>Try a ticker like SOL, DOGE or PEPE</small>`,
    search: 'Search coins', searchPh: 'Search coins: ticker or name, e.g. SOL, dogecoin, PEPE', searchKey: 'Search coins (press /)',
    sFav: '⭐ Favorites', sRecent: '🕘 Recent', sHot: '🔥 Top by 24h volume', sLoading: 'Loading coin list…', sNone: (q) => `No coins match “${q}”`,
    sFoot: (n) => `${n} coins · Binance / OKX / Coinbase spot · ↑↓ select · Enter open · Esc close`, sFavT: 'Add / remove favorite', sVol: 'Vol',
    mLocked: '🔊 Tap to start war music', mOff: 'Music off', mSfx: '💥 SFX', crit: 'CRIT ',
    chatT: 'Battle Chat', chatSub: 'anonymous · live · danmaku', chatPh: 'Say something… call your trade (max 140)', chatNickPh: 'Nickname', chatNickT: 'Nickname (optional, saved on this device)',
    chatLong: 'Long 🟦', chatShort: 'Short 🟥', chatSend: 'Send', chatLongDef: 'Bulls charge! 🚀', chatShortDef: 'Bears dump! 📉',
    chatLoading: 'Connecting to the chat…', chatEmpty: 'No calls yet — be the first!', chatDown: 'Comments unavailable right now, retrying (the battle is unaffected)',
    chatRate: 'Too fast — wait 3 seconds', chatRateG: 'The battlefield is busy, try again in a few seconds', chatErr: 'Send failed, please retry', chatEmptyBody: 'Write something first',
    dmOn: 'Danmaku on', dmOff: 'Danmaku off', dmT: 'Toggle flying comments', sndOn: '🔊 Sound', sndOff: '🔇 Muted', sndT: 'Toggle sound (M)',
    camWide: '🎥 Wide', camFollow: '🎥 Follow', camT: 'Camera: wide view / follow the front line',
    wx_storm: '⛈️ Storm', wx_erupt: '🌋 Eruption', wx_blood: '🩸 Blood moon', wx_bloodDay: '🔴 Red sun', wx_glory: '✨ Holy light', wx_fog: '🌫️ Mist', wx_clear: '☀️ Clear', wx_clearN: '🌙 Clear night',
    wxVol: (r) => `volatility ${r}× normal`, wxCh: (p) => `2 min ${p}`, wxQuiet: 'thin trading', wxCalm: 'calm market',
    wxT: 'Weather follows the market: high volatility → storm; sharp drop → volcano erupts, deeper → blood moon; sharp rally → holy light; thin trading → mist; the 24h change sets the overall tone', chatLive: 'Live', chatOff: 'Reconnecting', chatMe: 'me', chatSideBull: 'Long', chatSideBear: 'Short', chatNickPre: 'Degen',
    chatNote: 'Anonymous posts are visitors\' opinions, not financial advice',
  },
};
export function t(key, ...a) {
  const v = D[lang][key] ?? D.zh[key];
  return typeof v === 'function' ? v(...a) : v;
}
// HTML 标记：data-i18n=文本 / data-i18n-html / data-i18n-title / data-i18n-aria
export function applyI18n(root = document) {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  const md = document.querySelector('meta[name="description"]'); if (md) md.content = t('metaDesc');
  document.querySelectorAll('[data-lang]').forEach(b => b.classList.toggle('on', b.dataset.lang === lang));
}
