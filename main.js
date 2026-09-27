'use strict';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'capgift.' で始める。
const STORE = 'capgift.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'CAPGIFT', text: 'ふるさと納税、今年あといくら寄付できるか計算できる — CAPGIFT', url: 'https://capgift.t-of.workers.dev/' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// ---- 音（Web Audio。iPhone のマナーモードでも鳴るように navigator.audioSession を使う）----

function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

let audioCtx = null;
function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/** freqs: [{f, at, dur}] の音を鳴らす。とても小さく短く。 */
function beep(notes, gain = 0.05) {
  if (!settings.sound) return;
  const c = ctx();
  const now = c.currentTime;
  for (const { f, at = 0, dur = 0.08 } of notes) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0, now + at);
    g.gain.linearRampToValueAtTime(gain, now + at + 0.01);
    g.gain.linearRampToValueAtTime(0, now + at + dur);
    osc.connect(g).connect(c.destination);
    osc.start(now + at);
    osc.stop(now + at + dur + 0.02);
  }
}
const sfx = {
  tick: () => beep([{ f: 720, dur: 0.03 }], 0.04),
  firstResult: () => beep([{ f: 520, dur: 0.12 }, { f: 780, at: 0.1, dur: 0.15 }]),
  reachedCap: () => beep([{ f: 600, dur: 0.08 }, { f: 760, at: 0.08, dur: 0.08 }, { f: 960, at: 0.16, dur: 0.14 }]),
  overCap: () => beep([{ f: 220, dur: 0.15 }], 0.06),
  pickLink: () => beep([{ f: 480, dur: 0.04 }], 0.04),
  soundOn: () => beep([{ f: 660, dur: 0.09 }]),
};

// ---- 保存データ ----

const THIS_YEAR = new Date().getFullYear();
const DEFAULT_INPUTS = { v: 1, year: THIS_YEAR, income: null, spouse: false, hs: 0, uni: 0, social: null, donated: 0, genre: 'all' };

let inputs = { ...DEFAULT_INPUTS, ...load('inputs', DEFAULT_INPUTS) };
let yearResetNotice = false;
if (inputs.year !== THIS_YEAR) {
  inputs = { ...inputs, year: THIS_YEAR, donated: 0 };
  yearResetNotice = true;
}
const settings = { ...{ v: 1, sound: true }, ...load('settings', { v: 1, sound: true }) };

function persistInputs() { save('inputs', inputs); }
function persistSettings() { save('settings', settings); }

// ---- 画面の要素 ----

const $ = (id) => document.getElementById(id);
const incomeEl = $('income');
const socialEl = $('social');
const socialSummaryEl = $('socialSummary');
const donatedEl = $('donated');
const hsValueEl = $('hsValue');
const uniValueEl = $('uniValue');
const spouseChoiceEl = $('spouseChoice');
const soundBtn = $('soundBtn');

const resultEmptyEl = $('resultEmpty');
const resultBodyEl = $('resultBody');
const capValueEl = $('capValue');
const remainValueEl = $('remainValue');
const gaugeFillEl = $('gaugeFill');
const resultOverEl = $('resultOver');
const resultNoneEl = $('resultNone');
const pickEl = $('pick');
const bandBtnsEl = $('bandBtns');
const genresEl = $('genres');

const yen = (n) => Math.round(n).toLocaleString('ja-JP');

let hadFirstResult = inputs.income != null;
let wasOverCap = false;
let wasAtCap = false;

