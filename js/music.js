// Crypto War 战争配乐：Web Audio API 实时合成（无外部音频文件，无版权问题）
// 太鼓/定音鼓 + 低音铜管/弦乐铺底（D 小调），速度与层次随实时战况变化。
// 同一套代码既可用于实时 AudioContext，也可用于 OfflineAudioContext 渲染演示。

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 和弦（MIDI）
const CH = {
  Dm: [50, 53, 57], Bb: [46, 50, 53], C: [48, 52, 55], A: [45, 49, 52], Gm: [43, 46, 50], F: [41, 45, 48], D: [50, 54, 57],
};
const PROG = {
  blue: ['Dm', 'Bb', 'C', 'Dm'],   // 上行、明亮
  neutral: ['Dm', 'Dm', 'Bb', 'A'],
  red: ['Dm', 'C', 'Bb', 'A'],     // 下行、阴暗
};
// 太鼓节奏（16 分音符位置 → 力度），按强度等级
const TAIKO = [
  { 0: 1, 8: 0.65 },
  { 0: 1, 6: 0.6, 8: 0.85, 12: 0.6 },
  { 0: 1, 3: 0.55, 6: 0.75, 8: 0.95, 10: 0.55, 12: 0.8, 14: 0.6 },
  { 0: 1, 2: 0.5, 3: 0.6, 4: 0.8, 6: 0.7, 8: 1, 10: 0.6, 11: 0.55, 12: 0.85, 13: 0.6, 14: 0.75, 15: 0.85 },
];
const OSTINATO = [0, 0, 12, 0, 0, 0, 12, 7]; // 8 分音符弦乐顿弓

