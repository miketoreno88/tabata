/* Сигналы и время во вкладке. Не нужен Firebase: BASE=http://127.0.0.1:5051/index.html (python3 -m http.server 5051)
   MODE=quick (по умолчанию, ~30 с): расписание сигналов, пауза, "Пропустить" без звука, время в заголовке вкладки.
   MODE=background (~100 с, на экране окно Chrome): вкладка таймера в фоне за второй вкладкой. Chrome запускается
   с "сильным" торможением фоновых таймеров уже через 10 с (обычно через 5 минут): таймеры такой вкладки он будит
   раз в минуту. Сигналы должны прозвучать вовремя, табло и заголовок вкладки - идти.
   Звук не слушаем: подменяем узлы Web Audio и записываем, какой сигнал на какое время поставлен и не отключён ли до этого */
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:5051/index.html';
const MODE = process.env.MODE || 'quick';
const results = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* В странице: каждый сигнал (основной генератор, без октавы) и время, когда отключили узел по пути к колонкам */
const SPY = () => {
  window.__tones = [];
  window.__clock = [];
  window.__errs = [];
  addEventListener('error', (e) => window.__errs.push(e.message));
  const conn = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (d, ...r) { this.__out = d; return conn.call(this, d, ...r); };
  const disc = AudioNode.prototype.disconnect;
  AudioNode.prototype.disconnect = function (...a) { if (this.__cutAt === undefined) this.__cutAt = this.context.currentTime; return disc.apply(this, a); };
  const st = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when) {
    const main = !this.__out || !this.__out.gain || this.__out.gain.value > 0.5;
    if (main) window.__tones.push({ f: this.frequency.value, when: when || 0, now: this.context.currentTime, perf: performance.now(), node: this });
    return st.call(this, when);
  };
  /* Сигнал в часах страницы (мс) и прозвучал ли он: не отключён до своего начала */
  window.__audible = () => window.__tones.map((x) => {
    let n = x.node, cut = Infinity;
    while (n) { if (n.__cutAt !== undefined) cut = Math.min(cut, n.__cutAt); n = n.__out; }
    const at = x.perf + (Math.max(x.when, x.now) - x.now) * 1000;
    return { f: x.f, at, ok: Math.max(x.when, x.now) < cut };
  }).filter((x) => x.ok).sort((a, b) => a.at - b.at);
  document.addEventListener('DOMContentLoaded', () => {
    const c = document.querySelector('#clock');
    new MutationObserver(() => window.__clock.push([performance.now(), c.textContent, document.visibilityState]))
      .observe(c, { childList: true, characterData: true, subtree: true });
  });
};

async function open(ctx, plan) {
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(SPY);
  await p.goto(BASE);
  await p.evaluate((pl) => localStorage.setItem('tabata-timer-v2', JSON.stringify(Object.assign({ volIdx: 0 }, pl))), plan);
  await p.reload();
  return { p, errs };
}
const rel = (tones) => { const t0 = tones.length ? tones[0].at : 0; return tones.map((x) => [Math.round(x.at - t0), x.f]); };
const fmt = (list) => list.map(([t, f]) => `${(t / 1000).toFixed(2)}:${f}`).join(' ');
function sameSchedule(got, want, tol) {
  if (got.length !== want.length) return false;
  return got.every(([t, f], i) => f === want[i][1] && Math.abs(t - want[i][0]) <= tol);
}

/* Вкладка в фоне - только в обычном Chrome через голый CDP: под Playwright вкладка остаётся "видимой"
   (и при второй вкладке, и при свёрнутом окне - проверено), торможение фона не включается */