function renderInputs() {
  incomeEl.value = inputs.income == null ? '' : String(inputs.income);
  donatedEl.value = String(inputs.donated || 0);
  hsValueEl.textContent = String(inputs.hs);
  uniValueEl.textContent = String(inputs.uni);
  for (const btn of spouseChoiceEl.querySelectorAll('[data-spouse]')) {
    const active = (btn.dataset.spouse === 'true') === inputs.spouse;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
  for (const btn of genresEl.querySelectorAll('[data-genre]')) {
    const active = btn.dataset.genre === inputs.genre;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
  if (inputs.social == null) {
    socialEl.value = '';
    socialSummaryEl.textContent = '年収の15%で見積もり中';
  } else {
    socialEl.value = String(inputs.social);
    socialSummaryEl.textContent = `${inputs.social} 万円`;
  }
}

function renderResult() {
  const r = window.Capgift.estimate(inputs);
  if (!r) {
    resultEmptyEl.hidden = false;
    resultBodyEl.hidden = true;
    pickEl.hidden = true;
    return;
  }
  resultEmptyEl.hidden = true;
  resultBodyEl.hidden = false;

  capValueEl.textContent = yen(r.capYen);
  remainValueEl.textContent = yen(Math.max(0, r.remainingYen));

  const ratio = r.capYen > 0 ? Math.min(1, r.donatedYen / r.capYen) : 0;
  gaugeFillEl.style.width = `${Math.round(ratio * 100)}%`;
  gaugeFillEl.classList.toggle('is-over', r.overCap);
  resultOverEl.hidden = !r.overCap;
  resultNoneEl.hidden = !r.noDeduction;

  if (!hadFirstResult) { hadFirstResult = true; sfx.firstResult(); }
  if (r.overCap && !wasOverCap) sfx.overCap();
  else if (!r.overCap && r.remainingYen <= 0 && r.capYen > 0 && !wasAtCap) sfx.reachedCap();
  wasOverCap = r.overCap;
  wasAtCap = r.remainingYen <= 0 && r.capYen > 0;

  const remaining = Math.max(0, r.remainingYen);
  if (remaining >= 1000) {
    pickEl.hidden = false;
    renderBands(remaining);
  } else {
    pickEl.hidden = true;
  }
}

function renderBands(remainingYen) {
  const bands = window.Capgift.bands(remainingYen);
  bandBtnsEl.innerHTML = '';
  for (const b of bands) {
    const a = document.createElement('a');
    a.className = 'bandbtn';
    a.href = window.Capgift.bandLink(inputs.genre, b.min, b.max);
    a.target = '_blank';
    a.rel = 'sponsored noopener';
    const strong = document.createElement('strong');
    strong.textContent = b.label;
    const span = document.createElement('span');
    span.textContent = `${yen(b.min)}〜${yen(b.max)} 円`;
    a.append(strong, span);
    a.addEventListener('click', () => sfx.pickLink());
    bandBtnsEl.appendChild(a);
  }
}

// ---- イベント ----

incomeEl.addEventListener('input', () => {
  const v = incomeEl.value === '' ? null : Math.max(0, Math.min(3000, Number(incomeEl.value)));
  inputs.income = v;
  persistInputs();
  renderResult();
});

for (const btn of document.querySelectorAll('[data-step="income"]')) {
  btn.addEventListener('click', () => {
    const delta = Number(btn.dataset.delta);
    inputs.income = Math.max(0, Math.min(3000, (inputs.income || 0) + delta));
    persistInputs();
    renderInputs();
    renderResult();
    sfx.tick();
  });
}

for (const btn of document.querySelectorAll('[data-count]')) {
  btn.addEventListener('click', () => {
    const key = btn.dataset.count;
    const delta = Number(btn.dataset.delta);
    inputs[key] = Math.max(0, Math.min(10, (inputs[key] || 0) + delta));
    persistInputs();
    renderInputs();
    renderResult();
    sfx.tick();
  });
}

spouseChoiceEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-spouse]');
  if (!btn) return;
  inputs.spouse = btn.dataset.spouse === 'true';
  persistInputs();
  renderInputs();
  renderResult();
  sfx.tick();
});

genresEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-genre]');
  if (!btn) return;
  inputs.genre = btn.dataset.genre;
  persistInputs();
  renderInputs();
  renderResult();
});

socialEl.addEventListener('input', () => {
  inputs.social = socialEl.value === '' ? null : Math.max(0, Number(socialEl.value));
  persistInputs();
  renderInputs();
  renderResult();
});
$('socialReset').addEventListener('click', () => {
  inputs.social = null;
  persistInputs();
  renderInputs();
  renderResult();
});

donatedEl.addEventListener('input', () => {
  inputs.donated = donatedEl.value === '' ? 0 : Math.max(0, Number(donatedEl.value));
  persistInputs();
  renderResult();
});

soundBtn.addEventListener('click', () => {
  settings.sound = !settings.sound;
  persistSettings();
  soundBtn.textContent = settings.sound ? '音 on' : '音 off';
  soundBtn.setAttribute('aria-pressed', String(settings.sound));
  setAudioSession(settings.sound);
  if (settings.sound) sfx.soundOn();
});

// 最初のタップで AudioContext を作る・鳴らす前の準備（ブラウザは触る前の音を止めるため）
document.addEventListener('pointerdown', () => { ctx(); setAudioSession(settings.sound); }, { once: true });

// ---- 初期表示 ----

soundBtn.textContent = settings.sound ? '音 on' : '音 off';
soundBtn.setAttribute('aria-pressed', String(settings.sound));
renderInputs();
renderResult();

if (yearResetNotice) {
  persistInputs();
  // 年が変わって寄付した額を戻したことを 1 回だけ知らせる（ダイアログではなく、閉じられる帯で）
  const notice = $('yearNotice');
  notice.hidden = false;
  $('yearNoticeClose').addEventListener('click', () => { notice.hidden = true; });
}