export class WarMusic {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = { intensity: 0.15, bias: 0, surge: null, bpm: 80 };
    this.tickQ = 0; this.deg = 7; // 价格逐笔涨跌 → 旋律音阶位置
    this.volume = 0.75; this.musicOn = false; this.sfxOn = false;
    this._build();
    this.step = 0; this.bar = 0; this.nextT = 0; this.stepDur = 0.2;
  }

  // ---------- 音频图 ----------
  _build() {
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -18; this.comp.knee.value = 8; this.comp.ratio.value = 3.5;
    this.comp.attack.value = 0.008; this.comp.release.value = 0.25;
    this.master = c.createGain(); this.master.gain.value = this.volume * 0.9;
    this.comp.connect(this.master).connect(c.destination);
    this.an = c.createAnalyser(); this.an.fftSize = 1024; this.master.connect(this.an); this._abuf = new Float32Array(1024);
    this.mix = c.createGain(); this.mix.connect(this.comp);
    this.music = c.createGain(); this.music.gain.value = 0; this.music.connect(this.mix);
    this.sfx = c.createGain(); this.sfx.gain.value = 0; this.sfx.connect(this.mix);
    // 混响（程序生成脉冲响应）
    this.verb = c.createConvolver(); this.verb.buffer = this._impulse(3.2, 2.6);
    this.verbRet = c.createGain(); this.verbRet.gain.value = 0.55;
    this.verb.connect(this.verbRet).connect(this.mix);
    this.verbSendM = c.createGain(); this.verbSendM.gain.value = 1; this.verbSendM.connect(this.verb);
    this.verbSendS = c.createGain(); this.verbSendS.gain.value = 1; this.verbSendS.connect(this.verb);
    // 白噪声
    const n = c.sampleRate * 2, nb = c.createBuffer(1, n, c.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb;
  }
  _impulse(sec, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len; lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45; // 轻微低通，更温暖
        d[i] = lp * Math.pow(1 - t, decay) * (i < c.sampleRate * 0.012 ? i / (c.sampleRate * 0.012) : 1);
      }
    }
    return b;
  }
  // 输出到 音乐/音效 总线，并按比例送混响
  _out(node, bus, send) {
    const dry = bus === 'sfx' ? this.sfx : this.music;
    node.connect(dry);
    if (send > 0) { const g = this.ctx.createGain(); g.gain.value = send; node.connect(g); g.connect(bus === 'sfx' ? this.verbSendS : this.verbSendM); }
  }
  _noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    s.start(t, Math.random() * 1.5, dur + 0.05); return s;
  }

  // ---------- 乐器 ----------
  taiko(t, vel = 1, bus = 'music', big = 1) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150 * big, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.22);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * vel, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g); o.start(t); o.stop(t + 1.2);
    // 鼓皮击打噪声
    const nz = this._noiseSrc(t, 0.12), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.5 * vel, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    nz.connect(lp).connect(ng);
    // 共鸣泛音
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.setValueAtTime(95, t); o2.frequency.exponentialRampToValueAtTime(70, t + 0.4);
    const g2 = c.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.18 * vel, t + 0.01); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o2.connect(g2); o2.start(t); o2.stop(t + 0.7);
    // 中频鼓腔（手机/笔记本扬声器也能听到）
    const o3 = c.createOscillator(); o3.type = 'triangle'; o3.frequency.setValueAtTime(240 * big, t); o3.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    const g3 = c.createGain(); g3.gain.setValueAtTime(0.0001, t); g3.gain.exponentialRampToValueAtTime(0.32 * vel, t + 0.004); g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o3.connect(g3); o3.start(t); o3.stop(t + 0.32);
    this._out(g, bus, 0.35); this._out(ng, bus, 0.3); this._out(g2, bus, 0.3); this._out(g3, bus, 0.25);
  }
  tom(t, vel = 1) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.15);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * vel, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); o.start(t); o.stop(t + 0.4);
    const nz = this._noiseSrc(t, 0.15), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.3 * vel, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    nz.connect(bp).connect(ng);
    this._out(g, 'music', 0.3); this._out(ng, 'music', 0.35);
  }
  shaker(t, vel = 1) {
    const c = this.ctx, nz = this._noiseSrc(t, 0.06), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = c.createGain(); g.gain.setValueAtTime(0.06 * vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    nz.connect(hp).connect(g); this._out(g, 'music', 0.1);
  }
  cymbal(t, dur = 2.5, vel = 1, swell = false, bus = 'music') {
    const c = this.ctx, nz = this._noiseSrc(t, dur), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5200;
    const g = c.createGain();
    if (swell) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09 * vel, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.03); }
    else { g.gain.setValueAtTime(0.12 * vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
    nz.connect(hp).connect(g); this._out(g, bus, 0.45);
  }
  // 弦乐铺底（多锯齿波失谐 + 低通）
  pad(t, notes, dur, bright) {
    const c = this.ctx, lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + 1600 * bright; lp.Q.value = 0.5;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); const pv = 0.045 + 0.035 * bright; g.gain.linearRampToValueAtTime(pv, t + 0.5);
    g.gain.setValueAtTime(pv, t + dur - 0.2); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.9);
    lp.connect(g);
    for (const m of notes) for (const det of [-9, 0, 8]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 1);
    }
    this._out(g, 'music', 0.6);
  }
  drone(t, root, dur, amt) {
    const c = this.ctx, lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320 + 380 * amt;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); const dv = 0.07 + 0.08 * amt; g.gain.linearRampToValueAtTime(dv, t + 0.3);
    g.gain.setValueAtTime(dv, t + dur - 0.1); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.5);
    lp.connect(g);
    for (const [type, m, det] of [['sawtooth', root - 12, -5], ['sawtooth', root - 12, 6], ['sine', root - 24, 0], ['sawtooth', root, 0]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = mtof(m); o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + dur + 0.6);
    }
    this._out(g, 'music', 0.15);
  }
  // 顿弓
  stab(t, m, vel = 1, len = 0.13) {
    const c = this.ctx, lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07 * vel, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    lp.connect(g);
    for (const det of [-6, 6]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + len + 0.05); }
    this._out(g, 'music', 0.3);
  }
  // 铜管（滤波包络 + 颤音）
  brass(t, m, dur, vel = 1, glideTo = null, bus = 'music') {
    const c = this.ctx, lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(350, t); lp.frequency.linearRampToValueAtTime(900 + 2300 * vel, t + 0.09); lp.frequency.linearRampToValueAtTime(1100 + 900 * vel, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.085 * vel, t + 0.06);
    g.gain.setValueAtTime(0.075 * vel, t + dur - 0.05); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.25);
    lp.connect(g);
    const lfo = c.createOscillator(); lfo.frequency.value = 5.2; const lg = c.createGain(); lg.gain.value = 9; lfo.connect(lg); lfo.start(t + 0.15); lfo.stop(t + dur + 0.3);
    for (const [type, det, oct] of [['sawtooth', -7, 0], ['sawtooth', 7, 0], ['square', 0, -12]]) {
      const o = c.createOscillator(); o.type = type; o.detune.value = det; lg.connect(o.detune);
      o.frequency.setValueAtTime(mtof(m + oct), t);
      if (glideTo != null) o.frequency.exponentialRampToValueAtTime(mtof(glideTo + oct), t + dur);
      const og = c.createGain(); og.gain.value = type === 'square' ? 0.35 : 1;
      o.connect(og).connect(lp); o.start(t); o.stop(t + dur + 0.3);
    }
    this._out(g, bus, 0.45);
  }

  // 拨弦（价格逐笔涨跌旋律）
  pluck(t, m, vel = 1) {
    const c = this.ctx, lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(600, t + 0.3);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12 * vel, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    lp.connect(g);
    for (const [type, det] of [['triangle', 0], ['sawtooth', 5]]) { const o = c.createOscillator(); o.type = type; o.frequency.value = mtof(m); o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + 0.5); }
    this._out(g, 'music', 0.4);
  }
  /** 实时成交价跳动：+1 上涨 / -1 下跌，按 8 分音符量化播放 */
  priceTick(dir) { this.tickQ = clamp(this.tickQ + dir, -4, 4); }
  level() { this.an.getFloatTimeDomainData(this._abuf); let e = 0; for (const v of this._abuf) e += v * v; return Math.sqrt(e / this._abuf.length); }

  // ---------- 特殊事件 ----------
  whale(t0 = this.ctx.currentTime + 0.02, side = 'blue') { // 巨鲸：陨火呼啸坠落（约 0.85 秒）→ 落地巨响
    const c = this.ctx, bus = this.sfxOn ? 'sfx' : 'music', fall = 0.85;
    // 坠落呼啸：下滑的哨音 + 越来越响的风声
    const wo = c.createOscillator(); wo.type = 'sine'; wo.frequency.setValueAtTime(1900, t0); wo.frequency.exponentialRampToValueAtTime(260, t0 + fall);
    const wg = c.createGain(); wg.gain.setValueAtTime(0.0001, t0); wg.gain.exponentialRampToValueAtTime(0.07, t0 + fall * 0.8); wg.gain.exponentialRampToValueAtTime(0.0001, t0 + fall + 0.03);
    wo.connect(wg); wo.start(t0); wo.stop(t0 + fall + 0.05);
    const wn = this._noiseSrc(t0, fall), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(3200, t0); bp.frequency.exponentialRampToValueAtTime(500, t0 + fall);
    const wng = c.createGain(); wng.gain.setValueAtTime(0.0001, t0); wng.gain.exponentialRampToValueAtTime(0.35, t0 + fall * 0.9); wng.gain.exponentialRampToValueAtTime(0.0001, t0 + fall + 0.03);
    wn.connect(bp).connect(wng);
    this._out(wg, bus, 0.3); this._out(wng, bus, 0.4);
    const t = t0 + fall;
    this._fireCrackle(t + 0.1, 1.6, 0.5, bus);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(24, t + 1.6);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.0, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(g); o.start(t); o.stop(t + 1.9);
    const nz = this._noiseSrc(t, 1.6), lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(180, t + 1.4);
    const ng = c.createGain(); ng.gain.setValueAtTime(0.7, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    nz.connect(lp).connect(ng);
    this._out(g, bus, 0.4); this._out(ng, bus, 0.6);
    this.taiko(t, 1, bus, 1.2); this.cymbal(t + 0.02, 3, 0.8, false, bus);
    if (this.musicOn) this.brass(t + 0.05, side === 'blue' ? 50 : 45, 0.9, 1, side === 'blue' ? 57 : 38);
  }
  // 火焰噼啪：稀疏的高频短脉冲
  _fireCrackle(t, dur, vel = 1, bus = 'sfx') {
    const c = this.ctx, n = Math.round(dur * 26);
    for (let i = 0; i < n; i++) {
      const tt = t + Math.random() * dur, nz = this._noiseSrc(tt, 0.02), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800 + Math.random() * 2500;
      const g = c.createGain(), a = vel * (0.05 + Math.random() * 0.1) * (1 - (tt - t) / dur * 0.7);
      g.gain.setValueAtTime(a, tt); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.015 + Math.random() * 0.02);
      nz.connect(hp).connect(g); this._out(g, bus, 0.2);
    }
  }
  spell(t = this.ctx.currentTime + 0.01, vel = 1) { // 人族魔法师施法：上行的水晶琶音 + 微光沙沙声 + 法球升起的嗡鸣
    const c = this.ctx;
    [86, 90, 93, 98].forEach((m, i) => {
      const tt = t + i * 0.045;
      for (const [type, det, a] of [['sine', 0, 1], ['triangle', 1200, 0.25]]) {
        const o = c.createOscillator(); o.type = type; o.frequency.value = mtof(m); o.detune.value = det;
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.08 * vel * a, tt + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.55);
        o.connect(g); o.start(tt); o.stop(tt + 0.6); this._out(g, 'sfx', 0.9);
      }
    });
    const nz = this._noiseSrc(t, 0.5), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(4000, t); bp.frequency.exponentialRampToValueAtTime(9000, t + 0.45);
    const ng = c.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.09 * vel, t + 0.08); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    nz.connect(bp).connect(ng); this._out(ng, 'sfx', 0.7);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(520, t + 0.35);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12 * vel, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g); o.start(t); o.stop(t + 0.45); this._out(g, 'sfx', 0.5);
  }
  roar(t = this.ctx.currentTime + 0.01, vel = 1) { // 兽族飞龙喷火：低沉带颤动的龙吼 + 呼啦的喷火声
    const c = this.ctx, dur = 0.55 + 0.35 * vel;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.9;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.linearRampToValueAtTime(2200, t + 0.12); lp.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32 * vel, t + 0.07); g.gain.setValueAtTime(0.28 * vel, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // 喉音颤动：振幅调制
    const am = c.createGain(); am.gain.value = 0.6; const lfo = c.createOscillator(); lfo.frequency.value = 31; const lg = c.createGain(); lg.gain.value = 0.4;
    lfo.connect(lg).connect(am.gain); lfo.start(t); lfo.stop(t + dur + 0.05);
    bp.connect(lp).connect(am).connect(g);
    for (const [f0, det] of [[78, 0], [117, 9], [156, -7]]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = det;
      o.frequency.setValueAtTime(f0 * 0.8, t); o.frequency.linearRampToValueAtTime(f0 * 1.15, t + 0.12); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + dur);
      o.connect(bp); o.start(t); o.stop(t + dur + 0.05);
    }
    this._out(g, 'sfx', 0.35);
    // 喷火：先呼啸后变低的噪声
    const nz = this._noiseSrc(t + 0.05, dur), nb = c.createBiquadFilter(); nb.type = 'bandpass'; nb.Q.value = 0.7;
    nb.frequency.setValueAtTime(2400, t + 0.05); nb.frequency.exponentialRampToValueAtTime(700, t + 0.05 + dur);
    const ng = c.createGain(); ng.gain.setValueAtTime(0.0001, t + 0.05); ng.gain.exponentialRampToValueAtTime(0.3 * vel, t + 0.18); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + dur);
    nz.connect(nb).connect(ng); this._out(ng, 'sfx', 0.3);
  }
  // ---------- 天气音效 ----------
  thunder(t = this.ctx.currentTime + 0.02, vel = 1) { // 炸雷：一声撕裂的脆响 + 拖长、起伏的低频滚雷
    const c = this.ctx;
    const cr = this._noiseSrc(t, 0.3), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const cg = c.createGain(); cg.gain.setValueAtTime(0.0001, t); cg.gain.exponentialRampToValueAtTime(0.22 * vel, t + 0.01); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    cr.connect(hp).connect(cg); this._out(cg, 'sfx', 0.5);
    const dur = 2.6 + Math.random(), rn = this._noiseSrc(t, dur), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(320, t); lp.frequency.exponentialRampToValueAtTime(110, t + dur);
    const rg = c.createGain(); rg.gain.setValueAtTime(0.0001, t);
    let tt = t + 0.04; rg.gain.exponentialRampToValueAtTime(0.55 * vel, tt);
    while (tt < t + dur - 0.4) { tt += 0.12 + Math.random() * 0.3; rg.gain.linearRampToValueAtTime((0.15 + Math.random() * 0.45) * vel * (1 - (tt - t) / dur), tt); } // 滚雷的起伏
    rg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    rn.connect(lp).connect(rg); this._out(rg, 'sfx', 0.6);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(32, t + 1.8);
    const og = c.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.3 * vel, t + 0.05); og.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    o.connect(og); o.start(t); o.stop(t + 2); this._out(og, 'sfx', 0.2);
  }
  setRain(level) { // 持续的雨声：循环噪声，音量随雨势慢慢变化
    const c = this.ctx;
    if (!this.rainG) {
      if (level < 0.01) return;
      const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
      this.rainG = c.createGain(); this.rainG.gain.value = 0;
      s.connect(hp).connect(lp).connect(this.rainG); this._out(this.rainG, 'sfx', 0.15); s.start();
    }
    this.rainG.gain.setTargetAtTime(Math.min(1, level) * 0.08, c.currentTime, 1.2);
  }
  erupt(t = this.ctx.currentTime + 0.02) { // 火山喷发：大地深处的长时间轰鸣 + 爆裂 + 噼啪的火
    const c = this.ctx, dur = 4.5;
    const n = this._noiseSrc(t, dur), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 130;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.5); g.gain.setValueAtTime(0.6, t + 2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(lp).connect(g); this._out(g, 'sfx', 0.4);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(38, t); o.frequency.linearRampToValueAtTime(30, t + dur);
    const og = c.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.35, t + 0.6); og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(og); o.start(t); o.stop(t + dur + 0.05); this._out(og, 'sfx', 0.2);
    this.boom(4.5, t + 0.15); this._fireCrackle(t + 0.4, 3.2, 0.9);
  }
  bell(t = this.ctx.currentTime + 0.02) { // 圣光：城堡钟楼敲两下（钟声泛音）
    const c = this.ctx, P = [[0.5, 0.5], [1, 1], [1.19, 0.55], [1.5, 0.4], [2, 0.5], [2.52, 0.25], [3, 0.18], [4.07, 0.1]];
    for (const [dt, base, vel] of [[0, 329.6, 1], [1.15, 246.9, 0.85]]) {
      const tt = t + dt;
      for (const [r, a] of P) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = base * r;
        const g = c.createGain(), d = 3.8 / Math.pow(r, 0.45);
        g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.07 * a * vel, tt + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, tt + d);
        o.connect(g); o.start(tt); o.stop(tt + d + 0.05); this._out(g, 'sfx', 0.8);
      }
    }
  }
  boom(power = 1, t = this.ctx.currentTime + 0.01) { // 法球 / 火球落地爆炸（power 1~5.5）
    const c = this.ctx, k = clamp((power - 1) / 4, 0, 1.2);
    const nz = this._noiseSrc(t, 0.3 + k * 0.5), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 - k * 400;
    const g = c.createGain(); g.gain.setValueAtTime(0.3 + k * 0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3 + k * 0.5);
    nz.connect(lp).connect(g); this._out(g, 'sfx', 0.3);
    const o = c.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
    const og = c.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.35 + k * 0.35, t + 0.005); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(og); o.start(t); o.stop(t + 0.45); this._out(og, 'sfx', 0.2);
  }
  fanfare(side, t = this.ctx.currentTime + 0.05) { // 胜利号角
    const third = side === 'blue' ? 66 : 65; // 蓝军 D 大调（光明），红军 D 小调（肃杀）
    const seq = [[62, 0, 0.16], [62, 0.18, 0.16], [62, 0.36, 0.16], [third, 0.54, 0.4], [69, 0.98, 0.4], [74, 1.42, 1.6]];
    for (const [m, dt, d] of seq) this.brass(t + dt, m, d, 1);
    for (const m of [62, third, 69]) this.brass(t + 1.42, m, 1.6, 0.7);
    for (let i = 0; i < 10; i++) this.taiko(t + i * 0.06, 0.35 + i * 0.05, 'music', 0.9);
    this.taiko(t + 1.42, 1, 'music', 1.1); this.cymbal(t + 1.42, 3, 1);
  }
  surgeHit(side, t = this.ctx.currentTime + 0.05) { // 总攻开始：上行铜管 + 镲
    this.cymbal(t - 0.6 < 0 ? t : t - 0.6, 0.6, 0.9, true);
    this.brass(t, side === 'blue' ? 50 : 57, 0.7, 1, side === 'blue' ? 62 : 45);
    this.taiko(t, 1, 'music', 1.1);
  }

  // ---------- 编曲调度 ----------
  _bar(t) {
    const s = this.state, I = clamp(s.intensity, 0, 1);
    const L = s.surge ? 3 : Math.min(3, Math.floor(I * 3.2));
    const bpm = s.surge ? Math.max(124, s.bpm || 0) : clamp(s.bpm || (66 + 52 * I), 60, 140);
    this.stepDur = 60 / bpm / 4;
    const dur = this.stepDur * 16;
    const side = s.bias > 0.15 ? 'blue' : s.bias < -0.15 ? 'red' : 'neutral';
    const chord = CH[PROG[side][this.bar % 4]];
    this.cur = { L, I, side, chord, root: chord[0] };
    this.drone(t, chord[0], dur, I);
    this.pad(t, side === 'red' ? chord.map(m => m) : chord.map(m => m + 12), dur, (side === 'blue' ? 0.35 : 0) + I * 0.6);
    // 铜管动机：蓝军上行、红军下行
    if (I > 0.5 || s.surge) {
      if (this.bar % 2 === 0 || s.surge) {
        const r = chord[0] + 12, q = this.stepDur * 4;
        const mot = side === 'red' ? [r + 7, r + 5, r + 3, r] : side === 'blue' ? [r, r + 3, r + 7, r + 12] : [r, r + 3, r + 2, r];
        mot.forEach((m, i) => this.brass(t + i * q, m, q * (i === 3 ? 1.8 : 0.9), 0.55 + 0.35 * I));
      }
    }
    if (s.surge) {
      if (this.bar % 2 === 0) this.cymbal(t, 1.6, 0.6);
      for (const m of chord) this.stab(t, m + 12, 1.3, 0.35);
      this.brass(t + this.stepDur * 12, chord[0] + 12, this.stepDur * 4, 0.9, chord[0] + 24);
    }
  }
  _step(t, i) {
    const { L, I, chord } = this.cur;
    const v = TAIKO[L][i];
    if (v) this.taiko(t, v * (0.55 + 0.45 * I));
    if (L >= 1 && (i === 4 || i === 12)) this.tom(t, 0.7);
    if (L >= 2 && (i === 14 || i === 15)) this.tom(t, 0.5);
    if (L >= 1 && i % 2 === 0) this.stab(t, chord[0] + OSTINATO[i / 2] , 0.6 + 0.4 * I);
    if (L >= 2 && i % 2 === 1) this.shaker(t, 0.6 + 0.4 * I);
    if (L >= 3 && i % 2 === 1) this.stab(t, chord[2] + 12, 0.45);
    if (L === 0 && i % 4 === 0) this.stab(t, chord[0] + (i === 8 ? 7 : 0), 0.5); // 安静时的弦乐脉搏
    // 价格每跳一下就弹一个音：上涨音阶上行、下跌下行（D 小调）
    if (i % 2 === 0 && this.tickQ !== 0) {
      const d = Math.sign(this.tickQ); this.tickQ -= d;
      this.deg = clamp(this.deg + d, 0, 14);
      const SC = [0, 2, 3, 5, 7, 8, 10], oct = Math.floor(this.deg / 7), m = 62 + 12 * oct + SC[this.deg % 7] - 12;
      this.pluck(t, m, 0.6 + 0.4 * I);
      if (this.deg === 0 || this.deg === 14) this.deg = 7;
    }
    // 每拍刷新速度（行情变化 1 拍内就能听出来）
    if (i % 4 === 3 && !this.state.surge) this.stepDur = 60 / clamp(this.state.bpm || 80, 60, 140) / 4;
  }
  /** 调度到 tEnd 为止的所有音符 */
  scheduleUntil(tEnd) {
    if (this.nextT < this.ctx.currentTime) this.nextT = this.ctx.currentTime + 0.05;
    while (this.nextT < tEnd) {
      if (this.step === 0) this._bar(this.nextT);
      this._step(this.nextT, this.step);
      this.nextT += this.stepDur;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }
  setState(st) { Object.assign(this.state, st); }
  setVolume(v) { this.volume = v; this.master.gain.setTargetAtTime(v * 0.9, this.ctx.currentTime, 0.05); }
  setMusic(on) {
    this.musicOn = on;
    this.music.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, on ? 0.3 : 0.15);
    if (on) { this.step = 0; this.nextT = this.ctx.currentTime + 0.1; }
  }
  setSfx(on) { this.sfxOn = on; this.sfx.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05); }
}