async function background() {
  const { spawn } = require('child_process');
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabata-bg-'));
  const port = 9400 + Math.floor(Math.random() * 500);
  const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const ch = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=600,500', '--autoplay-policy=no-user-gesture-required',
    /* "сильное" торможение фоновых таймеров через 10 с вместо 5 минут */
    '--enable-features=IntensiveWakeUpThrottling:grace_period_seconds/10', 'about:blank'], { stdio: 'ignore' });
  try {
    let ver = null;
    for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch (e) { await sleep(200); } }
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    let id = 0; const pend = {};
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
    const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
    const { result: { targetInfos } } = await send('Target.getTargets');
    const tgt = targetInfos.find((t) => t.type === 'page');
    const { result: { sessionId: sid } } = await send('Target.attachToTarget', { targetId: tgt.targetId, flatten: true });
    const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.result.value;
    await send('Page.enable', {}, sid);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${SPY})()` }, sid);
    await send('Page.navigate', { url: BASE }, sid);
    await sleep(2500);
    /* Одна работа 1:30. После старта 30 с тишины - Chrome начинает будить вкладку раз в минуту */
    await ev(`localStorage.setItem('tabata-timer-v2', JSON.stringify({ volIdx: 0, prepare: 0, cool: 0, list: [{ w: 90, r: 0 }] }))`);
    await send('Page.reload', {}, sid);
    await sleep(2500);
    const t0 = await ev(`document.querySelector('#startBtn').click(), performance.now()`);
    await send('Target.createTarget', { url: 'about:blank', newWindow: false });
    await sleep(1500);
    const vis = await ev('document.visibilityState');
    check('вкладка таймера ушла в фон', vis === 'hidden', vis);
    const title1 = await ev('document.title');
    await sleep(60000);
    const title2 = await ev('document.title');
    await sleep(33000);
    const gotD = rel(await ev('window.__audible()'));
    const ticks = await ev(`window.__clock.filter((x) => x[2] === 'hidden').map((x) => x[0])`);
    const errs = await ev('window.__errs');
    /* Перерывы между обновлениями табло в фоне, считая до финиша (90 с): у старой версии они просто прекращались */
    const marks = ticks.filter((x) => x < t0 + 90000).concat([t0 + 89000]).sort((a, b) => a - b);
    let gap = 0;
    for (let i = 1; i < marks.length; i++) gap = Math.max(gap, marks[i] - marks[i - 1]);
    const wantD = [[0, 1400], [87000, 1000], [88000, 1000], [89000, 1000], [90000, 1400], [90300, 1400], [90600, 1900]];
    check('фон: 3-2-1 и финиш вовремя', sameSchedule(gotD, wantD, 60), fmt(gotD));
    check('фон: табло обновляется не реже раза в 1,5 с', gap <= 1500, `${ticks.length} обновлений, самый долгий перерыв ${Math.round(gap)} мс`);
    check('фон: время в заголовке вкладки идёт', title1 !== title2 && /^0:[23]\d · /.test(title2), `${title1} → ${title2}`);
    check('ошибок на странице нет (4)', !errs.length, errs.join('; '));
    ws.close();
  } finally {
    ch.kill();
    await sleep(500);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function quick() {
  const b = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
    /* 1. Расписание: работа 5 / отдых 5, работа 5, без подготовки */
    const A = await open(ctx, { prepare: 0, cool: 0, list: [{ w: 5, r: 5 }, { w: 5, r: 0 }] });
    const idleTitle = await A.p.title();
    await A.p.click('#startBtn');
    await sleep(1200);
    const runTitle = await A.p.title();
    await sleep(15500);
    const gotA = rel(await A.p.evaluate(() => window.__audible()));
    const wantA = [[0, 1400], [2000, 1000], [3000, 1000], [4000, 1000], [5000, 700], [5320, 700], [7000, 1000], [8000, 1000],
      [9000, 1000], [10000, 1400], [12000, 1000], [13000, 1000], [14000, 1000], [15000, 1400], [15300, 1400], [15600, 1900]];
    check('сигналы: этапы, 3-2-1 и финиш вовремя', sameSchedule(gotA, wantA, 40), fmt(gotA));
    check('вкладка: время и этап во время тренировки', /^0:0\d · Работа$/.test(runTitle), runTitle);
    check('вкладка: после финиша прежнее название', (await A.p.title()) === idleTitle, await A.p.title());
    check('ошибок на странице нет (1)', !A.errs.length, A.errs.join('; '));

    /* 2. "Пропустить" молча, до самого финиша */
    const B = await open(ctx, { prepare: 0, cool: 0, list: [{ w: 20, r: 10 }, { w: 20, r: 0 }] });
    await B.p.click('#startBtn');
    await sleep(1500);
    for (let i = 0; i < 3; i++) { await B.p.click('#skipBtn'); await sleep(800); }
    await sleep(1200);
    const gotB = rel(await B.p.evaluate(() => window.__audible()));
    const phaseB = await B.p.evaluate(() => document.querySelector('#stage').dataset.phase);
    check('пропустить: ни одного сигнала, кроме старта', sameSchedule(gotB, [[0, 1400]], 40), fmt(gotB));
    check('пропустить последний этап: финиш без звука', phaseB === 'done', phaseB);

    /* 3. Пауза: сигналы молчат, после продолжения идут со сдвигом на паузу */
    const C = await open(ctx, { prepare: 0, cool: 0, list: [{ w: 6, r: 0 }] });
    await C.p.click('#startBtn');
    await sleep(1000);
    const t1 = await C.p.evaluate(() => { document.querySelector('#startBtn').click(); return performance.now(); });
    await sleep(300);
    const pausedTitle = await C.p.title();
    await sleep(1700);
    const t2 = await C.p.evaluate(() => { document.querySelector('#startBtn').click(); return performance.now(); });
    await sleep(7000);
    const tonesC = await C.p.evaluate(() => window.__audible());
    const gotC = rel(tonesC), pause = Math.round(t2 - t1);
    const wantC = [[0, 1400], [3000 + pause, 1000], [4000 + pause, 1000], [5000 + pause, 1000], [6000 + pause, 1400], [6300 + pause, 1400], [6600 + pause, 1900]];
    check('пауза: во время паузы тихо', !tonesC.some((x) => x.at > t1 + 5 && x.at < t2 - 5), fmt(gotC));
    check('пауза: после продолжения сигналы сдвинуты на паузу', sameSchedule(gotC, wantC, 80), `пауза ${pause} мс; ${fmt(gotC)}`);
    check('вкладка: на паузе значок паузы', /^⏸ 0:0\d · Работа$/.test(pausedTitle), pausedTitle);
    check('ошибок на странице нет (2-3)', !B.errs.length && !C.errs.length, B.errs.concat(C.errs).join('; '));
  } finally {
    await b.close();
  }
}

(async () => {
  await (MODE === 'background' ? background() : quick());
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