/** 浏览器端控制器：AudioContext 生命周期、iOS 解锁、后台暂停 */
function silentWavURL() { // 0.25 秒静音 WAV（iOS：让网页音频走“媒体”通道，静音键打开时也能出声）
  const n = 2000, b = new ArrayBuffer(44 + n), v = new DataView(b), w = (o, str) => [...str].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export class AudioController {
  constructor() { this.ctx = null; this.engine = null; this.timer = null; this.onstate = null; this.want = { music: false, sfx: false, volume: 0.75 }; }
  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'playback' });
    this.engine = new WarMusic(this.ctx);
    this.ctx.onstatechange = () => { if (this.running) this.engine.nextT = 0; this.onstate && this.onstate(this.ctx.state); };
    document.addEventListener('visibilitychange', () => this._vis());
  }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }
  get locked() { return (this.want.music || this.want.sfx) && !this.running && !document.hidden; }
  /** 在用户手势（点击/触摸/按键）回调里同步调用 */
  unlock() {
    this._ensure();
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    try { const s = this.ctx.createBufferSource(); s.buffer = this.ctx.createBuffer(1, 1, 22050); s.connect(this.ctx.destination); s.start(0); } catch (e) {}
    if (IOS) { try { if (!this.el) { this.el = new Audio(silentWavURL()); this.el.loop = true; this.el.setAttribute('playsinline', ''); } this.el.play().catch(() => {}); } catch (e) {} }
    const p = this.ctx.resume();
    this._apply();
    return (p && p.then ? p : Promise.resolve()).then(() => this.running, () => false);
  }
  /** 页面加载时尝试直接开播（浏览器允许自动播放时有效） */
  tryAutoStart() {
    if (navigator.getAutoplayPolicy && navigator.getAutoplayPolicy('audiocontext') === 'disallowed') return Promise.resolve(false);
    this._ensure(); this._apply();
    return this.ctx.resume().then(() => this.running, () => false);
  }
  _vis() {
    if (!this.ctx) return;
    if (document.hidden) { this.ctx.suspend(); if (this.el) this.el.pause(); }
    else if (this.want.music || this.want.sfx) { this.ctx.resume(); if (this.el) this.el.play().catch(() => {}); }
  }
  apply(w) { Object.assign(this.want, w); if (this.ctx) this._apply(); if (this.ctx && !this.running && !document.hidden && (w.music || w.sfx)) this.ctx.resume().catch(() => {}); }
  _apply() {
    const { music, sfx, volume } = this.want, e = this.engine;
    e.setVolume(volume);
    if (music !== e.musicOn) e.setMusic(music);
    e.setSfx(sfx);
    if (music && !this.timer) this.timer = setInterval(() => { if (this.running) this.engine.scheduleUntil(this.ctx.currentTime + 0.35); }, 60);
    if (!music && this.timer) { clearInterval(this.timer); this.timer = null; }
    if (!music && !sfx) setTimeout(() => { if (!this.engine.musicOn && !this.engine.sfxOn) this.ctx.suspend(); }, 400);
  }
  get on() { return !!(this.engine && (this.engine.musicOn || this.engine.sfxOn) && this.running); }
  level() { return this.engine ? this.engine.level() : 0; }
  bpm() { return this.engine ? Math.round(60 / this.engine.stepDur / 4) : 0; }
  update(st) { if (this.engine) this.engine.setState(st); }
  tick(dir) { if (this.engine && this.engine.musicOn && this.running) this.engine.priceTick(dir); }
  whale(side) { if (this.on) this.engine.whale(undefined, side); }
  get _sfx() { return this.engine && this.engine.sfxOn && this.running; }
  // 施法 / 落地音效：大单扎堆时限流，避免糊成一片
  _gate(key, gap) { const now = performance.now(), g = (this._g ||= {}); if (now - (g[key] || 0) < gap) return false; g[key] = now; return true; }
  cast(side, kind, mini) {
    if (!this._sfx || !this._gate('cast' + side, side === 'blue' ? 110 : 260)) return;
    const vel = mini ? 0.5 : kind === 'heavy' ? 1.15 : 0.85;
    if (side === 'blue') this.engine.spell(undefined, vel); else this.engine.roar(undefined, vel);
  }
  boom(power) { if (this._sfx && this._gate('boom', 90)) this.engine.boom(power); }
  // 天气：雷声（闪电后延迟一会儿）、火山轰鸣、圣光钟声；雨声随雨势持续
  weather(ev, delay = 0) {
    if (!this._sfx) return;
    const t = this.ctx.currentTime + 0.02 + (delay || 0), e = this.engine;
    if (ev === 'thunder' && this._gate('thunder', 1500)) e.thunder(t, 0.6 + Math.random() * 0.4);
    else if (ev === 'erupt' && this._gate('erupt', 20000)) e.erupt(t);
    else if (ev === 'bell' && this._gate('bell', 20000)) e.bell(t);
  }
  rain(level) { if (this.engine) this.engine.setRain(this._sfx ? level : 0); }
  fanfare(side) { if (this.engine && this.engine.musicOn && this.running) this.engine.fanfare(side); }
  surge(side) { if (this.engine && this.engine.musicOn && this.running) this.engine.surgeHit(side); }
}
